import * as vscode from 'vscode';
import { ConfigManager } from '../configManager';
import { WebviewMessage, ProviderConfigWithoutSecrets } from '../types';
import { optimizePrompt } from '../promptEnhancementStatusBar';

function getExpertSelectableProviders(providers: any[]): any[] {
	return (providers || [])
		// Expert Mode and Solution Provider intentionally require API-key-backed providers.
		// No-key local providers are supported only in normal chat.
		.filter((provider: any) => provider?.enabled && provider?.hasApiKey === true)
		.map((provider: any) => ({
			...provider,
			models: ((provider.models || []) as any[]).filter((model: any) => model?.isUserSelectable === true),
			apiModels: ((provider.apiModels || []) as any[]).filter((model: any) => model?.isUserSelectable === true),
		}))
		.filter((provider: any) =>
			((provider.models || []) as any[]).length > 0 ||
			((provider.apiModels || []) as any[]).length > 0
		);
}

function requiresApiKey(apiType?: string): boolean {
	return apiType === 'anthropic';
}

type ConfigViewModel = {
	modelId: string;
	displayName: string;
	contextLength: number;
	maxTokens: number;
	vision: boolean;
	toolCalling: boolean;
	temperature: number;
	topP: number;
	samplingMode: 'temperature' | 'top_p' | 'both' | 'none';
	isUserSelectable?: boolean;
	transformThink?: boolean;
	preserveReasoningContent?: boolean;
};

type ConfigViewMessageKey = 
	| 'globalSettingsSaved' 
	| 'projectSettingsSaved' 
	| 'providerDeleted' 
	| 'configExported' 
	| 'configImported' 
	| 'expertModeSettingsUpdated' 
	| 'solutionProviderSettingsUpdated' 
	| 'chatHistorySettingsUpdated' 
	| 'projectChatHistorySettingsUpdated' 
	| 'systemPromptUpdated';

type ConfigViewInitialTextKey =
	| 'promptEnhancementAutoSend'
	| 'promptEnhancement'
	| 'enablePromptEnhancement'
	| 'promptEnhancementHelp'
	| 'promptEnhancementAutoSendHelp'
	| 'promptEnhancementProvider'
	| 'promptEnhancementModel';

const CONFIG_VIEW_MESSAGES: Record<string, Record<ConfigViewMessageKey, string>> = {
	en: {
		globalSettingsSaved: 'Global settings saved!',
		projectSettingsSaved: 'Project settings saved!',
		providerDeleted: 'Provider deleted successfully.',
		configExported: 'Configuration exported successfully.',
		configImported: 'Configuration imported successfully.',
		expertModeSettingsUpdated: 'Expert mode settings updated.',
		solutionProviderSettingsUpdated: 'Solution provider settings updated.',
		chatHistorySettingsUpdated: 'Chat history settings updated.',
		projectChatHistorySettingsUpdated: 'Project chat history settings updated.',
		systemPromptUpdated: 'System prompt updated.',
	},
	'zh-cn': {
		globalSettingsSaved: '全局设置已保存！',
		projectSettingsSaved: '项目设置已保存！',
		providerDeleted: '提供商删除成功。',
		configExported: '配置导出成功。',
		configImported: '配置导入成功。',
		expertModeSettingsUpdated: '专家模式设置已更新。',
		solutionProviderSettingsUpdated: '方案提供商设置已更新。',
		chatHistorySettingsUpdated: '聊天历史设置已更新。',
		projectChatHistorySettingsUpdated: '项目聊天历史设置已更新。',
		systemPromptUpdated: '系统提示词已更新。',
	},
	'zh-tw': {
		globalSettingsSaved: '全域設定已儲存！',
		projectSettingsSaved: '專案設定已儲存！',
		providerDeleted: '供應商刪除成功。',
		configExported: '組態匯出成功。',
		configImported: '組態匯入成功。',
		expertModeSettingsUpdated: '專家模式設定已更新。',
		solutionProviderSettingsUpdated: '方案供應商設定已更新。',
		chatHistorySettingsUpdated: '聊天紀錄設定已更新。',
		projectChatHistorySettingsUpdated: '專案聊天紀錄設定已更新。',
		systemPromptUpdated: '系統提示詞已更新。',
	},
	ko: {
		globalSettingsSaved: '전역 설정이 저장되었습니다!',
		projectSettingsSaved: '프로젝트 설정이 저장되었습니다!',
		providerDeleted: '공급자가 성공적으로 삭제되었습니다.',
		configExported: '구성이 성공적으로 내보내졌습니다.',
		configImported: '구성이 성공적으로 가져오기되었습니다.',
		expertModeSettingsUpdated: '전문가 모드 설정이 업데이트되었습니다.',
		solutionProviderSettingsUpdated: '솔루션 공급자 설정이 업데이트되었습니다.',
		chatHistorySettingsUpdated: '채팅 기록 설정이 업데이트되었습니다.',
		projectChatHistorySettingsUpdated: '프로젝트 채팅 기록 설정이 업데이트되었습니다.',
		systemPromptUpdated: '시스템 프롬프트가 업데이트되었습니다.',
	},
	ja: {
		globalSettingsSaved: 'グローバル設定を保存しました！',
		projectSettingsSaved: 'プロジェクト設定を保存しました！',
		providerDeleted: 'プロバイダーが正常に削除されました。',
		configExported: '構成が正常にエクスポートされました。',
		configImported: '構成が正常にインポートされました。',
		expertModeSettingsUpdated: 'エキスパートモード設定が更新されました。',
		solutionProviderSettingsUpdated: 'ソリューションプロバイダー設定が更新されました。',
		chatHistorySettingsUpdated: 'チャット履歴設定が更新されました。',
		projectChatHistorySettingsUpdated: 'プロジェクトチャット履歴設定が更新されました。',
		systemPromptUpdated: 'システムプロンプトが更新されました。',
	},
	fr: {
		globalSettingsSaved: 'Paramètres globaux enregistrés !',
		projectSettingsSaved: 'Paramètres du projet enregistrés !',
		providerDeleted: 'Fournisseur supprimé avec succès.',
		configExported: 'Configuration exportée avec succès.',
		configImported: 'Configuration importée avec succès.',
		expertModeSettingsUpdated: 'Paramètres du mode expert mis à jour.',
		solutionProviderSettingsUpdated: 'Paramètres du fournisseur de solutions mis à jour.',
		chatHistorySettingsUpdated: 'Paramètres de l\'historique de chat mis à jour.',
		projectChatHistorySettingsUpdated: 'Paramètres de l\'historique de chat du projet mis à jour.',
		systemPromptUpdated: 'Prompt système mis à jour.',
	},
	de: {
		globalSettingsSaved: 'Globale Einstellungen gespeichert!',
		projectSettingsSaved: 'Projekteinstellungen gespeichert!',
		providerDeleted: 'Anbieter erfolgreich gelöscht.',
		configExported: 'Konfiguration erfolgreich exportiert.',
		configImported: 'Konfiguration erfolgreich importiert.',
		expertModeSettingsUpdated: 'Expertenmodus-Einstellungen aktualisiert.',
		solutionProviderSettingsUpdated: 'Lösungsanbieter-Einstellungen aktualisiert.',
		chatHistorySettingsUpdated: 'Chatverlaufseinstellungen aktualisiert.',
		projectChatHistorySettingsUpdated: 'Projekt-Chatverlaufseinstellungen aktualisiert.',
		systemPromptUpdated: 'Systemprompt aktualisiert.',
	},
};

function getConfigViewMessage(language: string, key: ConfigViewMessageKey): string {
	return CONFIG_VIEW_MESSAGES[language]?.[key] || CONFIG_VIEW_MESSAGES.en[key];
}

const CONFIG_VIEW_INITIAL_TEXTS: Record<string, Record<ConfigViewInitialTextKey, string>> = {
	en: {
		promptEnhancement: 'Prompt Enhancement',
		enablePromptEnhancement: 'Enable Prompt Enhancement',
		promptEnhancementHelp: 'Automatically optimize prompts with a model before requests.',
		promptEnhancementAutoSend: 'Automatically submit optimized prompt',
		promptEnhancementAutoSendHelp: 'When enabled, the optimized prompt will be inserted and submitted automatically.',
		promptEnhancementProvider: 'Prompt Enhancement Provider',
		promptEnhancementModel: 'Prompt Enhancement Model',
	},
	'zh-cn': {
		promptEnhancement: '提示词优化',
		enablePromptEnhancement: '启用提示词优化',
		promptEnhancementHelp: '在请求之前使用模型对提示词进行自动优化。',
		promptEnhancementAutoSend: '自动提交优化后的提示词',
		promptEnhancementAutoSendHelp: '开启后，优化后的提示词会自动插入并提交。',
		promptEnhancementProvider: '提示词优化提供商',
		promptEnhancementModel: '提示词优化模型',
	},
	'zh-tw': {
		promptEnhancement: '提示詞最佳化',
		enablePromptEnhancement: '啟用提示詞最佳化',
		promptEnhancementHelp: '在請求之前使用模型自動最佳化提示詞。',
		promptEnhancementAutoSend: '自動提交最佳化後的提示詞',
		promptEnhancementAutoSendHelp: '開啟後，最佳化後的提示詞會自動插入並提交。',
		promptEnhancementProvider: '提示詞最佳化供應商',
		promptEnhancementModel: '提示詞最佳化模型',
	},
	ko: {
		promptEnhancement: '프롬프트 향상',
		enablePromptEnhancement: '프롬프트 향상 사용',
		promptEnhancementHelp: '요청 전에 모델로 프롬프트를 자동 최적화합니다.',
		promptEnhancementAutoSend: '최적화된 프롬프트 자동 제출',
		promptEnhancementAutoSendHelp: '사용하면 최적화된 프롬프트가 자동으로 삽입되고 제출됩니다.',
		promptEnhancementProvider: '프롬프트 향상 공급자',
		promptEnhancementModel: '프롬프트 향상 모델',
	},
	ja: {
		promptEnhancement: 'プロンプト強化',
		enablePromptEnhancement: 'プロンプト強化を有効化',
		promptEnhancementHelp: 'リクエスト前にモデルでプロンプトを自動最適化します。',
		promptEnhancementAutoSend: '最適化されたプロンプトを自動送信',
		promptEnhancementAutoSendHelp: '有効にすると、最適化されたプロンプトが自動で挿入され送信されます。',
		promptEnhancementProvider: 'プロンプト強化プロバイダー',
		promptEnhancementModel: 'プロンプト強化モデル',
	},
	fr: {
		promptEnhancement: 'Amélioration du prompt',
		enablePromptEnhancement: 'Activer l’amélioration du prompt',
		promptEnhancementHelp: 'Optimise automatiquement les prompts avec un modèle avant les requêtes.',
		promptEnhancementAutoSend: 'Soumettre automatiquement le prompt optimisé',
		promptEnhancementAutoSendHelp: 'Lorsque cette option est activée, le prompt optimisé sera inséré et soumis automatiquement.',
		promptEnhancementProvider: 'Fournisseur d’amélioration du prompt',
		promptEnhancementModel: 'Modèle d’amélioration du prompt',
	},
	de: {
		promptEnhancement: 'Prompt-Optimierung',
		enablePromptEnhancement: 'Prompt-Optimierung aktivieren',
		promptEnhancementHelp: 'Optimiert Prompts vor Anfragen automatisch mit einem Modell.',
		promptEnhancementAutoSend: 'Optimierten Prompt automatisch absenden',
		promptEnhancementAutoSendHelp: 'Wenn aktiviert, wird der optimierte Prompt automatisch eingefügt und gesendet.',
		promptEnhancementProvider: 'Prompt-Optimierungsanbieter',
		promptEnhancementModel: 'Prompt-Optimierungsmodell',
	},
};

function getConfigViewInitialText(language: string, key: ConfigViewInitialTextKey): string {
	return CONFIG_VIEW_INITIAL_TEXTS[language]?.[key] || CONFIG_VIEW_INITIAL_TEXTS.en[key];
}

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
			case 'getLanguageSettings':
				this._getWebview()?.postMessage({
					command: 'languageSettingsLoaded',
					data: {
						configuredLanguage: this._configManager.getConfiguredLanguage(),
						resolvedLanguage: this._configManager.getResolvedLanguage(),
						vscodeLanguage: vscode.env.language
					}
				});
				break;

			case 'updateLanguageSettings':
				try {
					const { language } = message.data as { language: 'auto' | 'en' | 'zh-cn' };
					await this._configManager.updateLanguage(language);
					this._getWebview()?.postMessage({
						command: 'languageSettingsLoaded',
						data: {
							configuredLanguage: this._configManager.getConfiguredLanguage(),
							resolvedLanguage: this._configManager.getResolvedLanguage(),
							vscodeLanguage: vscode.env.language
						}
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to update language settings: ${errorMessage}`);
				}
				break;

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
					const provider = message.data as { name: string; baseUrl: string; apiKey: string; apiType?: 'openai-compatible' | 'anthropic' | 'v1-response'; models?: any[]; autoFetchModels?: boolean };
					const apiType = provider.apiType || 'openai-compatible';
					const apiKey = provider.apiKey?.trim() || '';
					if (requiresApiKey(apiType) && !apiKey) {
						throw new Error('Anthropic provider requires an API key.');
					}
					
					// Use models from request if provided, otherwise fetch from API
					let models: any[] = provider.models || [];
					const shouldFetch = provider.autoFetchModels !== false && models.length === 0 && (!requiresApiKey(apiType) || !!apiKey);
					if (shouldFetch) {
						try {
							models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey);
						} catch (err) {
							// If fetch fails, allow provider to be added without models
						}
					}
					
					const newProvider = await this._configManager.addProvider({
						name: provider.name,
						baseUrl: provider.baseUrl,
						apiKey,
						apiType,
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
					const normalizedApiKey = apiKey?.trim() || '';
					
					// Get current provider to merge models
					const currentProvider = await this._configManager.getProvider(id);
					const currentModels = currentProvider?.models || [];
					const finalApiType = updates.apiType || currentProvider?.apiType || 'openai-compatible';
					const fetchApiKey = normalizedApiKey || currentProvider?.apiKey || '';
					if (requiresApiKey(finalApiType) && !normalizedApiKey && !currentProvider?.apiKey) {
						throw new Error('Anthropic provider requires an API key.');
					}
					
					// Use models from request if provided, otherwise fetch from API and merge
					if (updates.models && updates.models.length > 0) {
						// User provided models, use them
					} else if (updates.enabled !== false && updates.autoFetchModels !== false && (!requiresApiKey(finalApiType) || !!fetchApiKey)) {
						const baseUrl = updates.baseUrl || currentProvider?.baseUrl || '';
						if (baseUrl) {
							try {
								const models = await this._fetchModelsFromAPI(baseUrl, fetchApiKey, currentModels);
								updates.models = models;
							} catch (err) {
								// If fetch fails, keep existing models
								updates.models = currentModels;
							}
						}
					}
					
					// Only pass apiKey if it's provided (non-empty), otherwise keep existing key
					const updateData: any = { ...updates };
					if (normalizedApiKey) {
						updateData.apiKey = normalizedApiKey;
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
					
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'providerDeleted'));
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
						if (provider && provider.enabled) {
							const apiKey = await this._configManager.getApiKey(id);
							if (!requiresApiKey(provider.apiType) || !!apiKey.trim()) {
								try {
									const models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey.trim(), provider.models);
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
					if (provider && provider.enabled) {
						const apiKey = await this._configManager.getApiKey(id);
						if (!requiresApiKey(provider.apiType) || !!apiKey.trim()) {
							// Set loading state
							this._getWebview()?.postMessage({
								command: 'providerModelsLoading',
								data: { providerId: id, loading: true }
							});
							
							try {
								const models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey.trim(), provider.models);
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
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'configExported'));
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
					
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'configImported'));
				}
				break;

			case 'getChatHistorySettings':
				const settings = await this._configManager.getChatHistorySettings();
				this._getWebview()?.postMessage({
					command: 'chatHistorySettingsLoaded',
					data: settings
				});
				break;

			case 'getExpertModeSettings':
				try {
					const expertModeSettings = this._configManager.getEffectiveExpertModeConfig();
					const expertModeProviders = getExpertSelectableProviders(await this._configManager.getProviders());
					this._getWebview()?.postMessage({
						command: 'expertModeSettingsLoaded',
						data: {
							settings: expertModeSettings,
							globalSettings: this._configManager.getExpertModeConfig(),
							workspaceSettings: this._configManager.getWorkspaceExpertModeConfig(),
							providers: expertModeProviders,
						}
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to load expert mode settings: ${errorMessage}`);
				}
				break;

			case 'getSolutionProviderSettings':
				try {
					const solutionProviderSettings = this._configManager.getEffectiveSolutionProviderConfig();
					const solutionProviderProviders = getExpertSelectableProviders(await this._configManager.getProviders());
					this._getWebview()?.postMessage({
						command: 'solutionProviderSettingsLoaded',
						data: {
							settings: solutionProviderSettings,
							globalSettings: this._configManager.getSolutionProviderConfig(),
							workspaceSettings: this._configManager.getWorkspaceSolutionProviderConfig(),
							providers: solutionProviderProviders,
						}
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to load solution provider settings: ${errorMessage}`);
				}
				break;

			case 'updateExpertModeSettings':
				try {
					if ((message as any).panelMode) {
						return;
					}
					const { enabled, providerId, modelId } = message.data as { enabled: boolean; providerId: string; modelId: string };
					const updatedExpertModeSettings = await this._configManager.updateExpertModeConfig({ enabled, providerId, modelId });
					const expertModeProviders = getExpertSelectableProviders(await this._configManager.getProviders());
					this._getWebview()?.postMessage({
						command: 'expertModeSettingsLoaded',
						data: {
							settings: updatedExpertModeSettings,
							providers: expertModeProviders,
						},
						success: true
					});
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'expertModeSettingsUpdated'));
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to update expert mode settings: ${errorMessage}`);
				}
				break;

			case 'updateSolutionProviderSettings':
				try {
					if ((message as any).panelMode) {
						return;
					}
					const { enabled, providerId, modelId, reviewWithExpert } = message.data as { enabled: boolean; providerId: string; modelId: string; reviewWithExpert: boolean };
					const updatedSolutionProviderSettings = await this._configManager.updateSolutionProviderConfig({ enabled, providerId, modelId, reviewWithExpert });
					const solutionProviderProviders = getExpertSelectableProviders(await this._configManager.getProviders());
					this._getWebview()?.postMessage({
						command: 'solutionProviderSettingsLoaded',
						data: {
							settings: updatedSolutionProviderSettings,
							providers: solutionProviderProviders,
						},
						success: true
					});
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'solutionProviderSettingsUpdated'));
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to update solution provider settings: ${errorMessage}`);
				}
				break;

			case 'updateChatHistorySettings':
				try {
					if ((message as any).panelMode) {
						return;
					}
					const { enabled, savePath } = message.data as { enabled: boolean; savePath: string };
					const updatedSettings = await this._configManager.updateChatHistorySettings({ enabled, savePath });
					this._getWebview()?.postMessage({
						command: 'chatHistorySettingsLoaded',
						data: updatedSettings,
						success: true
					});
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'chatHistorySettingsUpdated'));
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

			case 'getProjectChatHistorySettings':
				try {
					const settings = await this._configManager.getProjectChatHistorySettings();
					this._getWebview()?.postMessage({
						command: 'projectChatHistorySettingsLoaded',
						data: settings
					});
				} catch (error: unknown) {
					this._getWebview()?.postMessage({
						command: 'projectChatHistorySettingsLoaded',
						data: { enabled: false, savePath: '' }
					});
				}
				break;

			case 'updateProjectChatHistorySettings':
				try {
					if ((message as any).panelMode) {
						return;
					}
					const { enabled, savePath } = message.data as { enabled: boolean; savePath: string };
					const updatedSettings = await this._configManager.updateProjectChatHistorySettings({ enabled, savePath });
					this._getWebview()?.postMessage({
						command: 'projectChatHistorySettingsLoaded',
						data: updatedSettings,
						success: true
					});
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'projectChatHistorySettingsUpdated'));
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to update project chat history settings: ${errorMessage}`);
					this._getWebview()?.postMessage({
						command: 'projectChatHistorySettingsLoaded',
						success: false,
						error: errorMessage
					});
				}
				break;

			case 'getSystemPrompt':
				try {
					const globalPrompt = this._configManager.getGlobalSystemPrompt();
					const workspacePrompt = this._configManager.getWorkspaceSystemPrompt();
					this._getWebview()?.postMessage({
						command: 'systemPromptLoaded',
						data: { globalPrompt, workspacePrompt }
					});
				} catch (error: unknown) {
					this._getWebview()?.postMessage({
						command: 'systemPromptLoaded',
						data: { globalPrompt: '', workspacePrompt: '' }
					});
				}
				break;

			case 'updateSystemPrompt':
				try {
					if ((message as any).panelMode) {
						return;
					}
					const { globalPrompt, workspacePrompt } = message.data as { globalPrompt: string; workspacePrompt: string };
					await this._configManager.updateGlobalSystemPrompt(globalPrompt);
					await this._configManager.updateWorkspaceSystemPrompt(workspacePrompt);
					this._getWebview()?.postMessage({
						command: 'systemPromptSaved',
						success: true
					});
					vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'systemPromptUpdated'));
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to update system prompt: ${errorMessage}`);
					this._getWebview()?.postMessage({
						command: 'systemPromptSaved',
						success: false,
						error: errorMessage
					});
				}
				break;

			case 'optimizeSystemPrompt':
				try {
					const { target, prompt, providerId, modelId } = message.data as { target: string; prompt: string; providerId?: string; modelId?: string };
					const language = this._configManager.getResolvedLanguage();
					const optimizedPrompt = await optimizePrompt(this._configManager, prompt || '', language, { providerId, modelId });
					this._getWebview()?.postMessage({
						command: 'systemPromptOptimized',
						data: { target, prompt: optimizedPrompt },
						success: true
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to optimize system prompt: ${errorMessage}`);
					this._getWebview()?.postMessage({
						command: 'systemPromptOptimized',
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

			case 'openGlobalSettingsTab':
				await ConfigViewPanel.openPanel(this._extensionUri, this._configManager, this._chatProvider, 'global');
				break;

			case 'openProjectSettingsTab':
				await ConfigViewPanel.openPanel(this._extensionUri, this._configManager, this._chatProvider, 'project');
				break;
		}
	}

	/**
	 * Fetch models from OpenAI-compatible API
	 * Merges API models with existing local models, preserving local customizations.
	 * If a model exists in both, local settings (vision/temperature/topP etc.) take precedence.
	 * If a model is only in API, it gets added with defaults.
	 * If a model is only local (not in API list), it gets removed to stay in sync with API.
	 */
	private async _fetchModelsFromAPI(baseUrl: string, apiKey: string, existingModels?: ConfigViewModel[]): Promise<ConfigViewModel[]> {
		const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		try {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			const normalizedApiKey = apiKey?.trim() || '';
			if (normalizedApiKey) {
				headers['Authorization'] = `Bearer ${normalizedApiKey}`;
			}
			const response = await fetch(`${normalizedBaseUrl}/models`, {
				method: 'GET',
				headers,
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
			contextLength: m.max_input_tokens !== undefined && m.max_input_tokens !== null ? m.max_input_tokens : null,
			maxTokens: m.max_output_tokens !== undefined && m.max_output_tokens !== null ? m.max_output_tokens : null,
			vision: (m.input_modalities && m.input_modalities.includes('image')) || false,
			toolCalling: (m.supported_parameters && m.supported_parameters.includes('tools')) ?? true,
			temperature: 0.7,
			topP: 1.0,
			samplingMode: 'both',
			isUserSelectable: undefined,
			preserveReasoningContent: false,
		})).filter((m: any) => m.modelId);

		const uniqueApiModels: ConfigViewModel[] = [];
		const seenModelIds = new Set<string>();
		for (const apiModel of apiModels) {
			const normalizedModelId = apiModel.modelId.trim();
			if (!normalizedModelId || seenModelIds.has(normalizedModelId)) {
				continue;
			}
			seenModelIds.add(normalizedModelId);
			uniqueApiModels.push({
				...apiModel,
				modelId: normalizedModelId,
			});
		}
		
		// If no existing models, return API models
		if (!existingModels || existingModels.length === 0) {
			return uniqueApiModels;
		}
		
		// Create a map of existing models by modelId
		const existingMap = new Map<string, ConfigViewModel>();
		for (const existing of existingModels) {
			const normalizedModelId = existing.modelId?.trim();
			if (normalizedModelId && !existingMap.has(normalizedModelId)) {
				existingMap.set(normalizedModelId, { ...existing, modelId: normalizedModelId });
			}
		}
		
		// Merge: start with API models, override with local customizations
		const merged: ConfigViewModel[] = [];
		
		// Add API models (use API data for fields that should stay synced, but preserve local customizations)
		for (const apiModel of uniqueApiModels) {
			const localModel = existingMap.get(apiModel.modelId);
			if (localModel) {
				// Use API data for fields that API provides, keep local values for missing fields
				// Preserve local vision/temperature/topP/samplingMode/isUserSelectable/transformThink/preserveReasoningContent
				merged.push({
					modelId: apiModel.modelId,
					displayName: apiModel.displayName,
					contextLength: apiModel.contextLength !== null ? apiModel.contextLength : localModel.contextLength,
					maxTokens: apiModel.maxTokens !== null ? apiModel.maxTokens : localModel.maxTokens,
					vision: typeof localModel.vision === 'boolean' ? localModel.vision : apiModel.vision,
					toolCalling: apiModel.toolCalling,
					temperature: localModel.temperature ?? 0.7,
					topP: localModel.topP ?? 1.0,
					samplingMode: localModel.samplingMode ?? 'both',
					isUserSelectable: localModel.isUserSelectable,
					transformThink: localModel.transformThink,
					preserveReasoningContent: localModel.preserveReasoningContent,
				});
			} else {
				merged.push({
					...apiModel,
					contextLength: apiModel.contextLength ?? 128000,
					maxTokens: apiModel.maxTokens ?? 16000,
				});
			}
		}
		
		// Remove local-only models that are not in API
		// When API returns a model list, only keep models that exist in the API list
		// (local models not in API are discarded)
		
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
			const apiKey = await this._configManager.getApiKey(provider.id);
			if (requiresApiKey(provider.apiType) && !apiKey.trim()) {
				continue;
			}
			
			try {
				const models = await this._fetchModelsFromAPI(provider.baseUrl, apiKey.trim(), provider.models);
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
		const vscodeLocale = this._configManager.getResolvedLanguage(); // e.g. 'zh-cn', 'en'

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
								<button id="importBtn" class="icon-btn" title="Import Configuration" data-i18n-title="importConfiguration">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 1h-7l-.5.5v4H1.5l-.5.5v8l.5.5h13l.5-.5v-8l-.5-.5H12V1.5l-.5-.5zM5 5V2h6v3H5zm9 9H2V6h3v1.5l.5.5h5l.5-.5V6h3v8z"/><path d="M6 10h4v1H6v-1z"/></svg>
									<span data-i18n="import"></span>
								</button>
								<button id="exportBtn" class="icon-btn" title="Export Configuration" data-i18n-title="exportConfiguration">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 1h-7l-.5.5v4H1.5l-.5.5v8l.5.5h13l.5-.5v-8l-.5-.5H12V1.5l-.5-.5zM5 5V2h6v3H5zm9 9H2V6h3v1.5l.5.5h5l.5-.5V6h3v8z"/><path d="M6 8h1v3h2V8h1L8 5.5 6 8z"/></svg>
									<span data-i18n="export"></span>
								</button>
							</div>
						</div>
						<p class="header-subtitle" data-i18n="subtitle"></p>
					</header>

					<!-- Settings Section (Unified) -->
					<section class="config-section settings-section">
						<div class="language-row">
							<label for="languageSelect" data-i18n="languageLabel"></label>
							<select id="languageSelect" class="language-select" aria-label="Language" data-i18n-aria-label="languageLabel">
								<option value="auto" data-i18n="languageAuto"></option>
								<option value="en" data-i18n="languageEnglish"></option>
								<option value="zh-cn" data-i18n="languageChinese">简体中文</option>
								<option value="zh-tw" data-i18n="languageTraditionalChinese">繁體中文</option>
								<option value="ko" data-i18n="languageKorean">한국어</option>
								<option value="ja" data-i18n="languageJapanese">日本語</option>
								<option value="fr" data-i18n="languageFrench">Français</option>
								<option value="de" data-i18n="languageGerman">Deutsch</option>
							</select>
						</div>
						<div class="settings-buttons-row">
							<button id="openGlobalSettingsBtn" class="primary-btn" data-i18n="globalSettings"></button>
							<button id="openProjectSettingsBtn" class="primary-btn" data-i18n="projectSettings"></button>
						</div>
						<div class="settings-hint" data-i18n="settingsHint"></div>
					</section>

					<section class="config-section providers-section">
						<div class="section-header">
							<div class="section-title-group">
								<svg class="section-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1H2.5L2 1.5V5l.5.5h1.639l.138.248 1.14 2.06-.638 2.148L4.5 10.5H3v3l.5.5h9l.5-.5v-3h-1.5l-.279-.544-.638-2.148 1.14-2.06.138-.248H13.5l.5-.5V1.5l-.5-.5zM13 5H3V2h10v3zm-2.621 5H5.621l.579-1.948-.758-1.37L4.5 5h7l-.942 1.682-.758 1.37L10.379 10zM12 13H4v-2h8v2z"/></svg>
								<h2 data-i18n="providers"></h2>
								<span class="provider-count" id="providerCount"></span>
							</div>
							<button id="addProviderBtn" class="primary-btn add-provider-btn">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>
								<span data-i18n="addProvider"></span>
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
							<h2 id="modalTitle" data-i18n="addProvider"></h2>
							<button id="closeModal" class="close-btn">&times;</button>
						</div>
						<form id="providerForm">
							<input type="hidden" id="providerId" />
							<div class="form-group">
								<label for="providerName" data-i18n="providerName"></label>
								<input type="text" id="providerName" placeholder="e.g., MyOpenAI, LocalLLM" data-i18n-placeholder="providerNamePlaceholder" required />
								<div class="help-text" data-i18n="providerNameHelp"></div>
							</div>
							<div class="form-group">
								<label for="providerApiType" data-i18n="apiType"></label>
								<select id="providerApiType">
									<option value="openai-compatible">OpenAI-Compatible</option>
									<option value="anthropic">Anthropic</option>
									<option value="v1-response">v1 Response</option>
								</select>
								<div class="help-text" data-i18n="apiTypeHelp">The API protocol used by this provider</div>
							</div>
							<div class="form-group">
								<label for="providerBaseUrl" data-i18n="baseUrl">Base URL</label>
								<input type="url" id="providerBaseUrl" placeholder="https://api.openai.com/v1" data-i18n-placeholder="baseUrlPlaceholder" required />
								<div class="help-text" data-i18n="baseUrlHelp">The API endpoint</div>
							</div>
							<div class="form-group">
								<label for="providerApiKey" data-i18n="apiKey">API Key</label>
								<input type="password" id="providerApiKey" placeholder="sk-..." data-i18n-placeholder="apiKeyPlaceholder" />
								<div class="help-text" data-i18n="apiKeyHelp">Leave empty to keep existing key (when editing)</div>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="providerAutoFetchModels" checked />
									<span data-i18n="autoFetchModels">Auto Fetch Models</span>
								</label>
								<div class="help-text" data-i18n="autoFetchModelsTitle">Automatically fetch models from API when settings open</div>
							</div>
							<div class="form-actions">
								<button type="button" id="cancelBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
								<button type="submit" class="primary-btn" data-i18n="saveProvider">Save Provider</button>
							</div>
						</form>
					</div>
				</div>

				<!-- Edit Model Modal -->
				<div id="editModelModal" class="modal">
					<div class="modal-content">
						<div class="modal-header">
							<h2 id="editModelTitle" data-i18n="editModel">Edit Model</h2>
							<button id="closeEditModelBtn" class="close-btn">&times;</button>
						</div>
						<div class="form-group">
							<label for="editModelName" data-i18n="modelId">Model ID</label>
							<input type="text" id="editModelName" placeholder="e.g., gpt-4o" data-i18n-placeholder="modelIdPlaceholder" required />
						</div>
						<div class="form-group">
							<label for="editModelDisplayName" data-i18n="displayName">Display Name</label>
							<input type="text" id="editModelDisplayName" placeholder="e.g., GPT-4o" data-i18n-placeholder="displayNamePlaceholder" />
						</div>
						<div class="form-row">
							<div class="form-group">
								<label for="editModelContextLength" data-i18n="contextLength">Context Length</label>
								<input type="number" id="editModelContextLength" value="128000" min="1" />
							</div>
							<div class="form-group">
								<label for="editModelMaxTokens" data-i18n="maxTokens">Max Tokens</label>
								<input type="number" id="editModelMaxTokens" value="16000" min="1" />
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelVision" />
									<span data-i18n="visionSupport">Vision Support</span>
								</label>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelToolCalling" />
									<span data-i18n="toolCalling">Tool Calling</span>
								</label>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelUserSelectable" />
									<span data-i18n="showInChatSelector">Show in Chat Selector</span>
								</label>
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelTransformThink" />
									<span data-i18n="transformThinkTags">Transform Think Tags (&lt;|im_start|&gt;/♩)</span>
								</label>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="editModelPreserveReasoningContent" />
									<span data-i18n="preserveReasoningContent">Preserve reasoning_content</span>
								</label>
								<div class="help-text" data-i18n="preserveReasoningContentHelp">For DeepSeek thinking mode. Cache and replay reasoning_content in later requests.</div>
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label for="editModelTemperature" data-i18n="temperature">Temperature</label>
								<input type="number" id="editModelTemperature" value="0.7" min="0" max="2" step="0.1" />
							</div>
							<div class="form-group">
								<label for="editModelTopP" data-i18n="topP">Top P</label>
								<input type="number" id="editModelTopP" value="1.0" min="0" max="1" step="0.1" />
							</div>
						</div>
						<div class="form-group">
							<label for="editModelSamplingMode" data-i18n="samplingMode">Sampling Mode</label>
							<select id="editModelSamplingMode">
								<option value="both" data-i18n="samplingBoth">Both (temperature + top_p)</option>
								<option value="temperature" data-i18n="samplingTemperature">Temperature only</option>
								<option value="top_p" data-i18n="samplingTopP">Top P only</option>
								<option value="none" data-i18n="samplingNone">None (do not pass)</option>
							</select>
							<div class="help-text" data-i18n="samplingHelp">Some models (e.g. Claude) only accept one sampling parameter at a time</div>
						</div>
						<div class="form-actions">
							<button type="button" id="cancelEditModelBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
							<button type="button" id="saveEditModelBtn" class="primary-btn" data-i18n="saveModel">Save Model</button>
						</div>
					</div>
				</div>

				<!-- Settings Modal -->
				<div id="settingsModal" class="modal">
					<div class="modal-content">
						<div class="modal-header">
							<h2 data-i18n="chatHistorySettings">Chat History Settings</h2>
							<button id="closeSettingsModal" class="close-btn">&times;</button>
						</div>
						<div class="form-group">
							<label class="checkbox-label">
								<input type="checkbox" id="chatHistoryEnabled" />
								<span data-i18n="autoSaveChatHistory">Auto Save Chat History</span>
							</label>
							<div class="help-text" data-i18n="chatHistoryHelp">Automatically save chat conversations to local files</div>
						</div>
						<div class="form-group">
							<label for="chatHistorySavePath" data-i18n="savePath">Save Path</label>
							<input type="text" id="chatHistorySavePath" placeholder="Path to save chat history" data-i18n-placeholder="savePathPlaceholder" />
							<div class="help-text" data-i18n="defaultSavePathHelp">Default: Windows: %APPDATA%/LLSOAI, macOS/Linux: ~/.LLSOAI</div>
						</div>
						<div class="form-actions">
							<button type="button" id="cancelSettingsBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
							<button type="button" id="saveSettingsBtn" class="primary-btn" data-i18n="save">Save</button>
						</div>
					</div>
				</div>

				<!-- System Prompt Modal -->
				<div id="systemPromptModal" class="modal">
					<div class="modal-content">
						<div class="modal-header">
							<h2 data-i18n="editSystemPrompt">Edit System Prompt</h2>
							<button id="closeSystemPromptModal" class="close-btn">&times;</button>
						</div>
						<div class="form-group">
						<label for="globalSystemPromptTextarea" data-i18n="globalSystemPrompt">Global System Prompt</label>
						<textarea id="globalSystemPromptTextarea" rows="6" placeholder="Enter global system prompt here..." data-i18n-placeholder="globalSystemPromptPlaceholder"></textarea>
							<div class="form-actions inline-actions">
								<button type="button" id="optimizeGlobalSystemPromptBtn" class="secondary-btn" data-i18n="optimizePrompt">Optimize</button>
							</div>
						<div class="help-text" data-i18n="globalSystemPromptHelp">Applied to all workspaces. Stored in global settings.</div>
					</div>
					<div class="form-group">
						<label for="workspaceSystemPromptTextarea" data-i18n="projectWorkspaceSystemPrompt">Project (Workspace) System Prompt</label>
						<textarea id="workspaceSystemPromptTextarea" rows="6" placeholder="Enter project-specific system prompt here..." data-i18n-placeholder="projectSystemPromptPlaceholder"></textarea>
							<div class="form-actions inline-actions">
								<button type="button" id="optimizeWorkspaceSystemPromptBtn" class="secondary-btn" data-i18n="optimizePrompt">Optimize</button>
							</div>
						<div class="help-text" data-i18n="projectSystemPromptHelp">Applied only to current workspace. Stored in workspace settings.</div>
						</div>
						<div class="form-actions">
							<button type="button" id="cancelSystemPromptBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
							<button type="button" id="saveSystemPromptBtn" class="primary-btn" data-i18n="save">Save</button>
						</div>
					</div>
				</div>

				<!-- Global Settings Modal (Unified) -->
				<div id="globalSettingsModal" class="modal">
					<div class="modal-content modal-large">
						<div class="modal-header">
							<h2 data-i18n="globalSettings"></h2>
							<button id="closeGlobalSettingsModal" class="close-btn">&times;</button>
						</div>
						
						<!-- Global System Prompt Section -->
						<div class="modal-section">
							<h3 data-i18n="globalSystemPrompt">Global System Prompt</h3>
							<div class="form-group">
								<textarea id="modalGlobalSystemPrompt" rows="6" placeholder="Enter global system prompt here..." data-i18n-placeholder="globalSystemPromptPlaceholder"></textarea>
								<div class="form-actions inline-actions">
									<button type="button" id="modalOptimizeGlobalSystemPromptBtn" class="secondary-btn" data-i18n="optimizePrompt">Optimize</button>
								</div>
								<div class="help-text" data-i18n="globalSystemPromptHelp">Applied to all workspaces. Stored in global settings.</div>
							</div>
						</div>
						
						<!-- Chat History Section -->
						<div class="modal-section">
							<h3 data-i18n="chatHistory">Chat History</h3>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="modalChatHistoryEnabled" />
									<span data-i18n="autoSaveChatHistory">Auto Save Chat History</span>
								</label>
								<div class="help-text" data-i18n="chatHistoryHelp">Automatically save chat conversations to local files</div>
							</div>
							<div class="form-group">
								<label for="modalChatHistorySavePath" data-i18n="savePath">Save Path</label>
								<input type="text" id="modalChatHistorySavePath" placeholder="Path to save chat history" data-i18n-placeholder="savePathPlaceholder" />
								<div class="help-text" data-i18n="defaultSavePathHelp">Default: Windows: %APPDATA%/LLSOAI, macOS/Linux: ~/.LLSOAI</div>
							</div>
						</div>
						
						<!-- Expert Mode Section -->
						<div class="modal-section">
							<h3 data-i18n="expertMode">Expert Mode</h3>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="modalExpertModeEnabled" />
									<span data-i18n="enableExpertMode">Enable Expert Mode</span>
								</label>
								<div class="help-text" data-i18n="expertModeHelp">When enabled, the main model can delegate difficult tasks to a selected expert model.</div>
							</div>
							<div class="form-row">
								<div class="form-group">
									<label for="modalExpertModeProvider" data-i18n="expertProvider">Expert Provider</label>
									<select id="modalExpertModeProvider"></select>
								</div>
								<div class="form-group">
									<label for="modalExpertModeModel" data-i18n="expertModel">Expert Model</label>
									<select id="modalExpertModeModel"></select>
								</div>
							</div>
						</div>

						<!-- Solution Provider Section -->
						<div class="modal-section">
							<h3 data-i18n="solutionProvider">Solution Provider</h3>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="modalSolutionProviderEnabled" />
									<span data-i18n="enableSolutionProvider">Enable Solution Provider</span>
								</label>
								<div class="help-text" data-i18n="solutionProviderHelp">When enabled, the main model can delegate solution design and implementation planning tasks to a selected solution model.</div>
							</div>
							<div class="form-row">
								<div class="form-group">
									<label for="modalSolutionProviderProvider" data-i18n="solutionProviderProvider">Solution Provider</label>
									<select id="modalSolutionProviderProvider"></select>
								</div>
								<div class="form-group">
									<label for="modalSolutionProviderModel" data-i18n="solutionProviderModel">Solution Model</label>
									<select id="modalSolutionProviderModel"></select>
								</div>
							</div>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="modalSolutionProviderReviewWithExpert" />
									<span data-i18n="solutionReviewWithExpert">Request expert review before finalizing</span>
								</label>
								<div class="help-text" data-i18n="solutionReviewWithExpertHelp">If expert mode is available, the solution model must call ask_llsoai at least once before finalizing.</div>
							</div>
						</div>

						<!-- Enhanced TODO Section -->
						<div class="modal-section">
							<h3 data-i18n="enhancedTodo">Enhanced TODO</h3>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="modalForceTodoEnabled" />
									<span data-i18n="enableEnhancedTodo">Enable Enhanced TODO</span>
								</label>
								<div class="help-text" data-i18n="enhancedTodoHelp">If enabled, will automatically save TODO items to project directory. When creating new TODO, will check for incomplete TODOs.</div>
							</div>
						</div>
						
						<!-- Copilot Records Section -->
						<div class="modal-section">
							<h3 data-i18n="copilotRecords">Copilot Records</h3>
							<div class="form-group">
								<div class="help-text" data-i18n="copilotRecordsHelp">Import/export chat records from VS Code Copilot</div>
							</div>
							<div class="form-actions">
								<button type="button" id="modalImportRecordsBtn" class="secondary-btn" data-i18n="importRecords">Import Records</button>
								<button type="button" id="modalExportRecordsBtn" class="secondary-btn" data-i18n="exportRecords">Export Records</button>
							</div>
						</div>
						
						<div class="form-actions">
							<button type="button" id="cancelGlobalSettingsBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
							<button type="button" id="saveGlobalSettingsBtn" class="primary-btn" data-i18n="saveAll">Save All</button>
						</div>
					</div>
				</div>

				<!-- Project Settings Modal -->
				<div id="projectSettingsModal" class="modal">
					<div class="modal-content">
						<div class="modal-header">
							<h2 data-i18n="projectSettings"></h2>
							<button id="closeProjectSettingsModal" class="close-btn">&times;</button>
						</div>
						<div class="modal-section">
							<h3 data-i18n="projectSystemPrompt">Project System Prompt</h3>
							<div class="form-group">
								<label class="checkbox-label">
									<input type="checkbox" id="modalProjectForceTodoEnabled" />
									<span data-i18n="enableEnhancedTodo">Enable Enhanced TODO</span>
								</label>
								<div class="help-text" data-i18n="enhancedTodoHelp">If enabled, will automatically save TODO items to project directory. When creating new TODO, will check for incomplete TODOs.</div>
							</div>
							<div class="form-group">
								<textarea id="modalProjectSystemPrompt" rows="8" placeholder="Enter project-specific system prompt here..." data-i18n-placeholder="projectSystemPromptPlaceholder"></textarea>
								<div class="form-actions inline-actions">
									<button type="button" id="modalOptimizeProjectSystemPromptBtn" class="secondary-btn" data-i18n="optimizePrompt">Optimize</button>
								</div>
								<div class="help-text" data-i18n="projectSystemPromptHelp">Applied only to current workspace. Stored in workspace settings.</div>
							</div>
						</div>
						<div class="form-actions">
							<button type="button" id="cancelProjectSettingsBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
							<button type="button" id="saveProjectSettingsBtn" class="primary-btn" data-i18n="save">Save</button>
						</div>
					</div>
				</div>

				<script nonce="${nonce}">window.VSCODE_LOCALE = '${vscodeLocale}';</script>
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

	/**
	 * Get default project chat history save path (project's .LLSOAI directory)
	 */
	private _getDefaultProjectSavePath(): string {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			// Use the first workspace folder's path
			const projectPath = workspaceFolders[0].uri.fsPath;
			const separator = process.platform === 'win32' ? '\\' : '/';
			return `${projectPath}${separator}.LLSOAI`;
		}
		// Fallback to global default if no workspace is open
		return this._getDefaultSavePath();
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

/**
 * ConfigViewPanel - Opens configuration in editor area as a WebviewPanel
 */
export class ConfigViewPanel {
	private static readonly viewType = 'openapicopilot.configPanel';
	private static _currentPanel: vscode.WebviewPanel | undefined;
	private static _extensionUri: vscode.Uri | undefined;
	private static _configManager: ConfigManager | undefined;
	private static _chatProvider: any | undefined;

	public static async openPanel(extensionUri: vscode.Uri, configManager: ConfigManager, chatProvider: any, mode: 'global' | 'project' = 'global') {
		const column = vscode.window.activeTextEditor?.viewColumn;

		this._extensionUri = extensionUri;
		this._configManager = configManager;
		this._chatProvider = chatProvider;

		// If we already have a panel, show it and navigate to the requested mode
		if (ConfigViewPanel._currentPanel) {
			ConfigViewPanel._currentPanel.reveal(column, true);
			// Update the webview content for the requested mode
			ConfigViewPanel._currentPanel.webview.html = await this._getHtmlForMode(mode);
			return;
		}

		// Create a new panel
		const panel = vscode.window.createWebviewPanel(
			ConfigViewPanel.viewType,
			'LLS OAI Settings',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'assets')]
			}
		);

		ConfigViewPanel._currentPanel = panel;

		// Set the HTML content
		panel.webview.html = await this._getHtmlForMode(mode);

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(async (message) => {
			await this._handleMessage(message);
		});

		// Clean up when the panel is closed
		panel.onDidDispose(() => {
			ConfigViewPanel._currentPanel = undefined;
		});
	}

	private static async _getHtmlForMode(mode: 'global' | 'project'): Promise<string> {
		if (!this._extensionUri || !this._configManager) {
			return '<html><body><p data-i18n="errorExtensionNotInitialized">Error: Extension not initialized</p></body></html>';
		}

		const webview = this._currentPanel!.webview;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'assets', 'configView', 'configView.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'assets', 'configView', 'configView.css'));
		const nonce = this._getNonce();
		const version = new Date().getTime();

		// Get current settings
		const settings = await this._getCurrentSettings();

		// Generate HTML based on mode
		const modalHtml = mode === 'global' ? this._getGlobalSettingsHtml(settings, nonce, scriptUri, styleUri, version) : this._getProjectSettingsHtml(settings, nonce, scriptUri, styleUri, version);

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource} data:;">
	<title>LLS OAI ${mode === 'global' ? 'Global' : 'Project'} Settings</title>
	<link href="${styleUri}?v=${version}" rel="stylesheet">
</head>
<body>
	<div class="config-view-container">
		${modalHtml}
	</div>

	<script nonce="${nonce}">window.VSCODE_LOCALE = '${this._configManager.getResolvedLanguage()}';</script>
	<script nonce="${nonce}" src="${scriptUri}?v=${version}"></script>
</body>
</html>`;
	}

	private static async _getCurrentSettings(): Promise<any> {
		if (!this._configManager) {
			return {};
		}

		const chatHistorySettings = await this._configManager.getChatHistorySettings();
		const projectChatHistorySettings = await this._configManager.getProjectChatHistorySettings();
		const expertModeSettings = this._configManager.getExpertModeConfig();
		const projectExpertModeSettings = this._configManager.getWorkspaceExpertModeConfig();
		const effectiveExpertModeSettings = this._configManager.getEffectiveExpertModeConfig();
		const solutionProviderSettings = this._configManager.getSolutionProviderConfig();
		const projectSolutionProviderSettings = this._configManager.getWorkspaceSolutionProviderConfig();
		const effectiveSolutionProviderSettings = this._configManager.getEffectiveSolutionProviderConfig();
		const promptEnhancementSettings = this._configManager.getPromptEnhancementConfig();
		const projectPromptEnhancementSettings = this._configManager.getWorkspacePromptEnhancementConfig();
		const effectivePromptEnhancementSettings = this._configManager.getEffectivePromptEnhancementConfig();
		const promptEnhancementContextCacheSettings = this._configManager.getGlobalPromptEnhancementContextCacheConfig();
		const projectPromptEnhancementContextCacheSettings = this._configManager.getWorkspacePromptEnhancementContextCacheConfig();
		const effectivePromptEnhancementContextCacheSettings = this._configManager.getEffectivePromptEnhancementContextCacheConfig();
		const providers = await this._configManager.getProviders();
		const globalSystemPrompt = this._configManager.getGlobalSystemPrompt() || '';
		const projectSystemPrompt = this._configManager.getWorkspaceSystemPrompt() || '';
		const globalForceTodoEnabled = this._configManager.getGlobalForceTodoEnabled();
		const projectForceTodoEnabled = this._configManager.getWorkspaceForceTodoEnabled();
		const expertProviders = getExpertSelectableProviders(providers);

		return {
			chatHistoryEnabled: chatHistorySettings.enabled,
			chatHistorySavePath: chatHistorySettings.savePath || this._getDefaultSavePath(),
			projectChatHistoryEnabled: projectChatHistorySettings.enabled,
			projectChatHistorySavePath: projectChatHistorySettings.savePath || this._getDefaultProjectSavePath(),
			expertModeSettings,
			projectExpertModeSettings,
			effectiveExpertModeSettings,
			solutionProviderSettings,
			projectSolutionProviderSettings,
			effectiveSolutionProviderSettings,
			promptEnhancementSettings,
			projectPromptEnhancementSettings,
			effectivePromptEnhancementSettings,
			promptEnhancementContextCacheSettings,
			projectPromptEnhancementContextCacheSettings,
			effectivePromptEnhancementContextCacheSettings,
			providers,
			expertProviders,
			globalSystemPrompt,
			projectSystemPrompt,
			globalForceTodoEnabled,
			projectForceTodoEnabled
		};
	}

	private static _getGlobalSettingsHtml(settings: any, nonce: string, scriptUri: vscode.Uri, styleUri: vscode.Uri, version: number): string {
		const escapedGlobalPrompt = (settings.globalSystemPrompt || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
		const expertProviders = settings.expertProviders || [];
		const selectedExpertProviderId = settings.expertModeSettings?.providerId || '';
		const selectedExpertProvider = expertProviders.find((provider: any) => provider.id === selectedExpertProviderId) || expertProviders[0];
		const selectedExpertModelId = settings.expertModeSettings?.modelId || '';
		const expertProviderOptions = [
			`<option value="" data-i18n="expertSelectProvider">Select provider</option>`,
			...expertProviders.map((provider: any) => `<option value="${this._escapeHtml(provider.id)}" ${provider.id === selectedExpertProviderId ? 'selected' : ''}>${this._escapeHtml(provider.name)}</option>`)
		].join('');
		const expertModelOptions = [
			`<option value="" data-i18n="expertSelectModel">Select model</option>`,
			...((selectedExpertProvider?.models || []) as any[]).map((model: any) => `<option value="${this._escapeHtml(model.modelId)}" ${model.modelId === selectedExpertModelId ? 'selected' : ''}>${this._escapeHtml(model.displayName || model.modelId)}</option>`)
		].join('');
		const selectedSolutionProviderId = settings.solutionProviderSettings?.providerId || '';
		const selectedSolutionProvider = selectedSolutionProviderId
			? expertProviders.find((provider: any) => provider.id === selectedSolutionProviderId)
			: undefined;
		const selectedSolutionModelId = settings.solutionProviderSettings?.modelId || '';
		const solutionProviderOptions = [
			`<option value="" data-i18n="solutionSelectProvider">Select provider</option>`,
			...expertProviders.map((provider: any) => `<option value="${this._escapeHtml(provider.id)}" ${provider.id === selectedSolutionProviderId ? 'selected' : ''}>${this._escapeHtml(provider.name)}</option>`)
		].join('');
		const solutionModelOptions = [
			`<option value="" data-i18n="solutionSelectModel">Select model</option>`,
			...((selectedSolutionProvider?.models || []) as any[]).map((model: any) => `<option value="${this._escapeHtml(model.modelId)}" ${model.modelId === selectedSolutionModelId ? 'selected' : ''}>${this._escapeHtml(model.displayName || model.modelId)}</option>`)
		].join('');
		const panelProvidersJson = JSON.stringify(expertProviders).replace(/</g, '\\u003c');
		const panelExpertModeSettingsJson = JSON.stringify(settings.expertModeSettings || { enabled: false, providerId: '', modelId: '' }).replace(/</g, '\\u003c');
		const panelSolutionProviderSettingsJson = JSON.stringify(settings.solutionProviderSettings || { enabled: false, providerId: '', modelId: '', reviewWithExpert: false }).replace(/</g, '\\u003c');
		const promptEnhancementSettings = settings.promptEnhancementSettings || { enabled: false, autoSend: false, providerId: '', modelId: '' };
		const promptEnhancementContextCacheSettings = settings.promptEnhancementContextCacheSettings || { contextMessageLimit: 20 };
		const resolvedLanguage = this._configManager?.getResolvedLanguage() || 'en';
		const promptEnhancementLabel = this._escapeHtml(getConfigViewInitialText(resolvedLanguage, 'promptEnhancement'));
		const enablePromptEnhancementLabel = this._escapeHtml(getConfigViewInitialText(resolvedLanguage, 'enablePromptEnhancement'));
		const promptEnhancementHelpText = this._escapeHtml(getConfigViewInitialText(resolvedLanguage, 'promptEnhancementHelp'));
		const promptEnhancementAutoSendLabel = this._escapeHtml(getConfigViewInitialText(resolvedLanguage, 'promptEnhancementAutoSend'));
		const promptEnhancementAutoSendHelpText = this._escapeHtml(getConfigViewInitialText(resolvedLanguage, 'promptEnhancementAutoSendHelp'));
		const promptEnhancementProviderLabel = this._escapeHtml(getConfigViewInitialText(resolvedLanguage, 'promptEnhancementProvider'));
		const promptEnhancementModelLabel = this._escapeHtml(getConfigViewInitialText(resolvedLanguage, 'promptEnhancementModel'));
		const panelPromptEnhancementSettingsJson = JSON.stringify(promptEnhancementSettings).replace(/</g, '\\u003c');
		const selectedPromptEnhancementProviderId = promptEnhancementSettings.providerId || '';
		const selectedPromptEnhancementProvider = selectedPromptEnhancementProviderId
			? expertProviders.find((provider: any) => provider.id === selectedPromptEnhancementProviderId)
			: undefined;
		const selectedPromptEnhancementModelId = promptEnhancementSettings.modelId || '';
		const promptEnhancementProviderOptions = [
			`<option value="" data-i18n="promptEnhancementSelectProvider">Select provider</option>`,
			...expertProviders.map((provider: any) => `<option value="${this._escapeHtml(provider.id)}" ${provider.id === selectedPromptEnhancementProviderId ? 'selected' : ''}>${this._escapeHtml(provider.name)}</option>`)
		].join('');
		const promptEnhancementModelOptions = [
			`<option value="" data-i18n="promptEnhancementSelectModel">Select model</option>`,
			...((selectedPromptEnhancementProvider?.models || []) as any[]).map((model: any) => `<option value="${this._escapeHtml(model.modelId)}" ${model.modelId === selectedPromptEnhancementModelId ? 'selected' : ''}>${this._escapeHtml(model.displayName || model.modelId)}</option>`)
		].join('');

		return `
			<div class="settings-panel-header">
				<h1 data-i18n="globalSettings"></h1>
			</div>

			<!-- Prompt Enhancement Section -->
			<section class="config-section">
				<h2 data-i18n="promptEnhancement">${promptEnhancementLabel}</h2>
				<div class="form-group">
				<label class="checkbox-label">
					<input type="checkbox" id="panelPromptEnhancementEnabled" ${promptEnhancementSettings.enabled ? 'checked' : ''} />
					<span data-i18n="enablePromptEnhancement">${enablePromptEnhancementLabel}</span>
				</label>
				<div class="help-text" data-i18n="promptEnhancementHelp">${promptEnhancementHelpText}</div>
				</div>
				<div class="form-group">
				<label class="checkbox-label">
					<input type="checkbox" id="panelPromptEnhancementAutoSend" ${promptEnhancementSettings.autoSend ? 'checked' : ''} />
					<span data-i18n="promptEnhancementAutoSend">${promptEnhancementAutoSendLabel}</span>
				</label>
				<div class="help-text" data-i18n="promptEnhancementAutoSendHelp">${promptEnhancementAutoSendHelpText}</div>
				</div>
				<div class="form-row">
				<div class="form-group">
					<label for="panelPromptEnhancementProvider" data-i18n="promptEnhancementProvider">${promptEnhancementProviderLabel}</label>
					<select id="panelPromptEnhancementProvider">${promptEnhancementProviderOptions}</select>
				</div>
				<div class="form-group">
					<label for="panelPromptEnhancementModel" data-i18n="promptEnhancementModel">${promptEnhancementModelLabel}</label>
					<select id="panelPromptEnhancementModel">${promptEnhancementModelOptions}</select>
				</div>
				</div>
				<div class="form-row">
				<div class="form-group">
					<label for="panelPromptEnhancementContextMessageLimit" data-i18n="promptEnhancementContextCacheMessages">Context Cache Messages</label>
					<input type="number" id="panelPromptEnhancementContextMessageLimit" min="0" max="200" value="${promptEnhancementContextCacheSettings.contextMessageLimit ?? 20}" />
					<div class="help-text" data-i18n="promptEnhancementContextCacheMessagesHelp">Number of recent messages saved to .LLSOAI/prompts for prompt optimization. 0 means unlimited by message count.</div>
				</div>
				</div>
			</section>

			<!-- Global System Prompt Section -->
			<section class="config-section">
				<h2 data-i18n="globalSystemPrompt">Global System Prompt</h2>
				<div class="form-group">
					<textarea id="panelGlobalSystemPrompt" rows="6" placeholder="Enter global system prompt here..." data-i18n-placeholder="globalSystemPromptPlaceholder">${settings.globalSystemPrompt || ''}</textarea>
					<div class="form-actions inline-actions">
						<button type="button" id="panelOptimizeGlobalSystemPromptBtn" class="secondary-btn" data-i18n="optimizePrompt">Optimize</button>
					</div>
					<div class="help-text" data-i18n="globalSystemPromptHelp">Applied to all workspaces. Stored in global settings.</div>
				</div>
			</section>


			<div class="global-settings-grid">
				<!-- Chat History Section -->
				<section class="config-section">
					<h2 data-i18n="chatHistory">Chat History</h2>
					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" id="panelChatHistoryEnabled" ${settings.chatHistoryEnabled ? 'checked' : ''} />
							<span data-i18n="autoSaveChatHistory">Auto Save Chat History</span>
						</label>
						<div class="help-text" data-i18n="chatHistoryHelp">Automatically save chat conversations to local files</div>
					</div>
					<div class="form-group">
						<label for="panelChatHistorySavePath" data-i18n="savePath">Save Path</label>
						<input type="text" id="panelChatHistorySavePath" value="${settings.chatHistorySavePath || this._getDefaultSavePath()}" />
						<div class="help-text" data-i18n="defaultSavePathHelp">Default: Windows: %APPDATA%/LLSOAI, macOS/Linux: ~/.LLSOAI</div>
					</div>
				</section>

				<!-- Expert Mode Section -->
				<section class="config-section">
					<h2 data-i18n="expertMode">Expert Mode</h2>
					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" id="panelExpertModeEnabled" ${settings.expertModeSettings?.enabled ? 'checked' : ''} />
							<span data-i18n="enableExpertMode">Enable Expert Mode</span>
						</label>
						<div class="help-text" data-i18n="expertModeHelp">When enabled, the main model can delegate difficult tasks to a selected expert model.</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label for="panelExpertModeProvider" data-i18n="expertProvider">Expert Provider</label>
							<select id="panelExpertModeProvider">${expertProviderOptions}</select>
						</div>
						<div class="form-group">
							<label for="panelExpertModeModel" data-i18n="expertModel">Expert Model</label>
							<select id="panelExpertModeModel">${expertModelOptions}</select>
						</div>
					</div>
				</section>

				<!-- Solution Provider Section -->
				<section class="config-section">
					<h2 data-i18n="solutionProvider">Solution Provider</h2>
					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" id="panelSolutionProviderEnabled" ${settings.solutionProviderSettings?.enabled ? 'checked' : ''} />
							<span data-i18n="enableSolutionProvider">Enable Solution Provider</span>
						</label>
						<div class="help-text" data-i18n="solutionProviderHelp">When enabled, the main model can delegate solution design and implementation planning tasks to a selected solution model.</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label for="panelSolutionProviderProvider" data-i18n="solutionProviderProvider">Solution Provider</label>
							<select id="panelSolutionProviderProvider">${solutionProviderOptions}</select>
						</div>
						<div class="form-group">
							<label for="panelSolutionProviderModel" data-i18n="solutionProviderModel">Solution Model</label>
							<select id="panelSolutionProviderModel">${solutionModelOptions}</select>
						</div>
					</div>
					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" id="panelSolutionProviderReviewWithExpert" ${settings.solutionProviderSettings?.reviewWithExpert ? 'checked' : ''} />
							<span data-i18n="solutionReviewWithExpert">Request expert review before finalizing</span>
						</label>
						<div class="help-text" data-i18n="solutionReviewWithExpertHelp">If expert mode is available, the solution model must call ask_llsoai at least once before finalizing.</div>
					</div>
				</section>

				<!-- Enhanced TODO Section -->
				<section class="config-section">
					<h2 data-i18n="enhancedTodo">Enhanced TODO</h2>
					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" id="panelForceTodoEnabled" ${settings.globalForceTodoEnabled ? 'checked' : ''} />
							<span data-i18n="enableEnhancedTodo">Enable Enhanced TODO</span>
						</label>
						<div class="help-text" data-i18n="enhancedTodoHelp">If enabled, will automatically save TODO items to project directory. When creating new TODO, will check for incomplete TODOs.</div>
					</div>
				</section>

				<!-- Copilot Records Section -->
				<section class="config-section">
					<h2 data-i18n="copilotRecords">Copilot Records</h2>
					<div class="form-group">
						<div class="help-text" data-i18n="copilotRecordsHelp">Import/export chat records from VS Code Copilot</div>
					</div>
					<div class="form-actions">
						<button type="button" id="panelImportRecordsBtn" class="secondary-btn" data-i18n="importRecords">Import Records</button>
						<button type="button" id="panelExportRecordsBtn" class="secondary-btn" data-i18n="exportRecords">Export Records</button>
					</div>
				</section>
			</div>

			<div class="form-actions sticky-footer">
				<button type="button" id="panelCancelBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
				<button type="button" id="panelSaveBtn" class="primary-btn" data-i18n="saveAll">Save All</button>
			</div>

			<script nonce="${nonce}">
				window.settingsMode = 'global';
				window.panelProviders = ${panelProvidersJson};
				window.panelExpertModeSettings = ${panelExpertModeSettingsJson};
				window.panelSolutionProviderSettings = ${panelSolutionProviderSettingsJson};
				window.panelPromptEnhancementSettings = ${panelPromptEnhancementSettingsJson};
			</script>
		`;
	}

	private static _escapeHtml(value: string): string {
		return String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	private static _getProjectSettingsHtml(settings: any, nonce: string, scriptUri: vscode.Uri, styleUri: vscode.Uri, version: number): string {
		const escapedProjectPrompt = (settings.projectSystemPrompt || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
		const expertProviders = settings.expertProviders || [];
		const projectExpertSettings = settings.projectExpertModeSettings || { enabled: false, enabledState: 'global', providerId: '', modelId: '' };
		const effectiveExpertSettings = settings.effectiveExpertModeSettings || settings.expertModeSettings || { enabled: false, providerId: '', modelId: '' };
		const projectSolutionSettings = settings.projectSolutionProviderSettings || { enabled: false, enabledState: 'global', providerId: '', modelId: '', reviewWithExpert: false, reviewWithExpertState: 'global' };
		const effectiveSolutionSettings = settings.effectiveSolutionProviderSettings || settings.solutionProviderSettings || { enabled: false, providerId: '', modelId: '', reviewWithExpert: false };
		const projectPromptEnhancementSettings = settings.projectPromptEnhancementSettings || { enabled: false, enabledState: 'global', autoSend: false, autoSendState: 'global', providerId: '', modelId: '' };
		const effectivePromptEnhancementSettings = settings.effectivePromptEnhancementSettings || settings.promptEnhancementSettings || { enabled: false, autoSend: false, providerId: '', modelId: '' };
		const projectPromptEnhancementContextCacheSettings = settings.projectPromptEnhancementContextCacheSettings || {};
		const effectivePromptEnhancementContextCacheSettings = settings.effectivePromptEnhancementContextCacheSettings || { contextMessageLimit: 20 };
		const enabledState = projectExpertSettings.enabledState === 'enabled' || projectExpertSettings.enabledState === 'disabled' ? projectExpertSettings.enabledState : 'global';
		const solutionEnabledState = projectSolutionSettings.enabledState === 'enabled' || projectSolutionSettings.enabledState === 'disabled' ? projectSolutionSettings.enabledState : 'global';
		const promptEnhancementEnabledState = projectPromptEnhancementSettings.enabledState === 'enabled' || projectPromptEnhancementSettings.enabledState === 'disabled' ? projectPromptEnhancementSettings.enabledState : 'global';
		const promptEnhancementAutoSendState = projectPromptEnhancementSettings.autoSendState === 'enabled' || projectPromptEnhancementSettings.autoSendState === 'disabled' ? projectPromptEnhancementSettings.autoSendState : 'global';
		const solutionReviewWithExpertState = projectSolutionSettings.reviewWithExpertState === 'enabled' || projectSolutionSettings.reviewWithExpertState === 'disabled' ? projectSolutionSettings.reviewWithExpertState : 'global';
		const solutionEffectiveReviewKey = effectiveSolutionSettings.reviewWithExpert ? 'enabled' : 'disabled';
		const selectedExpertProviderId = projectExpertSettings.providerId || '';
		const selectedExpertProvider = expertProviders.find((provider: any) => provider.id === selectedExpertProviderId);
		const selectedExpertModelId = projectExpertSettings.modelId || '';
		const effectiveExpertEnabledKey = effectiveExpertSettings.enabled ? 'enabled' : 'disabled';
		const effectiveProviderLabel = this._escapeHtml(effectiveExpertSettings.providerId || 'not set');
		const effectiveModelLabel = this._escapeHtml(effectiveExpertSettings.modelId || 'not set');
		const expertProviderOptions = [
			`<option value="" data-i18n-template="expertUseGlobalProvider" data-i18n-value-value="${effectiveProviderLabel}">Use global expert provider (${effectiveProviderLabel})</option>`,
			...expertProviders.map((provider: any) => `<option value="${this._escapeHtml(provider.id)}" ${provider.id === selectedExpertProviderId ? 'selected' : ''}>${this._escapeHtml(provider.name)}</option>`)
		].join('');
		const expertModelOptions = [
			`<option value="" data-i18n-template="expertUseGlobalModel" data-i18n-value-value="${effectiveModelLabel}">Use global expert model (${effectiveModelLabel})</option>`,
			...((selectedExpertProvider?.models || []) as any[]).map((model: any) => `<option value="${this._escapeHtml(model.modelId)}" ${model.modelId === selectedExpertModelId ? 'selected' : ''}>${this._escapeHtml(model.displayName || model.modelId)}</option>`)
		].join('');
		const panelProvidersJson = JSON.stringify(expertProviders).replace(/</g, '\\u003c');
		const panelExpertModeSettingsJson = JSON.stringify(projectExpertSettings).replace(/</g, '\\u003c');
		const selectedSolutionProviderId = projectSolutionSettings.providerId || '';
		const selectedSolutionProvider = expertProviders.find((provider: any) => provider.id === selectedSolutionProviderId);
		const selectedSolutionModelId = projectSolutionSettings.modelId || '';
		const effectiveSolutionProviderLabel = this._escapeHtml(effectiveSolutionSettings.providerId || 'not set');
		const effectiveSolutionModelLabel = this._escapeHtml(effectiveSolutionSettings.modelId || 'not set');
		const solutionEffectiveEnabledKey = effectiveSolutionSettings.enabled ? 'enabled' : 'disabled';
		const solutionProviderOptions = [
			`<option value="" data-i18n-template="solutionUseGlobalProvider" data-i18n-value-value="${effectiveSolutionProviderLabel}">Use global solution provider (${effectiveSolutionProviderLabel})</option>`,
			...expertProviders.map((provider: any) => `<option value="${this._escapeHtml(provider.id)}" ${provider.id === selectedSolutionProviderId ? 'selected' : ''}>${this._escapeHtml(provider.name)}</option>`)
		].join('');
		const solutionModelOptions = [
			`<option value="" data-i18n-template="solutionUseGlobalModel" data-i18n-value-value="${effectiveSolutionModelLabel}">Use global solution model (${effectiveSolutionModelLabel})</option>`,
			...((selectedSolutionProvider?.models || []) as any[]).map((model: any) => `<option value="${this._escapeHtml(model.modelId)}" ${model.modelId === selectedSolutionModelId ? 'selected' : ''}>${this._escapeHtml(model.displayName || model.modelId)}</option>`)
		].join('');
		const panelSolutionProviderSettingsJson = JSON.stringify(projectSolutionSettings).replace(/</g, '\\u003c');
		const selectedPromptEnhancementProviderId = projectPromptEnhancementSettings.providerId || '';
		const selectedPromptEnhancementProvider = expertProviders.find((provider: any) => provider.id === selectedPromptEnhancementProviderId);
		const selectedPromptEnhancementModelId = projectPromptEnhancementSettings.modelId || '';
		const effectivePromptEnhancementProviderLabel = this._escapeHtml(effectivePromptEnhancementSettings.providerId || 'not set');
		const effectivePromptEnhancementModelLabel = this._escapeHtml(effectivePromptEnhancementSettings.modelId || 'not set');
		const promptEnhancementEffectiveEnabledKey = effectivePromptEnhancementSettings.enabled ? 'enabled' : 'disabled';
		const promptEnhancementEffectiveAutoSendKey = effectivePromptEnhancementSettings.autoSend ? 'enabled' : 'disabled';
		const promptEnhancementProviderOptions = [
			`<option value="" data-i18n-template="promptEnhancementUseGlobalProvider" data-i18n-value-value="${effectivePromptEnhancementProviderLabel}">Use global prompt enhancement provider (${effectivePromptEnhancementProviderLabel})</option>`,
			...expertProviders.map((provider: any) => `<option value="${this._escapeHtml(provider.id)}" ${provider.id === selectedPromptEnhancementProviderId ? 'selected' : ''}>${this._escapeHtml(provider.name)}</option>`)
		].join('');
		const promptEnhancementModelOptions = [
			`<option value="" data-i18n-template="promptEnhancementUseGlobalModel" data-i18n-value-value="${effectivePromptEnhancementModelLabel}">Use global prompt enhancement model (${effectivePromptEnhancementModelLabel})</option>`,
			...((selectedPromptEnhancementProvider?.models || []) as any[]).map((model: any) => `<option value="${this._escapeHtml(model.modelId)}" ${model.modelId === selectedPromptEnhancementModelId ? 'selected' : ''}>${this._escapeHtml(model.displayName || model.modelId)}</option>`)
		].join('');
		const panelPromptEnhancementSettingsJson = JSON.stringify(projectPromptEnhancementSettings).replace(/</g, '\\u003c');
		const projectPromptContextLimitValue = projectPromptEnhancementContextCacheSettings.contextMessageLimit === undefined ? '' : projectPromptEnhancementContextCacheSettings.contextMessageLimit;

		return `
			<div class="settings-panel-header">
				<h1 data-i18n="projectSettings"></h1>
			</div>

			<!-- Project Prompt Enhancement Section -->
			<section class="config-section expert-settings-card">
				<div class="expert-settings-header">
					<div>
						<h2 data-i18n="promptEnhancement">Prompt Enhancement</h2>
						<p data-i18n="promptEnhancementProjectDescription">Configure how this project uses the prompt enhancement model.</p>
					</div>
					<span class="expert-status-pill ${effectivePromptEnhancementSettings.enabled ? 'enabled' : 'disabled'}" data-i18n-template="promptEnhancementGlobalStatus" data-i18n-key-state="${promptEnhancementEffectiveEnabledKey}">Global ${effectivePromptEnhancementSettings.enabled ? 'Enabled' : 'Disabled'}</span>
				</div>
				<div class="expert-state-options">
					<label class="expert-state-option ${promptEnhancementEnabledState === 'global' ? 'selected' : ''}">
						<input type="radio" name="panelPromptEnhancementEnabledState" value="global" ${promptEnhancementEnabledState === 'global' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="promptEnhancementUseGlobal">Use global</span>
						<span class="expert-state-desc" data-i18n-template="promptEnhancementFollowGlobalState" data-i18n-key-state="${promptEnhancementEffectiveEnabledKey}">Follow global state: ${effectivePromptEnhancementSettings.enabled ? 'enabled' : 'disabled'}</span>
					</label>
					<label class="expert-state-option ${promptEnhancementEnabledState === 'enabled' ? 'selected' : ''}">
						<input type="radio" name="panelPromptEnhancementEnabledState" value="enabled" ${promptEnhancementEnabledState === 'enabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="enabled">Enabled</span>
						<span class="expert-state-desc" data-i18n="promptEnhancementForceEnabledDesc">Force prompt enhancement on for this project.</span>
					</label>
					<label class="expert-state-option ${promptEnhancementEnabledState === 'disabled' ? 'selected' : ''}">
						<input type="radio" name="panelPromptEnhancementEnabledState" value="disabled" ${promptEnhancementEnabledState === 'disabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="disabled">Disabled</span>
						<span class="expert-state-desc" data-i18n="promptEnhancementForceDisabledDesc">Force prompt enhancement off for this project.</span>
					</label>
				</div>
				<div class="expert-model-grid">
					<div class="form-group">
						<label for="panelPromptEnhancementProvider" data-i18n="promptEnhancementProvider">Prompt Enhancement Provider</label>
						<select id="panelPromptEnhancementProvider" data-placeholder-key="promptEnhancementUseGlobalProvider" data-placeholder-value="${effectivePromptEnhancementProviderLabel}">${promptEnhancementProviderOptions}</select>
					</div>
					<div class="form-group">
						<label for="panelPromptEnhancementModel" data-i18n="promptEnhancementModel">Prompt Enhancement Model</label>
						<select id="panelPromptEnhancementModel" data-placeholder-key="promptEnhancementUseGlobalModel" data-placeholder-value="${effectivePromptEnhancementModelLabel}">${promptEnhancementModelOptions}</select>
					</div>
				</div>
				<div class="help-text" data-i18n="promptEnhancementModelOverrideHelp">Select both provider and model to override the global prompt enhancement model. Leave either empty to keep using the global prompt enhancement model.</div>
				<div class="expert-review-options">
					<label class="expert-state-option ${promptEnhancementAutoSendState === 'global' ? 'selected' : ''}">
						<input type="radio" name="panelPromptEnhancementAutoSendState" value="global" ${promptEnhancementAutoSendState === 'global' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="promptEnhancementAutoSendUseGlobal">Use global</span>
						<span class="expert-state-desc" data-i18n-template="promptEnhancementAutoSendFollowGlobalState" data-i18n-key-state="${promptEnhancementEffectiveAutoSendKey}">Follow global auto-submit: ${effectivePromptEnhancementSettings.autoSend ? 'enabled' : 'disabled'}</span>
					</label>
					<label class="expert-state-option ${promptEnhancementAutoSendState === 'enabled' ? 'selected' : ''}">
						<input type="radio" name="panelPromptEnhancementAutoSendState" value="enabled" ${promptEnhancementAutoSendState === 'enabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="enabled">Enabled</span>
						<span class="expert-state-desc" data-i18n="promptEnhancementAutoSendForceEnabledDesc">Force auto-submit optimized prompts on for this project.</span>
					</label>
					<label class="expert-state-option ${promptEnhancementAutoSendState === 'disabled' ? 'selected' : ''}">
						<input type="radio" name="panelPromptEnhancementAutoSendState" value="disabled" ${promptEnhancementAutoSendState === 'disabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="disabled">Disabled</span>
						<span class="expert-state-desc" data-i18n="promptEnhancementAutoSendForceDisabledDesc">Force auto-submit optimized prompts off for this project.</span>
					</label>
				</div>
				<div class="expert-model-grid">
					<div class="form-group">
						<label for="panelPromptEnhancementContextMessageLimit" data-i18n="promptEnhancementContextCacheMessages">Context Cache Messages</label>
						<input type="number" id="panelPromptEnhancementContextMessageLimit" min="0" max="200" value="${projectPromptContextLimitValue}" placeholder="Use global (${effectivePromptEnhancementContextCacheSettings.contextMessageLimit})" data-i18n-placeholder-template="promptEnhancementContextUseGlobal" data-i18n-placeholder-value-value="${effectivePromptEnhancementContextCacheSettings.contextMessageLimit}" />
						<div class="help-text" data-i18n="promptEnhancementContextCacheMessagesHelp">Number of recent messages saved to .LLSOAI/prompts for prompt optimization. 0 means unlimited by message count.</div>
					</div>
				</div>
			</section>

			<!-- Project System Prompt Section -->
			<section class="config-section">
				<h2 data-i18n="projectSystemPrompt">Project System Prompt</h2>
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" id="panelProjectForceTodoEnabled" ${settings.projectForceTodoEnabled ? 'checked' : ''} />
						<span data-i18n="enableEnhancedTodo">Enable Enhanced TODO</span>
					</label>
					<div class="help-text" data-i18n="enhancedTodoHelp">If enabled, will automatically save TODO items to project directory. When creating new TODO, will check for incomplete TODOs.</div>
				</div>
				<div class="form-group">
					<textarea id="panelProjectSystemPrompt" rows="8" placeholder="Enter project-specific system prompt here..." data-i18n-placeholder="projectSystemPromptPlaceholder">${settings.projectSystemPrompt || ''}</textarea>
					<div class="form-actions inline-actions">
						<button type="button" id="panelOptimizeProjectSystemPromptBtn" class="secondary-btn" data-i18n="optimizePrompt">Optimize</button>
					</div>
					<div class="help-text" data-i18n="projectSystemPromptHelp">Applied only to current workspace. Stored in workspace settings.</div>
				</div>
			</section>

			<!-- Project Chat History Section -->
			<section class="config-section">
				<h2 data-i18n="chatHistory">Chat History</h2>
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" id="panelProjectChatHistoryEnabled" ${settings.projectChatHistoryEnabled ? 'checked' : ''} />
						<span data-i18n="saveChatHistory">Save Chat History</span>
					</label>
					<div class="help-text" data-i18n="chatHistoryHelp">If enabled, chat history will be saved to the project directory.</div>
				</div>
				<div class="form-group">
					<label for="panelProjectChatHistorySavePath" data-i18n="chatHistorySavePath">Save Path</label>
					<input type="text" id="panelProjectChatHistorySavePath" value="${settings.projectChatHistorySavePath || this._getDefaultProjectSavePath()}" />
					<div class="help-text" data-i18n="chatHistorySavePathHelp">Directory to save chat history. Defaults to project's .LLSOAI folder.</div>
				</div>
			</section>


			<!-- Project Expert Mode Section -->
			<section class="config-section expert-settings-card">
				<div class="expert-settings-header">
					<div>
						<h2 data-i18n="expertMode">Expert Mode</h2>
						<p data-i18n="expertProjectDescription">Configure how this project uses the LLSOAI expert model.</p>
					</div>
					<span class="expert-status-pill ${effectiveExpertSettings.enabled ? 'enabled' : 'disabled'}" data-i18n-template="expertGlobalStatus" data-i18n-key-state="${effectiveExpertEnabledKey}">Global ${effectiveExpertSettings.enabled ? 'Enabled' : 'Disabled'}</span>
				</div>
				<div class="expert-state-options">
					<label class="expert-state-option ${enabledState === 'global' ? 'selected' : ''}">
						<input type="radio" name="panelExpertModeEnabledState" value="global" ${enabledState === 'global' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="expertUseGlobal">Use global</span>
						<span class="expert-state-desc" data-i18n-template="expertFollowGlobalState" data-i18n-key-state="${effectiveExpertEnabledKey}">Follow global state: ${effectiveExpertSettings.enabled ? 'enabled' : 'disabled'}</span>
					</label>
					<label class="expert-state-option ${enabledState === 'enabled' ? 'selected' : ''}">
						<input type="radio" name="panelExpertModeEnabledState" value="enabled" ${enabledState === 'enabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="enabled">Enabled</span>
						<span class="expert-state-desc" data-i18n="expertForceEnabledDesc">Force expert mode on for this project.</span>
					</label>
					<label class="expert-state-option ${enabledState === 'disabled' ? 'selected' : ''}">
						<input type="radio" name="panelExpertModeEnabledState" value="disabled" ${enabledState === 'disabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="disabled">Disabled</span>
						<span class="expert-state-desc" data-i18n="expertForceDisabledDesc">Force expert mode off for this project.</span>
					</label>
				</div>
				<div class="expert-model-grid">
					<div class="form-group">
						<label for="panelExpertModeProvider" data-i18n="expertProvider">Expert Provider</label>
						<select id="panelExpertModeProvider" data-placeholder-key="expertUseGlobalProvider" data-placeholder-value="${effectiveProviderLabel}">${expertProviderOptions}</select>
					</div>
					<div class="form-group">
						<label for="panelExpertModeModel" data-i18n="expertModel">Expert Model</label>
						<select id="panelExpertModeModel" data-placeholder-key="expertUseGlobalModel" data-placeholder-value="${effectiveModelLabel}">${expertModelOptions}</select>
					</div>
				</div>
				<div class="help-text" data-i18n="expertModelOverrideHelp">Select both provider and model to override the global expert model. Leave either empty to keep using the global expert model.</div>
			</section>

			<!-- Project Solution Provider Section -->
			<section class="config-section expert-settings-card">
				<div class="expert-settings-header">
					<div>
						<h2 data-i18n="solutionProvider">Solution Provider</h2>
						<p data-i18n="solutionProjectDescription">Configure how this project uses the LLSOAI solution provider model.</p>
					</div>
					<span class="expert-status-pill ${effectiveSolutionSettings.enabled ? 'enabled' : 'disabled'}" data-i18n-template="solutionGlobalStatus" data-i18n-key-state="${solutionEffectiveEnabledKey}">Global ${effectiveSolutionSettings.enabled ? 'Enabled' : 'Disabled'}</span>
				</div>
				<div class="expert-state-options">
					<label class="expert-state-option ${solutionEnabledState === 'global' ? 'selected' : ''}">
						<input type="radio" name="panelSolutionProviderEnabledState" value="global" ${solutionEnabledState === 'global' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="expertUseGlobal">Use global</span>
						<span class="expert-state-desc" data-i18n-template="solutionFollowGlobalState" data-i18n-key-state="${solutionEffectiveEnabledKey}">Follow global state: ${effectiveSolutionSettings.enabled ? 'enabled' : 'disabled'}</span>
					</label>
					<label class="expert-state-option ${solutionEnabledState === 'enabled' ? 'selected' : ''}">
						<input type="radio" name="panelSolutionProviderEnabledState" value="enabled" ${solutionEnabledState === 'enabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="enabled">Enabled</span>
						<span class="expert-state-desc" data-i18n="solutionForceEnabledDesc">Force solution provider on for this project.</span>
					</label>
					<label class="expert-state-option ${solutionEnabledState === 'disabled' ? 'selected' : ''}">
						<input type="radio" name="panelSolutionProviderEnabledState" value="disabled" ${solutionEnabledState === 'disabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="disabled">Disabled</span>
						<span class="expert-state-desc" data-i18n="solutionForceDisabledDesc">Force solution provider off for this project.</span>
					</label>
				</div>
				<div class="expert-model-grid">
					<div class="form-group">
						<label for="panelSolutionProviderProvider" data-i18n="solutionProviderProvider">Solution Provider</label>
						<select id="panelSolutionProviderProvider" data-placeholder-key="solutionUseGlobalProvider" data-placeholder-value="${effectiveSolutionProviderLabel}">${solutionProviderOptions}</select>
					</div>
					<div class="form-group">
						<label for="panelSolutionProviderModel" data-i18n="solutionProviderModel">Solution Model</label>
						<select id="panelSolutionProviderModel" data-placeholder-key="solutionUseGlobalModel" data-placeholder-value="${effectiveSolutionModelLabel}">${solutionModelOptions}</select>
					</div>
				</div>
				<div class="expert-review-options">
					<label class="expert-state-option ${solutionReviewWithExpertState === 'global' ? 'selected' : ''}">
						<input type="radio" name="panelSolutionProviderReviewWithExpertState" value="global" ${solutionReviewWithExpertState === 'global' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="solutionReviewUseGlobal">Use global</span>
						<span class="expert-state-desc" data-i18n-template="solutionFollowGlobalReviewState" data-i18n-key-state="${solutionEffectiveReviewKey}">Follow global: ${effectiveSolutionSettings.reviewWithExpert ? 'enabled' : 'disabled'}</span>
					</label>
					<label class="expert-state-option ${solutionReviewWithExpertState === 'enabled' ? 'selected' : ''}">
						<input type="radio" name="panelSolutionProviderReviewWithExpertState" value="enabled" ${solutionReviewWithExpertState === 'enabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="enabled">Enabled</span>
						<span class="expert-state-desc" data-i18n="solutionReviewForceEnabledDesc">Force expert review on for this project.</span>
					</label>
					<label class="expert-state-option ${solutionReviewWithExpertState === 'disabled' ? 'selected' : ''}">
						<input type="radio" name="panelSolutionProviderReviewWithExpertState" value="disabled" ${solutionReviewWithExpertState === 'disabled' ? 'checked' : ''} />
						<span class="expert-state-title" data-i18n="disabled">Disabled</span>
						<span class="expert-state-desc" data-i18n="solutionReviewForceDisabledDesc">Force expert review off for this project.</span>
					</label>
				</div>
				<div class="help-text" data-i18n="solutionReviewWithExpertHelp">When enabled and expert mode is available, the solution model must call ask_llsoai at least once before finalizing.</div>
				<div class="help-text" data-i18n="solutionModelOverrideHelp">Select both provider and model to override the global solution model. Leave either empty to keep using the global solution model.</div>
			</section>

			<div class="form-actions sticky-footer">
				<button type="button" id="panelCancelBtn" class="secondary-btn" data-i18n="cancel">Cancel</button>
				<button type="button" id="panelSaveBtn" class="primary-btn" data-i18n="save">Save</button>
			</div>

			<script nonce="${nonce}">
				window.settingsMode = 'project';
				window.panelProviders = ${panelProvidersJson};
				window.panelExpertModeSettings = ${panelExpertModeSettingsJson};
				window.panelSolutionProviderSettings = ${panelSolutionProviderSettingsJson};
				window.panelPromptEnhancementSettings = ${panelPromptEnhancementSettingsJson};
			</script>
		`;
	}

	private static async _handleMessage(message: any): Promise<void> {
		if (!this._configManager) {
			return;
		}

		const { command, data } = message;
		const isPanelModeMessage = !!message.panelMode;

		switch (command) {
			case 'getLanguageSettings':
				if (!isPanelModeMessage) {
					return;
				}
				this._currentPanel?.webview.postMessage({
					command: 'languageSettingsLoaded',
					data: {
						configuredLanguage: this._configManager.getConfiguredLanguage(),
						resolvedLanguage: this._configManager.getResolvedLanguage(),
						vscodeLanguage: vscode.env.language
					}
				});
				break;

			case 'updateLanguageSettings':
				if (!isPanelModeMessage) {
					return;
				}
				await this._configManager.updateLanguage(data?.language);
				this._currentPanel?.webview.postMessage({
					command: 'languageSettingsLoaded',
					data: {
						configuredLanguage: this._configManager.getConfiguredLanguage(),
						resolvedLanguage: this._configManager.getResolvedLanguage(),
						vscodeLanguage: vscode.env.language
					}
				});
				break;

			case 'getChatHistorySettings':
				if (!isPanelModeMessage) {
					return;
				}
				const settings = await this._configManager.getChatHistorySettings();
				this._currentPanel?.webview.postMessage({
					command: 'chatHistorySettingsLoaded',
					data: settings
				});
				break;

			case 'getProjectChatHistorySettings':
				if (!isPanelModeMessage) {
					return;
				}
				const projectChatHistorySettings = await this._configManager.getProjectChatHistorySettings();
				this._currentPanel?.webview.postMessage({
					command: 'projectChatHistorySettingsLoaded',
					data: projectChatHistorySettings
				});
				break;

			case 'getExpertModeSettings':
				if (!isPanelModeMessage) {
					return;
				}
				const expertModeProviders = getExpertSelectableProviders(await this._configManager.getProviders());
				this._currentPanel?.webview.postMessage({
					command: 'expertModeSettingsLoaded',
					data: {
						settings: this._configManager.getEffectiveExpertModeConfig(),
						globalSettings: this._configManager.getExpertModeConfig(),
						workspaceSettings: this._configManager.getWorkspaceExpertModeConfig(),
						providers: expertModeProviders,
					}
				});
				break;

			case 'getSolutionProviderSettings':
				if (!isPanelModeMessage) {
					return;
				}
				const solutionProviderProviders = getExpertSelectableProviders(await this._configManager.getProviders());
				this._currentPanel?.webview.postMessage({
					command: 'solutionProviderSettingsLoaded',
					data: {
						settings: this._configManager.getEffectiveSolutionProviderConfig(),
						globalSettings: this._configManager.getSolutionProviderConfig(),
						workspaceSettings: this._configManager.getWorkspaceSolutionProviderConfig(),
						providers: solutionProviderProviders,
					}
				});
				break;

			case 'getSystemPrompt':
				if (!isPanelModeMessage) {
					return;
				}
				const globalPrompt = this._configManager.getGlobalSystemPrompt();
				const workspacePrompt = this._configManager.getWorkspaceSystemPrompt();
				this._currentPanel?.webview.postMessage({
					command: 'systemPromptLoaded',
					data: { globalPrompt, workspacePrompt }
				});
				break;

			case 'optimizeSystemPrompt': {
				const { target, prompt, providerId, modelId } = data as { target: string; prompt: string; providerId?: string; modelId?: string };
				try {
					const language = this._configManager.getResolvedLanguage();
					const optimizedPrompt = await optimizePrompt(this._configManager, prompt || '', language, { providerId, modelId });
					this._currentPanel?.webview.postMessage({
						command: 'systemPromptOptimized',
						data: { target, prompt: optimizedPrompt },
						success: true
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to optimize system prompt: ${errorMessage}`);
					this._currentPanel?.webview.postMessage({
						command: 'systemPromptOptimized',
						success: false,
						error: errorMessage
					});
				}
				break;
			}

			case 'saveGlobalSettings':
				await this._configManager.updateGlobalSystemPrompt(data.globalSystemPrompt);
				await this._configManager.updateChatHistorySettings({
					enabled: data.chatHistoryEnabled,
					savePath: data.chatHistorySavePath
				});
				await this._configManager.updateExpertModeConfig({
					enabled: !!data.expertModeEnabled,
					providerId: data.expertModeProviderId || '',
					modelId: data.expertModeModelId || '',
				});
				await this._configManager.updateSolutionProviderConfig({
					enabled: !!data.solutionProviderEnabled,
					providerId: data.solutionProviderProviderId || '',
					modelId: data.solutionProviderModelId || '',
					reviewWithExpert: !!data.solutionProviderReviewWithExpert,
				});
				await this._configManager.updatePromptEnhancementConfig({
					enabled: !!data.promptEnhancementEnabled,
					autoSend: !!data.promptEnhancementAutoSend,
					providerId: data.promptEnhancementProviderId || '',
					modelId: data.promptEnhancementModelId || '',
				});
				await this._configManager.updateGlobalPromptEnhancementContextCacheConfig({
					contextMessageLimit: data.promptEnhancementContextMessageLimit,
				});
				await this._configManager.updateGlobalForceTodoEnabled(!!data.forceTodoEnabled);
				this._currentPanel?.dispose();
				vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'globalSettingsSaved'));
				break;

			case 'saveProjectSettings':
				await this._configManager.updateWorkspaceSystemPrompt(data.projectSystemPrompt);
				await this._configManager.updateWorkspaceForceTodoEnabled(!!data.forceTodoEnabled);
				await this._configManager.updateProjectChatHistorySettings({
					enabled: !!data.projectChatHistoryEnabled,
					savePath: data.projectChatHistorySavePath || ''
				});
				await this._configManager.updateWorkspaceExpertModeConfig({
					enabledState: data.expertModeEnabledState || 'global',
					providerId: data.expertModeProviderId || '',
					modelId: data.expertModeModelId || '',
				});
				await this._configManager.updateWorkspaceSolutionProviderConfig({
					enabledState: data.solutionProviderEnabledState || 'global',
					providerId: data.solutionProviderProviderId || '',
					modelId: data.solutionProviderModelId || '',
					reviewWithExpertState: data.solutionProviderReviewWithExpertState || 'global',
				});
				await this._configManager.updateWorkspacePromptEnhancementConfig({
					enabledState: data.promptEnhancementEnabledState || 'global',
					autoSendState: data.promptEnhancementAutoSendState || 'global',
					providerId: data.promptEnhancementProviderId || '',
					modelId: data.promptEnhancementModelId || '',
				});
				await this._configManager.updateWorkspacePromptEnhancementContextCacheConfig({
					contextMessageLimit: data.promptEnhancementContextMessageLimit === '' || data.promptEnhancementContextMessageLimit === undefined
						? undefined
						: Number(data.promptEnhancementContextMessageLimit),
				});
				this._currentPanel?.dispose();
				vscode.window.showInformationMessage(getConfigViewMessage(this._configManager.getResolvedLanguage(), 'projectSettingsSaved'));
				break;

			case 'openGlobalSettings':
				this._currentPanel!.webview.html = await this._getHtmlForMode('global');
				break;

			case 'openProjectSettings':
				this._currentPanel!.webview.html = await this._getHtmlForMode('project');
				break;

			case 'importRecords':
				try {
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

					await vscode.commands.executeCommand('workbench.action.chat.open', {
						query: prompt,
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to import records: ${errorMessage}`);
				}
				break;

			case 'exportRecords':
				try {
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

					await vscode.commands.executeCommand('workbench.action.chat.newChat');
					await vscode.commands.executeCommand('workbench.action.chat.open', {
						query: prompt,
					});
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to export records: ${errorMessage}`);
				}
				break;

			case 'cancelPanel':
				this._currentPanel?.dispose();
				break;
		}
	}

	private static _getDefaultSavePath(): string {
		const home = process.env.HOME || process.env.USERPROFILE || '';
		if (process.platform === 'win32') {
			const appData = process.env.APPDATA || '';
			return appData ? `${appData}/LLSOAI` : `${home}/AppData/Roaming/LLSOAI`;
		}
		return `${home}/.LLSOAI`;
	}

	private static _getDefaultProjectSavePath(): string {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			// Use the first workspace folder's path
			const projectPath = workspaceFolders[0].uri.fsPath;
			const separator = process.platform === 'win32' ? '\\' : '/';
			return `${projectPath}${separator}.LLSOAI`;
		}
		// Fallback to global default if no workspace is open
		return this._getDefaultSavePath();
	}

	private static _getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
