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
	}

	private async _handleMessage(message: WebviewMessage): Promise<void> {
		switch (message.command) {
			case 'getProviders':
				const providers = await this._configManager.getProviders();
				
				// Auto-fetch models for each provider from API, merging with local models
				const providersWithModels = await Promise.all(
					providers.map(async (provider) => {
						if (provider.hasApiKey) {
							const apiKey = await this._configManager.getApiKey(provider.id);
							if (apiKey) {
								try {
									const models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey, provider.models);
									// Save merged models back to storage so Copilot can see them
									await this._configManager.updateProvider(provider.id, { models });
									return { ...provider, models };
								} catch (err) {
									// If fetch fails, use existing stored models
									return provider;
								}
							}
						}
						return provider;
					})
				);
				
				this._getWebview()?.postMessage({
					command: 'providersLoaded',
					data: providersWithModels
				});
				break;

			case 'addProvider':
				try {
					const provider = message.data as { name: string; baseUrl: string; apiKey: string; models?: any[] };
					
					// Use models from request if provided, otherwise fetch from API
					let models: any[] = provider.models || [];
					if (models.length === 0 && provider.apiKey) {
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
						models: models,
						enabled: true
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
					} else if (apiKey) {
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
					
					await this._configManager.updateProvider(id, updates);
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
		}
	}

	/**
	 * Fetch models from OpenAI-compatible API
	 * Merges API models with existing local models, preserving local customizations.
	 * If a model exists in both, local settings take precedence.
	 * If a model is only in API, it gets added with defaults.
	 * If a model is only local, it gets preserved (API can add new ones).
	 */
	private async _fetchModelsFromAPI(baseUrl: string, apiKey: string, existingModels?: Array<{ modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' }>): Promise<Array<{ modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' }>> {
		const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
		const response = await fetch(`${normalizedBaseUrl}/models`, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			}
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
		})).filter((m: any) => m.modelId);
		
		// If no existing models, return API models
		if (!existingModels || existingModels.length === 0) {
			return apiModels;
		}
		
		// Create a map of existing models by modelId
		const existingMap = new Map<string, { modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' }>();
		for (const existing of existingModels) {
			existingMap.set(existing.modelId, existing);
		}
		
		// Merge: start with API models, override with local customizations
		const merged: Array<{ modelId: string; displayName: string; contextLength: number; maxTokens: number; vision: boolean; toolCalling: boolean; temperature: number; topP: number; samplingMode: 'temperature' | 'top_p' | 'both' }> = [];
		
		// Add API models (use API data for all fields that API provides)
		for (const apiModel of apiModels) {
			const localModel = existingMap.get(apiModel.modelId);
			if (localModel) {
				// Use API data for all fields, keep local temperature/topP/samplingMode
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

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleUri}?v=${version}" rel="stylesheet">
				<title>LLS OAI</title>
			</head>
			<body>
				<div class="container">
					<header class="header">
						<h1>LLS OAI</h1>
					</header>
					<div class="header-actions">
						<button id="importBtn" class="secondary-btn">Import</button>
						<button id="exportBtn" class="secondary-btn">Export</button>
					</div>

					<section class="providers-section">
						<div class="section-header">
							<h2>Providers</h2>
							<button id="addProviderBtn" class="primary-btn">+ Add Provider</button>
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
								<label for="providerBaseUrl">Base URL</label>
								<input type="url" id="providerBaseUrl" placeholder="https://api.openai.com/v1" required />
								<div class="help-text">The OpenAI-compatible API endpoint</div>
							</div>
							<div class="form-group">
								<label for="providerApiKey">API Key</label>
								<input type="password" id="providerApiKey" placeholder="sk-..." />
								<div class="help-text">Leave empty to keep existing key (when editing)</div>
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
							</select>
							<div class="help-text">Some models (e.g. Claude) only accept one sampling parameter at a time</div>
						</div>
						<div class="form-actions">
							<button type="button" id="cancelEditModelBtn" class="secondary-btn">Cancel</button>
							<button type="button" id="saveEditModelBtn" class="primary-btn">Save Model</button>
						</div>
					</div>
				</div>

				<script nonce="${nonce}">alert('INLINE_SCRIPT_LOADED');</script>
				<script nonce="${nonce}" src="${scriptUri}?v=${version}"></script>
			</body>
			</html>`;
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
