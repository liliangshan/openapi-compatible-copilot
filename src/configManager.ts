import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ProviderConfig, ProviderConfigWithoutSecrets } from './types';

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
 * Manages provider configurations including persistence and secrets
 */
export class ConfigManager {
	private static readonly PROVIDERS_KEY = 'openapicopilot.providers';
	private static readonly SECRET_PREFIX = 'openapicopilot.apiKey.';
	private static readonly CHAT_HISTORY_KEY = 'openapicopilot.chatHistorySettings';

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
	 * @param messages The complete conversation history
	 * @param modelId The model used for this conversation
	 * @param tools The tools available for this conversation
	 */
	async saveChatHistory(
		messages: Array<{ role: string; content: string; name?: string }>,
		modelId?: string,
		tools?: any[]
	): Promise<void> {
		const settings = await this.getChatHistorySettings();
		if (!settings.enabled || messages.length === 0) {
			return;
		}

		try {
			const saveUri = vscode.Uri.file(settings.savePath);
			
			// Ensure directory exists
			try {
				await vscode.workspace.fs.stat(saveUri);
			} catch {
				await vscode.workspace.fs.createDirectory(saveUri);
			}

			// Generate session ID from first user message
			const firstUserMsg = messages.find(m => m.role === 'user');
			const firstMessageContent = firstUserMsg?.content || 'unknown';
			const sessionId = this._generateSessionId(firstMessageContent);

			// Check if this is a compression event (system prompt contains "create a comprehensive")
			const isCompression = messages.some(m => m.role === 'system' && m.content.includes('create a comprehensive'));
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const startTime = new Date().toISOString();

			// Build the chat history object
			const chatData: any = {
				sessionId,
				modelId,
				startTime,
				messageCount: messages.length,
				messages: messages.map(m => ({
					role: m.role,
					name: m.name || undefined,
					content: m.content,
				})),
			};

			// Add tools if available
			if (tools && tools.length > 0) {
				chatData.tools = tools;
			}

			const content = JSON.stringify(chatData, null, 2);

			// Normal save: overwrite session file
			const sessionFilename = `chat_${sessionId}.json`;
			const sessionFileUri = vscode.Uri.joinPath(saveUri, sessionFilename);
			await vscode.workspace.fs.writeFile(sessionFileUri, Buffer.from(content, 'utf8'));

			// If compression event, also save an archive file with timestamp
			if (isCompression) {
				const archiveFilename = `chat-session-${timestamp}.json`;
				const archiveFileUri = vscode.Uri.joinPath(saveUri, archiveFilename);
				await vscode.workspace.fs.writeFile(archiveFileUri, Buffer.from(content, 'utf8'));
			}
		} catch (error) {
			console.error('Failed to save chat history:', error);
		}
	}
}
