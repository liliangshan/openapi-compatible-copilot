import * as vscode from 'vscode';
import { ProviderConfig, ProviderConfigWithoutSecrets } from './types';

/**
 * Generate a unique ID
 */
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Manages provider configurations including persistence and secrets
 */
export class ConfigManager {
	private static readonly PROVIDERS_KEY = 'openapicopilot.providers';
	private static readonly SECRET_PREFIX = 'openapicopilot.apiKey.';

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
}
