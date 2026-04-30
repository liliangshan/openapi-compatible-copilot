import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ExpertModeConfig, ProviderConfig, ProviderConfigWithoutSecrets, WorkspaceExpertModeConfig, WorkspaceExpertModeEnabledState } from './types';

/**
 * Generate a unique ID
 */
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Chat history auto-save settings
 */
export interface ChatHistorySettings {
	/** Whether to automatically save chat history */
	enabled: boolean;
	/** Directory to save chat history files */
	savePath: string;
}

export type AppLanguage = 'auto' | 'en' | 'zh-cn' | 'zh-tw' | 'ko' | 'ja' | 'fr' | 'de';
export type ResolvedAppLanguage = 'en' | 'zh-cn' | 'zh-tw' | 'ko' | 'ja' | 'fr' | 'de';

const SUPPORTED_APP_LANGUAGES: readonly ResolvedAppLanguage[] = ['en', 'zh-cn', 'zh-tw', 'ko', 'ja', 'fr', 'de'];

/**
 * Get default chat history save path based on platform
 */
export function getDefaultChatHistorySavePath(): string {
	const platform = os.platform();
	if (platform === 'win32') {
		// Windows: %APPDATA%/LLSOAI
		const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
		return path.join(appData, 'LLSOAI');
	} else {
		// macOS/Linux: ~/.LLSOAI
		return path.join(os.homedir(), '.LLSOAI');
	}
}

/**
 * Get default project chat history save path (project's .LLSOAI directory)
 */
export function getDefaultProjectChatHistorySavePath(): string {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length > 0) {
		// Use the first workspace folder's path
		return path.join(workspaceFolders[0].uri.fsPath, '.LLSOAI');
	}
	// Fallback to global default if no workspace is open
	return getDefaultChatHistorySavePath();
}

/**
 * Manages provider configurations including persistence and secrets
 */
export class ConfigManager {
	private static readonly PROVIDERS_KEY = 'openapicopilot.providers';
	private static readonly SECRET_PREFIX = 'openapicopilot.apiKey.';
	private static readonly CHAT_HISTORY_KEY = 'openapicopilot.chatHistorySettings';
	private static readonly PROJECT_CHAT_HISTORY_KEY = 'openapicopilot.projectChatHistorySettings';
	private static readonly EXPERT_MODE_CONFIG_KEY = 'openapicopilot.expertModeConfig';
	private static readonly EXPERT_MODE_ENABLED_CONFIG_KEY = 'expertMode.enabled';
	private static readonly EXPERT_MODE_PROVIDER_CONFIG_KEY = 'expertMode.providerId';
	private static readonly EXPERT_MODE_MODEL_CONFIG_KEY = 'expertMode.modelId';
	private static readonly WORKSPACE_EXPERT_MODE_ENABLED_STATE_CONFIG_KEY = 'expertMode.enabledState';
	private static readonly GLOBAL_FORCE_TODO_KEY = 'openapicopilot.globalForceTodoEnabled';
	private static readonly WORKSPACE_FORCE_TODO_KEY = 'openapicopilot.workspaceForceTodoEnabled';
	private static readonly LANGUAGE_CONFIG_KEY = 'language';
	private projectChatHistorySaveQueue = Promise.resolve();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly secrets: vscode.SecretStorage
	) {}

	/**
	 * Get all provider configurations
	 */
	async getProviders(): Promise<ProviderConfigWithoutSecrets[]> {
		const stored = this.context.globalState.get<ProviderConfigWithoutSecrets[]>(ConfigManager.PROVIDERS_KEY, []);
		return stored;
	}

	/**
	 * Get a single provider configuration by ID
	 */
	async getProvider(id: string): Promise<ProviderConfig | null> {
		const providers = await this.getProviders();
		const provider = providers.find(p => p.id === id);
		if (!provider) {
			return null;
		}

		const apiKey = await this.secrets.get(`${ConfigManager.SECRET_PREFIX}${id}`);
		return {
			...provider,
			apiKey: apiKey || '',
		};
	}

	/**
	 * Add a new provider configuration
	 */
	async addProvider(config: Omit<ProviderConfig, 'id' | 'createdAt'>): Promise<ProviderConfigWithoutSecrets> {
		const providers = await this.getProviders();
		const id = generateId();
		const newProvider: ProviderConfigWithoutSecrets = {
			...config,
			id,
			createdAt: Date.now(),
			hasApiKey: !!config.apiKey,
		};

		// Store API key in secrets
		if (config.apiKey) {
			await this.secrets.store(`${ConfigManager.SECRET_PREFIX}${id}`, config.apiKey);
		}

		// Store provider config without the secret
		providers.push(newProvider);
		await this.context.globalState.update(ConfigManager.PROVIDERS_KEY, providers);

		return newProvider;
	}

	/**
	 * Update an existing provider configuration
	 */
	async updateProvider(id: string, updates: Partial<Omit<ProviderConfig, 'id'>>): Promise<ProviderConfigWithoutSecrets> {
		const providers = await this.getProviders();
		const index = providers.findIndex(p => p.id === id);
		if (index === -1) {
			throw new Error(`Provider ${id} not found`);
		}

		// Update API key if provided
		if (updates.apiKey !== undefined) {
			if (updates.apiKey) {
				await this.secrets.store(`${ConfigManager.SECRET_PREFIX}${id}`, updates.apiKey);
			} else {
				await this.secrets.delete(`${ConfigManager.SECRET_PREFIX}${id}`);
			}
		}

		// Update provider config
		const { apiKey, ...updatesWithoutKey } = updates as Partial<ProviderConfig>;
		providers[index] = {
			...providers[index],
			...updatesWithoutKey,
			hasApiKey: updates.apiKey !== undefined ? !!updates.apiKey : providers[index].hasApiKey,
		};

		await this.context.globalState.update(ConfigManager.PROVIDERS_KEY, providers);
		return providers[index];
	}

	/**
	 * Remove a provider configuration
	 */
	async removeProvider(id: string): Promise<void> {
		const providers = await this.getProviders();
		const filtered = providers.filter(p => p.id !== id);
		
		// Remove the secret
		await this.secrets.delete(`${ConfigManager.SECRET_PREFIX}${id}`);
		
		// Update storage
		await this.context.globalState.update(ConfigManager.PROVIDERS_KEY, filtered);
	}

	/**
	 * Get API key for a provider by ID
	 */
	async getApiKey(id: string): Promise<string> {
		return await this.secrets.get(`${ConfigManager.SECRET_PREFIX}${id}`) || '';
	}

	/**
	 * Get all providers with their API keys (for internal use only)
	 */
	async getProvidersWithSecrets(): Promise<ProviderConfig[]> {
		const providers = await this.getProviders();
		const result: ProviderConfig[] = [];

		for (const provider of providers) {
			const apiKey = await this.secrets.get(`${ConfigManager.SECRET_PREFIX}${provider.id}`);
			result.push({
				...provider,
				apiKey: apiKey || '',
			});
		}

		return result;
	}

	/**
	 * Export all configurations (for backup)
	 */
	async exportConfig(): Promise<{ providers: ProviderConfigWithoutSecrets[] }> {
		return {
			providers: await this.getProviders(),
		};
	}

	/**
	 * Import configurations (for restore)
	 */
	async importConfig(data: { providers: ProviderConfigWithoutSecrets[] }): Promise<void> {
		await this.context.globalState.update(ConfigManager.PROVIDERS_KEY, data.providers);
	}

	/**
	 * Get chat history auto-save settings
	 */
	async getChatHistorySettings(): Promise<ChatHistorySettings> {
		const stored = this.context.globalState.get<ChatHistorySettings>(ConfigManager.CHAT_HISTORY_KEY);
		if (stored) {
			return stored;
		}
		// Return default settings
		return {
			enabled: false,
			savePath: getDefaultChatHistorySavePath(),
		};
	}

	/**
	 * Update chat history auto-save settings
	 */
	async updateChatHistorySettings(settings: Partial<ChatHistorySettings>): Promise<ChatHistorySettings> {
		const current = await this.getChatHistorySettings();
		const updated = { ...current, ...settings };
		await this.context.globalState.update(ConfigManager.CHAT_HISTORY_KEY, updated);
		return updated;
	}

	/**
	 * Get project-level chat history auto-save settings
	 */
	async getProjectChatHistorySettings(): Promise<ChatHistorySettings> {
		const stored = this.context.workspaceState.get<ChatHistorySettings>(ConfigManager.PROJECT_CHAT_HISTORY_KEY);
		if (stored) {
			return stored;
		}
		// Return default settings
		return {
			enabled: false,
			savePath: getDefaultProjectChatHistorySavePath(),
		};
	}

	/**
	 * Update project-level chat history auto-save settings
	 */
	async updateProjectChatHistorySettings(settings: Partial<ChatHistorySettings>): Promise<ChatHistorySettings> {
		const current = await this.getProjectChatHistorySettings();
		const updated = { ...current, ...settings };
		await this.context.workspaceState.update(ConfigManager.PROJECT_CHAT_HISTORY_KEY, updated);
		return updated;
	}

	/**
	 * Get expert mode global settings
	 */
	getExpertModeConfig(): ExpertModeConfig {
		const config = vscode.workspace.getConfiguration('openapicopilot');
		const stored = this.context.globalState.get<ExpertModeConfig>(ConfigManager.EXPERT_MODE_CONFIG_KEY);
		const enabledInspect = config.inspect<boolean>(ConfigManager.EXPERT_MODE_ENABLED_CONFIG_KEY);
		const providerInspect = config.inspect<string>(ConfigManager.EXPERT_MODE_PROVIDER_CONFIG_KEY);
		const modelInspect = config.inspect<string>(ConfigManager.EXPERT_MODE_MODEL_CONFIG_KEY);
		return {
			enabled: enabledInspect?.globalValue ?? stored?.enabled ?? false,
			providerId: providerInspect?.globalValue ?? stored?.providerId ?? '',
			modelId: modelInspect?.globalValue ?? stored?.modelId ?? '',
		};
	}

	/**
	 * Get expert mode workspace settings. Empty provider/model means using global settings.
	 */
	getWorkspaceExpertModeConfig(): WorkspaceExpertModeConfig {
		const config = vscode.workspace.getConfiguration('openapicopilot');
		const rawEnabledState = config.inspect<WorkspaceExpertModeEnabledState>(ConfigManager.WORKSPACE_EXPERT_MODE_ENABLED_STATE_CONFIG_KEY)?.workspaceValue;
		const enabledState: WorkspaceExpertModeEnabledState = rawEnabledState === 'enabled' || rawEnabledState === 'disabled' ? rawEnabledState : 'global';
		return {
			enabled: enabledState === 'enabled',
			enabledState,
			providerId: config.inspect<string>(ConfigManager.EXPERT_MODE_PROVIDER_CONFIG_KEY)?.workspaceValue ?? '',
			modelId: config.inspect<string>(ConfigManager.EXPERT_MODE_MODEL_CONFIG_KEY)?.workspaceValue ?? '',
		};
	}

	/**
	 * Get the effective expert mode settings. Workspace provider/model overrides global when set.
	 */
	getEffectiveExpertModeConfig(): ExpertModeConfig {
		const globalConfig = this.getExpertModeConfig();
		const workspaceConfig = this.getWorkspaceExpertModeConfig();
		const hasWorkspaceExpert = !!workspaceConfig.providerId && !!workspaceConfig.modelId;
		const baseConfig = hasWorkspaceExpert ? workspaceConfig : globalConfig;
		return {
			...baseConfig,
			enabled: workspaceConfig.enabledState === 'global' ? globalConfig.enabled : workspaceConfig.enabledState === 'enabled',
		};
	}

	/**
	 * Update expert mode global settings
	 */
	async updateExpertModeConfig(settings: Partial<ExpertModeConfig>): Promise<ExpertModeConfig> {
		const current = this.getExpertModeConfig();
		const updated = { ...current, ...settings };
		const config = vscode.workspace.getConfiguration('openapicopilot');
		await config.update(ConfigManager.EXPERT_MODE_ENABLED_CONFIG_KEY, updated.enabled, true);
		await config.update(ConfigManager.EXPERT_MODE_PROVIDER_CONFIG_KEY, updated.providerId, true);
		await config.update(ConfigManager.EXPERT_MODE_MODEL_CONFIG_KEY, updated.modelId, true);
		await this.context.globalState.update(ConfigManager.EXPERT_MODE_CONFIG_KEY, updated);
		return updated;
	}

	/**
	 * Update expert mode workspace settings
	 */
	async updateWorkspaceExpertModeConfig(settings: Partial<WorkspaceExpertModeConfig>): Promise<WorkspaceExpertModeConfig> {
		const current = this.getWorkspaceExpertModeConfig();
		const updated = { ...current, ...settings };
		const enabledState: WorkspaceExpertModeEnabledState = updated.enabledState === 'enabled' || updated.enabledState === 'disabled' ? updated.enabledState : 'global';
		const config = vscode.workspace.getConfiguration('openapicopilot');
		await config.update(ConfigManager.WORKSPACE_EXPERT_MODE_ENABLED_STATE_CONFIG_KEY, enabledState, false);
		await config.update(ConfigManager.EXPERT_MODE_PROVIDER_CONFIG_KEY, updated.providerId, false);
		await config.update(ConfigManager.EXPERT_MODE_MODEL_CONFIG_KEY, updated.modelId, false);
		return { ...updated, enabled: enabledState === 'enabled', enabledState };
	}

	/**
	 * Get global Force TODO setting
	 */
	getGlobalForceTodoEnabled(): boolean {
		return this.context.globalState.get<boolean>(ConfigManager.GLOBAL_FORCE_TODO_KEY, false);
	}

	/**
	 * Update global Force TODO setting
	 */
	async updateGlobalForceTodoEnabled(enabled: boolean): Promise<void> {
		await this.context.globalState.update(ConfigManager.GLOBAL_FORCE_TODO_KEY, enabled);
	}

	/**
	 * Get workspace Force TODO setting
	 */
	getWorkspaceForceTodoEnabled(): boolean {
		return this.context.workspaceState.get<boolean>(ConfigManager.WORKSPACE_FORCE_TODO_KEY, false);
	}

	/**
	 * Update workspace Force TODO setting
	 */
	async updateWorkspaceForceTodoEnabled(enabled: boolean): Promise<void> {
		await this.context.workspaceState.update(ConfigManager.WORKSPACE_FORCE_TODO_KEY, enabled);
	}

	/**
	 * Get configured UI language from global settings.
	 * Auto means following VS Code display language.
	 */
	getConfiguredLanguage(): AppLanguage {
		const config = vscode.workspace.getConfiguration('openapicopilot');
		const language = config.get<AppLanguage>(ConfigManager.LANGUAGE_CONFIG_KEY, 'auto');
		return language === 'auto' || SUPPORTED_APP_LANGUAGES.includes(language as ResolvedAppLanguage) ? language : 'auto';
	}

	/**
	 * Resolve the effective UI language.
	 */
	getResolvedLanguage(): ResolvedAppLanguage {
		const configuredLanguage = this.getConfiguredLanguage();
		if (configuredLanguage !== 'auto') {
			return configuredLanguage;
		}

		const vscodeLanguage = vscode.env.language.toLowerCase();
		if (vscodeLanguage.startsWith('zh-tw') || vscodeLanguage.startsWith('zh-hk') || vscodeLanguage.startsWith('zh-mo') || vscodeLanguage.startsWith('zh-hant')) { return 'zh-tw'; }
		if (vscodeLanguage.startsWith('zh')) { return 'zh-cn'; }
		if (vscodeLanguage.startsWith('ko')) { return 'ko'; }
		if (vscodeLanguage.startsWith('ja')) { return 'ja'; }
		if (vscodeLanguage.startsWith('fr')) { return 'fr'; }
		if (vscodeLanguage.startsWith('de')) { return 'de'; }

		return 'en';
	}

	/**
	 * Update global UI language setting.
	 */
	async updateLanguage(language: AppLanguage): Promise<void> {
		const normalizedLanguage: AppLanguage = language === 'auto' || SUPPORTED_APP_LANGUAGES.includes(language as ResolvedAppLanguage) ? language : 'auto';
		const config = vscode.workspace.getConfiguration('openapicopilot');
		await config.update(ConfigManager.LANGUAGE_CONFIG_KEY, normalizedLanguage, true);
	}

	/**
	 * Get custom system prompt from workspace configuration (project-scoped)
	 */
	getWorkspaceSystemPrompt(): string {
		const config = vscode.workspace.getConfiguration('openapicopilot');
		return config.inspect<string>('systemPrompt')?.workspaceValue || '';
	}

	/**
	 * Update custom system prompt in workspace configuration (project-scoped)
	 */
	async updateWorkspaceSystemPrompt(prompt: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('openapicopilot');
		await config.update('systemPrompt', prompt, false); // false = workspace-scoped
	}

	/**
	 * Get global system prompt from global configuration
	 */
	getGlobalSystemPrompt(): string {
		const config = vscode.workspace.getConfiguration('openapicopilot');
		return config.inspect<string>('systemPrompt')?.globalValue || '';
	}

	/**
	 * Update global system prompt in global configuration
	 */
	async updateGlobalSystemPrompt(prompt: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('openapicopilot');
		await config.update('systemPrompt', prompt, true); // true = global-scoped
	}

	/**
	 * Generate a session ID from the first message content
	 * Uses hash to create a short, consistent identifier
	 */
	private _generateSessionId(firstMessage: string): string {
		return crypto.createHash('md5').update(firstMessage).digest('hex').substring(0, 8);
	}

	/**
	 * Save chat history to file
	 * Normal save: overwrites the file for the same session (chat_<sessionId>.json)
	 * When conversation-summary is detected (compression): also saves an archive file (chat-session-<timestamp>.json)
	 * 
	 * Behavior:
	 * 1. Always saves to global settings path if global is enabled
	 * 2. Additionally saves to project path (organized by date) if project-level is also enabled
	 * 
	 * @param messages The complete conversation history
	 * @param modelId The model used for this conversation
	 * @param tools The tools available for this conversation
	 */
	async saveChatHistory(
		messages: Array<{ role: string; content: string; name?: string }>,
		modelId?: string,
		tools?: any[]
	): Promise<void> {
		if (messages.length === 0) {
			return;
		}

		// Check both global and project-level settings
		const globalSettings = await this.getChatHistorySettings();
		const projectSettings = await this.getProjectChatHistorySettings();

		// Both disabled - nothing to save
		if (!globalSettings.enabled && !projectSettings.enabled) {
			return;
		}

		// Helper function to normalize save path (fallback to default if empty)
		const normalizePath = (savePath: string | undefined, defaultPath: string): string => {
			const trimmed = savePath?.trim();
			return trimmed || defaultPath;
		};

		// Check if this is a compression event (system prompt contains "create a comprehensive")
		const isCompression = messages.some(m => m.role === 'system' && m.content.includes('create a comprehensive'));
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const startTime = new Date().toISOString();

		// Build the chat history object
		const chatData: any = {
			sessionId: this._generateSessionId(messages.find(m => m.role === 'user')?.content || 'unknown'),
			modelId,
			startTime,
			messageCount: messages.length,
			messages: messages.map(m => ({
				role: m.role,
				name: m.name ?? undefined,
				content: m.content,
			})),
		};

		// Add tools if available
		if (tools && tools.length > 0) {
			chatData.tools = tools;
		}

		// Serialize to JSON with error handling
		let content: string;
		try {
			content = JSON.stringify(chatData, null, 2);
		} catch (error) {
			console.error('Failed to serialize chat history:', error);
			return;
		}

		// Helper function to save chat history
		const saveToPath = async (savePath: string, useDateFolder: boolean = false): Promise<void> => {
			let finalPath = savePath;
			
			// If using date folder, append date folder structure
			if (useDateFolder) {
				const now = new Date();
				const year = now.getFullYear().toString();
				const month = (now.getMonth() + 1).toString().padStart(2, '0');
				const day = now.getDate().toString().padStart(2, '0');
				finalPath = vscode.Uri.joinPath(vscode.Uri.file(savePath), year, month, day).fsPath;
			}
			
			const saveUri = vscode.Uri.file(finalPath);
			
			// Ensure directory exists
			try {
				await vscode.workspace.fs.stat(saveUri);
			} catch {
				await vscode.workspace.fs.createDirectory(saveUri);
			}

			// Normal save: overwrite session file
			const sessionFilename = `chat_${chatData.sessionId}.json`;
			const sessionFileUri = vscode.Uri.joinPath(saveUri, sessionFilename);
			await vscode.workspace.fs.writeFile(sessionFileUri, Buffer.from(content, 'utf8'));

			// If compression event, also save an archive file with timestamp
			if (isCompression) {
				const archiveFilename = `chat-session-${timestamp}.json`;
				const archiveFileUri = vscode.Uri.joinPath(saveUri, archiveFilename);
				await vscode.workspace.fs.writeFile(archiveFileUri, Buffer.from(content, 'utf8'));
			}
		};

		// Helper function to save project-level chat history (daily cumulative save)
		const saveProjectChatHistory = async (savePath: string): Promise<void> => {
			// Serialize save operation to prevent concurrent writes from corrupting data
			// Use .catch(() => undefined) to prevent a single failure from killing the entire queue
			const runSave = async (): Promise<void> => {
				// Filter messages to only include user and assistant
				// Handle content that might be an array or a string
				const filteredMessages: Array<{ role: string; content: string; name?: string }> = [];
				for (const m of messages) {
					if (m.role !== 'user' && m.role !== 'assistant') {
						continue;
					}

					// Handle content: if it's an array, iterate through it; if it's a string, use it directly
					if (Array.isArray(m.content)) {
						// If content is an array, iterate through each item
						for (const item of m.content) {
							if (typeof item === 'string' && item.trim()) {
								filteredMessages.push({
									role: m.role,
									content: item,
									name: m.name ?? undefined,
								});
							} else if (typeof item === 'object' && item !== null) {
								// Handle object with text property (e.g., { type: "text", text: "..." })
								const text = (item as { text?: unknown }).text;
								if (typeof text === 'string' && text.trim()) {
									filteredMessages.push({
										role: m.role,
										content: text,
										name: m.name ?? undefined,
									});
								}
							}
						}
					} else if (typeof m.content === 'string' && m.content.trim()) {
						// If content is a string, use it directly
						filteredMessages.push({
							role: m.role,
							content: m.content,
							name: m.name ?? undefined,
						});
					}
				}

				if (filteredMessages.length === 0) {
					return;
				}

				// Create date-based filename: YYYY-MM-DD.json
				const now = new Date();
				const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
				const dailyFilename = `${dateStr}.json`;

				const dailyFileUri = vscode.Uri.joinPath(vscode.Uri.file(savePath), dailyFilename);

				// Check if file exists using stat first, then read
				let existingRecords: Array<{ role: string; content: string; name?: string }> = [];
				let fileExists = false;
				try {
					await vscode.workspace.fs.stat(dailyFileUri);
					fileExists = true;
				} catch {
					// File doesn't exist, continue with empty records
				}

				if (fileExists) {
					try {
						const existingContent = await vscode.workspace.fs.readFile(dailyFileUri);
						const existingText = Buffer.from(existingContent).toString('utf8');
						const existingData = JSON.parse(existingText);

						// Validate top-level structure - if invalid, skip save to avoid corrupting file
						if (
							!existingData ||
							typeof existingData !== 'object' ||
							!Array.isArray((existingData as any).records)
						) {
							console.error(
								'Invalid project chat history file structure, skipping save to avoid corruption:',
								dailyFileUri.fsPath
							);
							return;
						}

						// Validate and filter existing records
						existingRecords = (existingData as any).records.filter((r: any) =>
							(r.role === 'user' || r.role === 'assistant') &&
							typeof r.content === 'string' &&
							(r.name === undefined || r.name === null || typeof r.name === 'string')
						);
					} catch (error) {
						// File existed but failed to read/parse - don't overwrite with empty data
						console.error(
							'Failed to read or parse existing project chat history file, skipping save:',
							error
						);
						return;
					}
				}

				// Ensure directory exists
				const saveUri = vscode.Uri.file(savePath);
				try {
					await vscode.workspace.fs.stat(saveUri);
				} catch {
					await vscode.workspace.fs.createDirectory(saveUri);
				}

				// Helper function to create a unique signature for deduplication
				// Using JSON.stringify on a tuple avoids key collision from colon characters
				const makeSignature = (r: { role: string; content: string; name?: string }): string =>
					JSON.stringify([r.role, r.content, r.name ?? null]);

				// Build set of existing signatures for O(1) lookup
				// Using Map to preserve the actual record (in case of collisions)
				const existingSignatureMap = new Map<string, { role: string; content: string; name?: string }>();
				for (const r of existingRecords) {
					existingSignatureMap.set(makeSignature(r), r);
				}

				// Filter and deduplicate: check against existing AND newly added records
				// This ensures both file-level and batch-level deduplication
				const newRecords: Array<{ role: string; content: string; name?: string }> = [];
				for (const record of filteredMessages) {
					const signature = makeSignature(record);
					if (!existingSignatureMap.has(signature)) {
						existingSignatureMap.set(signature, record);
						newRecords.push(record);
					}
				}

				// If no new records to add, skip saving
				if (newRecords.length === 0) {
					return;
				}

				// Append new records to existing ones
				const dailyData = {
					date: dateStr,
					lastUpdated: new Date().toISOString(),
					records: [...existingRecords, ...newRecords],
				};

				const dailyContent = JSON.stringify(dailyData, null, 2);
				await vscode.workspace.fs.writeFile(dailyFileUri, Buffer.from(dailyContent, 'utf8'));
			};

			// Chain saves: swallow previous errors to keep queue alive
			const savePromise = this.projectChatHistorySaveQueue
				.catch(() => undefined)
				.then(runSave);

			// Update queue reference, swallowing this run's error so chain continues
			this.projectChatHistorySaveQueue = savePromise.catch(() => undefined);

			// Await the save promise so caller can handle errors
			await savePromise;
		};

		// 1. Always save to global path if global is enabled
		if (globalSettings.enabled) {
			const globalPath = normalizePath(
				globalSettings.savePath,
				await getDefaultChatHistorySavePath()
			);
			try {
				await saveToPath(globalPath, false);
			} catch (error) {
				console.error('Failed to save chat history to global path:', error);
			}
		}

		// 2. Additionally save to project path (daily cumulative) if project-level is also enabled
		if (projectSettings.enabled) {
			const projectPath = normalizePath(
				projectSettings.savePath,
				await getDefaultProjectChatHistorySavePath()
			);
			try {
				await saveProjectChatHistory(projectPath);
			} catch (error) {
				console.error('Failed to save chat history to project path:', error);
			}
		}
	}
}
