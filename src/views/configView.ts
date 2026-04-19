import * as vscode from 'vscode';
import { ConfigManager } from '../configManager';
import { WebviewMessage, ProviderConfigWithoutSecrets } from '../types';

/**
 * Webview panel for managing OpenAPI-compatible providers
 */
export class ConfigViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'openapicopilot.configView';

	private _view?: vscode.WebviewView;
	private _panelWebview?: vscode.Webview;
	private _adCache: any[] | null = null;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _configManager: ConfigManager,
		private readonly _chatProvider: { notifyModelsChanged(): void }
	) {}

	/**
	 * Get the current active webview (sidebar view or panel)
	 */
	private _getWebview(): vscode.Webview | undefined {
		return this._view?.webview ?? this._panelWebview;
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			await this._handleMessage(message);
		});

		// Load Ad when webview becomes visible
		this._loadAd();

		// Reload Ad each time webview visibility changes
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this._loadAd();
			}
		});
	}

	/**
	 * Fetch ad data and send a random ad to webview
	 * Uses cached data if available to avoid repeated network requests
	 */
	private async _loadAd(): Promise<void> {
		try {
			// Use cache if available, otherwise fetch from server
			let data: any[];
			if (this._adCache) {
				data = this._adCache;
			} else {
				const response = await fetch('https://ads-starmodel.oss-cn-shenzhen.aliyuncs.com/data2.json');
				if (!response.ok) return;
				const fetched = await response.json();
				if (!Array.isArray(fetched) || fetched.length === 0) return;
				this._adCache = fetched;
				data = fetched;
			}

			const randomAd = data[Math.floor(Math.random() * data.length)];
			this._getWebview()?.postMessage({ command: 'loadAd', data: randomAd });
		} catch (error) {
			// Ignore ad fetch errors
		}
	}

	private async _handleMessage(message: WebviewMessage): Promise<void> {
		switch (message.command) {
			case 'getProviders':
				const providers = await this._configManager.getProviders();
				
				// Immediately send providers to UI (without waiting for API fetch)
				this._getWebview()?.postMessage({
					command: 'providersLoaded',
					data: providers
				});
				
				// Async fetch models for each provider in background
				this._fetchModelsAsync(providers);
				break;

			case 'addProvider':
				try {
					const provider = message.data as { name: string; baseUrl: string; apiKey: string; apiType?: 'openai-compatible' | 'anthropic'; models?: any[]; autoFetchModels?: boolean };
					
					// Use models from request if provided, otherwise fetch from API
					let models: any[] = provider.models || [];
					const shouldFetch = provider.autoFetchModels !== false && models.length === 0 && provider.apiKey;
					if (shouldFetch) {
						try {
							models = await this._fetchModelsFromAPI(provider.baseUrl, provider.apiKey);
						} catch (err) {
							// If fetch fails, allow provider to be added without models
						}
					}
					
					const newProvider = await this._configManager.addProvider({
						name: provider.name,
						baseUrl: provider.baseUrl,
						apiKey: provider.apiKey,
						apiType: provider.apiType || 'openai-compatible',
						models: models,
						enabled: true,
						autoFetchModels: provider.autoFetchModels !== false,
					});
					
					this._getWebview()?.postMessage({
						command: 'providerAdded',
						success: true,
						data: newProvider
					});
					
					// Reload providers
					const updatedProviders = await this._configManager.getProviders();
					this._getWebview()?.postMessage({
						command: 'providersLoaded',
						data: updatedProviders
					});
					
					// Notify Copilot that models have changed
					this._chatProvider.notifyModelsChanged();
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					this._getWebview()?.postMessage({
						command: 'providerAdded',
						success: false,
						error: errorMessage
					});
				}
				break;

			case 'updateProvider':
				try {
					const { id, apiKey, ...updates } = message.data as ProviderConfigWithoutSecrets & { apiKey?: string; models?: any[] };
					
					// Get current provider to merge models
					const currentProvider = await this._configManager.getProvider(id);
					const currentModels = currentProvider?.models || [];
					
					// Use models from request if provided, otherwise fetch from API and merge
					if (updates.models && updates.models.length > 0) {
						// User provided models, use them
					} else if (apiKey && updates.enabled !== false) {
						const baseUrl = updates.baseUrl || currentProvider?.baseUrl || '';
						if (baseUrl) {
							try {
								const models = await this._fetchModelsFromAPI(baseUrl, apiKey, currentModels);
								updates.models = models;
							} catch (err) {
								// If fetch fails, keep existing models
								updates.models = currentModels;
							}
						}
					}
					
					// Only pass apiKey if it's provided (non-empty), otherwise keep existing key
					const updateData: any = { ...updates };
					if (apiKey) {
						updateData.apiKey = apiKey;
					}
					
					await this._configManager.updateProvider(id, updateData);
					const updatedProviders = await this._configManager.getProviders();
					this._getWebview()?.postMessage({
						command: 'providersLoaded',
						data: updatedProviders
					});
					
					// Notify Copilot that models have changed
					this._chatProvider.notifyModelsChanged();
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to update provider: ${errorMessage}`);
				}
				break;
				
			case 'fetchModels':
				try {
					const data = message.data as { baseUrl: string; apiKey: string; existingModels?: any[] };
					const models = await this._fetchModelsFromAPI(data.baseUrl, data.apiKey, data.existingModels);
					this._getWebview()?.postMessage({
						command: 'modelsFetched',
						success: true,
						models: models
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					this._getWebview()?.postMessage({
						command: 'modelsFetched',
						success: false,
						error: errorMessage
					});
				}
				break;

			case 'deleteProvider':
				try {
					const id = message.data as string;
					if (!id) {
						throw new Error('No provider ID provided for deletion');
					}
					
					// Ask for confirmation
					const confirm = await vscode.window.showWarningMessage(
						`Are you sure you want to delete this provider?`,
						{ modal: true },
						'Delete'
					);
					
					if (confirm !== 'Delete') {
						return; // User cancelled
					}
					
					await this._configManager.removeProvider(id);
					
					const updatedProviders = await this._configManager.getProviders();
					this._getWebview()?.postMessage({
						command: 'providersLoaded',
						data: updatedProviders
					});
					
					// Notify Copilot that models have changed
					this._chatProvider.notifyModelsChanged();
					
					vscode.window.showInformationMessage('Provider deleted successfully.');
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to delete provider: ${errorMessage}`);
				}
				break;

			case 'toggleProvider':
				try {
					const { id, enabled } = message.data as { id: string; enabled: boolean };
					await this._configManager.updateProvider(id, { enabled });
					const updatedProviders = await this._configManager.getProviders();
					this._getWebview()?.postMessage({
						command: 'providersLoaded',
						data: updatedProviders
					});
					
					// Notify Copilot that models have changed (enabled/disabled)
					this._chatProvider.notifyModelsChanged();
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to toggle provider: ${errorMessage}`);
				}
				break;

			case 'toggleAutoFetchModels':
				try {
					const { id, autoFetchModels } = message.data as { id: string; autoFetchModels: boolean };
					await this._configManager.updateProvider(id, { autoFetchModels });
					
					// If enabling auto-fetch, fetch models immediately
					if (autoFetchModels) {
						const providers = await this._configManager.getProviders();
						const provider = providers.find(p => p.id === id);
						if (provider && provider.enabled && provider.hasApiKey) {
							const apiKey = await this._configManager.getApiKey(id);
							if (apiKey) {
								try {
									const models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey, provider.models);
									await this._configManager.updateProvider(id, { models });
									this._getWebview()?.postMessage({
										command: 'providerModelsUpdated',
										data: { providerId: id, models }
									});
								} catch (err) {
									// Fetch failed, still clear loading state
									this._getWebview()?.postMessage({
										command: 'providerModelsUpdated',
										data: { providerId: id, models: provider.models || [] }
									});
								}
							}
						}
					}
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to toggle auto-fetch: ${errorMessage}`);
				}
				break;

			case 'fetchProviderModels':
				try {
					const { id } = message.data as { id: string };
					const providers = await this._configManager.getProviders();
					const provider = providers.find(p => p.id === id);
					if (provider && provider.enabled && provider.hasApiKey) {
						const apiKey = await this._configManager.getApiKey(id);
						if (apiKey) {
							// Set loading state
							this._getWebview()?.postMessage({
								command: 'providerModelsLoading',
								data: { providerId: id, loading: true }
							});
							
							try {
								const models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey, provider.models);
								await this._configManager.updateProvider(id, { models });
								this._getWebview()?.postMessage({
									command: 'providerModelsUpdated',
									data: { providerId: id, models }
								});
							} catch (err) {
								this._getWebview()?.postMessage({
									command: 'providerModelsUpdated',
									data: { providerId: id, models: provider.models || [] }
								});
							}
						}
					}
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to fetch models: ${errorMessage}`);
				}
				break;

			case 'exportConfig':
				const config = await this._configManager.exportConfig();
				const content = JSON.stringify(config, null, 2);
				const saveUri = await vscode.window.showSaveDialog({
					filters: { 'JSON': ['json'] },
					title: 'Export Provider Configuration'
				});
				if (saveUri) {
					await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content));
					vscode.window.showInformationMessage('Configuration exported successfully.');
				}
				break;

			case 'importConfig':
				const openUri = await vscode.window.showOpenDialog({
					filters: { 'JSON': ['json'] },
					title: 'Import Provider Configuration',
					canSelectMany: false
				});
				if (openUri && openUri.length > 0) {
					const content = await vscode.workspace.fs.readFile(openUri[0]);
					const data = JSON.parse(content.toString());
					await this._configManager.importConfig(data);
					const updatedProviders = await this._configManager.getProviders();
					this._getWebview()?.postMessage({
						command: 'providersLoaded',
						data: updatedProviders
					});
					
					// Notify Copilot that models have changed
					this._chatProvider.notifyModelsChanged();
					
					vscode.window.showInformationMessage('Configuration imported successfully.');
				}
				break;

			case 'getChatHistorySettings':
				const settings = await this._configManager.getChatHistorySettings();
				this._getWebview()?.postMessage({
					command: 'chatHistorySettingsLoaded',
					data: settings
				});
				break;

			case 'updateChatHistorySettings':
				try {
					const { enabled, savePath } = message.data as { enabled: boolean; savePath: string };
					const updatedSettings = await this._configManager.updateChatHistorySettings({ enabled, savePath });
					this._getWebview()?.postMessage({
						command: 'chatHistorySettingsLoaded',
						data: updatedSettings,
						success: true
					});
					vscode.window.showInformationMessage('Chat history settings updated.');
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to update chat history settings: ${errorMessage}`);
					this._getWebview()?.postMessage({
						command: 'chatHistorySettingsLoaded',
						success: false,
						error: errorMessage
					});
				}
				break;

			case 'exportRecords':
				try {
					// Get VS Code workspace storage path based on platform
					const home = process.env.HOME || process.env.USERPROFILE || '';
					let workspaceStoragePath = '';
					if (process.platform === 'darwin') {
						workspaceStoragePath = `${home}/Library/Application Support/Code/User/workspaceStorage`;
					} else if (process.platform === 'win32') {
						const appData = process.env.APPDATA || `${home}/AppData/Roaming`;
						workspaceStoragePath = `${appData}/Code/User/workspaceStorage`;
					} else {
						workspaceStoragePath = `${home}/.config/Code/User/workspaceStorage`;
					}

					// Get current workspace folder
					const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
					const workspacePath = workspaceFolder?.uri.fsPath || 'unknown';

					const prompt = `Please help me export chat records:

1. VS Code chat records directory: ${workspaceStoragePath}
2. Current project path: ${workspacePath}

Please perform the following operations:
- Traverse all subdirectories under ${workspaceStoragePath}
- Read the workspace.json file in each subdirectory
- Find the subdirectory whose folder field equals the current project path (${workspacePath})
- Create a .LLSOAI/current-timestamp folder under the current project
- Copy all contents from the matched subdirectory (including workspace.json and chatSessions folder) to the .LLSOAI/current-timestamp folder`;

					// Open new chat and send message
					await vscode.commands.executeCommand('workbench.action.chat.newChat');
					await vscode.commands.executeCommand('workbench.action.chat.open', {
						query: prompt,
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to export records: ${errorMessage}`);
				}
				break;

			case 'importRecords':
				try {
					// Get VS Code workspace storage path based on platform
					const home = process.env.HOME || process.env.USERPROFILE || '';
					let workspaceStoragePath = '';
					if (process.platform === 'darwin') {
						workspaceStoragePath = `${home}/Library/Application Support/Code/User/workspaceStorage`;
					} else if (process.platform === 'win32') {
						const appData = process.env.APPDATA || `${home}/AppData/Roaming`;
						workspaceStoragePath = `${appData}/Code/User/workspaceStorage`;
					} else {
						workspaceStoragePath = `${home}/.config/Code/User/workspaceStorage`;
					}

					// Get current workspace folder
					const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
					const workspacePath = workspaceFolder?.uri.fsPath || 'unknown';

					const prompt = `Please help me import chat records:

1. Current project path: ${workspacePath}
2. VS Code chat records directory: ${workspaceStoragePath}

Please perform the following operations:
- Check if the .LLSOAI directory exists in the current project
- If it does not exist, prompt the user to place the exported records folder into the .LLSOAI directory
- If it exists, list all subdirectories under .LLSOAI and find the one with the most recent modification time
- Traverse ALL subdirectories under ${workspaceStoragePath} and read each workspace.json file
- Find the subdirectory whose workspace.json "folder" field matches the current project path (${workspacePath})
- Once found, force copy ALL contents from the latest .LLSOAI directory into that matched subdirectory (overwrite any existing files)

After completing the operations, please reply with the following message in both English and Chinese:
"Import completed successfully. Please close the current editor and reopen it to load the migrated data. If the chat records do not appear after reopening, please try importing again and then close and reopen the editor once more.
导入完成。请关闭当前编辑器并重新打开以载入迁移的数据。如果重新打开后没有看到聊天记录，请再次尝试导入，完成后再次关闭并重新打开编辑器。"`;

					// Open new chat and send message
					//await vscode.commands.executeCommand('workbench.action.chat.newChat');
					await vscode.commands.executeCommand('workbench.action.chat.open', {
						query: prompt,
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to import records: ${errorMessage}`);
				}
				break;

			case 'openUrl':
				const url = message.data as string;
				if (url) {
					vscode.env.openExternal(vscode.Uri.parse(url));
				}
				break;
		}
	}

	/**
	 * Fetch models from OpenAI-compatible API
	 * Merges API models with existing local models, preserving local customizations.
	 * If a model exists in both, local settings take precedence.
	 * If a model is only in API, it gets added with defaults.
	 * If a model is only local, it gets preserved (API can add new ones).
	 */
	private async _fetchModelsFromAPI(baseUrl: string, apiKey: string, existingModels?: Array<{ modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' | 'none'; isUserSelectable?: boolean; transformThink?: boolean }>): Promise<Array<{ modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' | 'none'; isUserSelectable?: boolean; transformThink?: boolean }>> {
		const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		try {
			const response = await fetch(`${normalizedBaseUrl}/models`, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
			}

			const data: any = await response.json();
		const modelsList = data.data || data.models || [];
		
		const apiModels = modelsList.map((m: any) => ({
			modelId: m.id || '',
			displayName: m.name || m.id || '',
			contextLength: m.max_input_tokens || 128000,
			maxTokens: m.max_output_tokens || 4096,
			vision: (m.input_modalities && m.input_modalities.includes('image')) || false,
			toolCalling: (m.supported_parameters && m.supported_parameters.includes('tools')) ?? true,
			temperature: 0.7,
			topP: 1.0,
			samplingMode: 'both',
			isUserSelectable: undefined,
		})).filter((m: any) => m.modelId);
		
		// If no existing models, return API models
		if (!existingModels || existingModels.length === 0) {
			return apiModels;
		}
		
		// Create a map of existing models by modelId
		const existingMap = new Map<string, { modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' | 'none'; isUserSelectable?: boolean; transformThink?: boolean }>();
		for (const existing of existingModels) {
			existingMap.set(existing.modelId, existing);
		}
		
		// Merge: start with API models, override with local customizations
		const merged: Array<{ modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' | 'none'; isUserSelectable?: boolean; transformThink?: boolean }> = [];
		
		// Add API models (use API data for all fields that API provides)
		for (const apiModel of apiModels) {
			const localModel = existingMap.get(apiModel.modelId);
			if (localModel) {
				// Use API data for all fields, keep local temperature/topP/samplingMode/isUserSelectable/transformThink
				merged.push({
					modelId: apiModel.modelId,
					displayName: apiModel.displayName,
					contextLength: apiModel.contextLength,
					maxTokens: apiModel.maxTokens,
					vision: apiModel.vision,
					toolCalling: apiModel.toolCalling,
					temperature: localModel.temperature ?? 0.7,
					topP: localModel.topP ?? 1.0,
					samplingMode: localModel.samplingMode ?? 'both',
					isUserSelectable: localModel.isUserSelectable,
					transformThink: localModel.transformThink,
				});
			} else {
				merged.push(apiModel);
			}
		}
		
		// Add local-only models that are not in API
		for (const localModel of existingModels) {
			const apiMatch = apiModels.find((m: any) => m.modelId === localModel.modelId);
			if (!apiMatch) {
				merged.push(localModel);
			}
		}
		
		return merged;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Asynchronously fetch models for each provider and send updates to the UI.
	 * Runs in background without blocking the initial provider list display.
	 */
	private async _fetchModelsAsync(providers: any[]): Promise<void> {
		for (const provider of providers) {
			// Skip disabled providers or providers with autoFetchModels disabled
			if (!provider.enabled || provider.autoFetchModels === false) {
				continue;
			}
			if (!provider.hasApiKey) {
				continue;
			}
			
			const apiKey = await this._configManager.getApiKey(provider.id);
			if (!apiKey) {
				continue;
			}
			
			try {
				const models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey, provider.models);
				// Save merged models back to storage so Copilot can see them
				await this._configManager.updateProvider(provider.id, { models });
				
				// Send updated models to UI
				this._getWebview()?.postMessage({
					command: 'providerModelsUpdated',
					data: { providerId: provider.id, models }
				});
			} catch (err) {
				// If fetch fails, still clear loading state and keep existing models
				this._getWebview()?.postMessage({
					command: 'providerModelsUpdated',
					data: { providerId: provider.id, models: provider.models || [] }
				});
			}
		}
	}

	/**
	 * Open the configuration as a tab (if not using sidebar)
	 */
	public async show(): Promise<void> {
		if (this._view) {
			await vscode.commands.executeCommand(`${ConfigViewProvider.viewType}.focus`);
		} else {
			// Open as panel if webview view not available
			const panel = vscode.window.createWebviewPanel(
				'openapicopilotConfig',
				'LLS OAI',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					localResourceRoots: [this._extensionUri]
				}
			);
			this._panelWebview = panel.webview;
			panel.webview.html = this._getHtmlForWebview(panel.webview);
			panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
				await this._handleMessage(message);
			});
			// Clean up when panel is disposed
			panel.onDidDispose(() => {
				this._panelWebview = undefined;
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get URIs for webview resources
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'assets', 'configView', 'configView.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'assets', 'configView', 'configView.css'));
		const nonce = this._getNonce();
		const version = Date.now(); // Force reload
		const vscodeLocale = vscode.env.language; // e.g. 'zh-cn', 'en'

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https:;">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleUri}?v=${version}" rel="stylesheet">
				<title>LLS OAI</title>
			</head>
			<body>
				<div class="container">
					<!-- Ad Banner -->
					<div id="adBanner" class="ad-banner" style="display:none;"></div>

					<header class="header">
						<div class="header-top">
							<h1>LLS OAI</h1>
							<div class="header-actions">
								<button id="importBtn" class="icon-btn" title="Import Configuration">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 1h-7l-.5.5v4H1.5l-.5.5v8l.5.5h13l.5-.5v-8l-.5-.5H12V1.5l-.5-.5zM5 5V2h6v3H5zm9 9H2V6h3v1.5l.5.5h5l.5-.5V6h3v8z"/><path d="M6 10h4v1H6v-1z"/></svg>
									<span>Import</span>
								</button>
								<button id="exportBtn" class="icon-btn" title="Export Configuration">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 1h-7l-.5.5v4H1.5l-.5.5v8l.5.5h13l.5-.5v-8l-.5-.5H12V1.5l-.5-.5zM5 5V2h6v3H5zm9 9H2V6h3v1.5l.5.5h5l.5-.5V6h3v8z"/><path d="M6 8h1v3h2V8h1L8 5.5 6 8z"/></svg>
									<span>Export</span>
								</button>
							</div>
						</div>
						<p class="header-subtitle">OpenAPI Compatible Copilot</p>
					</header>

					<section class="config-section chat-history-section">
						<div class="section-header">
							<div class="section-title-group">
								<svg class="section-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2L1 2v9l1 1h3v2.5l.854.354L8.707 12H14l1-1V2l-1-1zm0 10H8.293L5.146 14.146 6 13.293V11H2V2h12v9z"/><path d="M3 4h10v1H3V4zm0 2h8v1H3V6zm0 2h6v1H3V8z"/></svg>
								<h2>Save Chat History</h2>
							</div>
							<button id="settingsBtn" class="icon-btn compact" title="Chat History Settings">
								<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.5 2h-1v5h1V2zm6.1 5H6.4L6 6.45v-1L6.4 5h3.2l.4.5v1l-.4.5zm-5 3H1.4L1 9.5v-1l.4-.5h3.2l.4.5v1l-.4.5zm3.9-8h-1v2h1V2zm-1 6h1v6h-1V8zm-4 3h-1v3h1v-3zm7.9 0h3.19l.4-.5v-1l-.4-.5H11.4l-.4.5v1l.4.5zm2.1-9h-1v6h1V2zm-1 10h1v2h-1v-2z"/></svg>
								<span>Settings</span>
							</button>
						</div>
					</section>

					<section class="config-section chat-records-section">
						<div class="section-header">
							<div class="section-title-group">
								<svg class="section-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2L1 2v9l1 1h3v2.5l.854.354L8.707 12H14l1-1V2l-1-1zm0 10H8.293L5.146 14.146 6 13.293V11H2V2h12v9z"/><path d="M3 4h10v1H3V4zm0 2h8v1H3V6zm0 2h6v1H3V8z"/></svg>
								<h2>Copilot Records</h2>
							</div>
							<div class="section-actions">
								<button id="importRecordsBtn" class="secondary-btn">Import</button>
								<button id="exportRecordsBtn" class="secondary-btn">Export</button>
							</div>
						</div>
						<p class="section-description">Import and export Copilot chat records for migration between different machines.</p>
					</section>

					<section class="config-section providers-section">
						<div class="section-header">
							<div class="section-title-group">
								<svg class="section-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1H2.5L2 1.5V5l.5.5h1.639l.138.248 1.14 2.06-.638 2.148L4.5 10.5H3v3l.5.5h9l.5-.5v-3h-1.5l-.279-.544-.638-2.148 1.14-2.06.138-.248H13.5l.5-.5V1.5l-.5-.5zM13 5H3V2h10v3zm-2.621 5H5.621l.579-1.948-.758-1.37L4.5 5h7l-.942 1.682-.758 1.37L10.379 10zM12 13H4v-2h8v2z"/></svg>
								<h2>Providers</h2>
								<span class="provider-count" id="providerCount"></span>
							</div>
							<button id="addProviderBtn" class="primary-btn add-provider-btn">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>
								<span>Add Provider</span>
							</button>
						</div>
						<div id="providersList" class="providers-list">
							<!-- Providers will be rendered here -->
						</div>
					</section>
				</div>

				<!-- Add/Edit Provider Modal -->
				<div id="providerModal" class="modal">
					<div class="modal-content">
						<div class="modal-header">
							<h2 id="modalTitle">Add Provider</h2>
							<button id="closeModal" class="close-btn">&times;</button>
						</div>
						<form id="providerForm">
							<input type="hidden" id="providerId" />
							<div class="form-group">
								<label for="providerName">Provider Name</label>
								<input type="text" id="providerName" placeholder="e.g., MyOpenAI, LocalLLM" required />
								<div class="help-text">A unique name to identify this provider in Copilot</div>
							</div>
							<div class="form-group">
								<label for="providerApiType">API Type</label>
								<select id="providerApiType">
									<option value="openai-compatible">OpenAI-Compatible</option>
									<option value="anthropic">Anthropic</option>
								</select>
								<div class="help-text">The API protocol used by this provider</div>
							</div>
							<div class="form-group">
								<label for="providerBaseUrl">Base URL</label>
								<input type="url" id="providerBaseUrl" placeholder="https://api.openai.com/v1" required />
								<div class="help-text">The API endpoint</div>
							</div>
							<div class="form-group">
								<label for="providerApiKey">API Key</label>
								<input type="password" id="providerApiKey" placeholder="sk-..." />
								<div class="help-text">Leave empty to keep existing key (when editing)</div>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="providerAutoFetchModels" checked />
									Auto Fetch Models
								</label>
								<div class="help-text">Automatically fetch models from API when settings open</div>
							</div>
							<div class="form-actions">
								<button type="button" id="cancelBtn" class="secondary-btn">Cancel</button>
								<button type="submit" class="primary-btn">Save Provider</button>
							</div>
						</form>
					</div>
				</div>

				<!-- Edit Model Modal -->
				<div id="editModelModal" class="modal">
					<div class="modal-content">
						<div class="modal-header">
							<h2 id="editModelTitle">Edit Model</h2>
							<button id="closeEditModelBtn" class="close-btn">&times;</button>
						</div>
						<div class="form-group">
							<label for="editModelName">Model ID</label>
							<input type="text" id="editModelName" placeholder="e.g., gpt-4o" required />
						</div>
						<div class="form-group">
							<label for="editModelDisplayName">Display Name</label>
							<input type="text" id="editModelDisplayName" placeholder="e.g., GPT-4o" />
						</div>
						<div class="form-row">
							<div class="form-group">
								<label for="editModelContextLength">Context Length</label>
								<input type="number" id="editModelContextLength" value="128000" min="1" />
							</div>
							<div class="form-group">
								<label for="editModelMaxTokens">Max Tokens</label>
								<input type="number" id="editModelMaxTokens" value="4096" min="1" />
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelVision" />
									Vision Support
								</label>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelToolCalling" />
									Tool Calling
								</label>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelUserSelectable" />
									Show in Chat Selector
								</label>
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelTransformThink" />
									Transform Think Tags (<think>/</think>)
								</label>
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label for="editModelTemperature">Temperature</label>
								<input type="number" id="editModelTemperature" value="0.7" min="0" max="2" step="0.1" />
							</div>
							<div class="form-group">
								<label for="editModelTopP">Top P</label>
								<input type="number" id="editModelTopP" value="1.0" min="0" max="1" step="0.1" />
							</div>
						</div>
						<div class="form-group">
							<label for="editModelSamplingMode">Sampling Mode</label>
							<select id="editModelSamplingMode">
								<option value="both">Both (temperature + top_p)</option>
								<option value="temperature">Temperature only</option>
								<option value="top_p">Top P only</option>
								<option value="none">None (do not pass)</option>
							</select>
							<div class="help-text">Some models (e.g. Claude) only accept one sampling parameter at a time</div>
						</div>
						<div class="form-actions">
							<button type="button" id="cancelEditModelBtn" class="secondary-btn">Cancel</button>
							<button type="button" id="saveEditModelBtn" class="primary-btn">Save Model</button>
						</div>
					</div>
				</div>

				<!-- Settings Modal -->
				<div id="settingsModal" class="modal">
					<div class="modal-content">
						<div class="modal-header">
							<h2>Chat History Settings</h2>
							<button id="closeSettingsModal" class="close-btn">&times;</button>
						</div>
						<div class="form-group">
							<label class="checkbox-label">
								<input type="checkbox" id="chatHistoryEnabled" />
								Auto Save Chat History
							</label>
							<div class="help-text">Automatically save chat conversations to local files</div>
						</div>
						<div class="form-group">
							<label for="chatHistorySavePath">Save Path</label>
							<input type="text" id="chatHistorySavePath" placeholder="Path to save chat history" />
							<div class="help-text">Default: Windows: %APPDATA%/LLSOAI, macOS/Linux: ~/.LLSOAI</div>
						</div>
						<div class="form-actions">
							<button type="button" id="cancelSettingsBtn" class="secondary-btn">Cancel</button>
							<button type="button" id="saveSettingsBtn" class="primary-btn">Save</button>
						</div>
					</div>
				</div>

				<script nonce="${nonce}">window.VSCODE_LOCALE = '${vscodeLocale}';</script>
			<script nonce="${nonce}">alert('INLINE_SCRIPT_LOADED');</script>
				<script nonce="${nonce}" src="${scriptUri}?v=${version}"></script>
			</body>
			</html>`;
	}

	/**
	 * Get default chat records save path based on platform
	 */
	private _getDefaultSavePath(): string {
		const home = process.env.HOME || process.env.USERPROFILE || '';
		if (process.platform === 'win32') {
			const appData = process.env.APPDATA || '';
			return appData ? `${appData}/LLSOAI` : `${home}/AppData/Roaming/LLSOAI`;
		}
		return `${home}/.LLSOAI`;
	}

	private _getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
