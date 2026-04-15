import * as vscode from 'vscode';

/**
 * Represents a single provider/vendor configuration
 */
export interface ProviderConfig {
	/** Unique identifier for this provider */
	id: string;
	/** Display name/vendor flag shown in Copilot */
	name: string;
	/** API base URL */
	baseUrl: string;
	/** API key for authentication */
	apiKey: string;
	/** List of models configured for this provider */
	models: ModelConfig[];
	/** Whether this provider is enabled */
	enabled: boolean;
	/** Whether to automatically fetch models from API on settings open */
	autoFetchModels: boolean;
	/** Creation timestamp */
	createdAt: number;
}

/**
 * Represents a model configuration within a provider
 */
export interface ModelConfig {
	/** Model identifier as expected by the API */
	modelId: string;
	/** Display name shown in Copilot UI */
	displayName: string;
	/** Context length supported by the model */
	contextLength: number;
	/** Maximum tokens to generate */
	maxTokens: number;
	/** Whether the model supports vision */
	vision: boolean;
	/** Whether the model supports tool calling */
	toolCalling: boolean;
	/** Temperature for generation (0-2) */
	temperature: number;
	/** Top-p sampling value (0-1) */
	topP: number;
	/** Sampling mode: 'temperature' (only temperature), 'top_p' (only top_p), 'both' (default) */
	samplingMode: 'temperature' | 'top_p' | 'both';
	/** Whether the model shows up in the chat model selector */
	isUserSelectable?: boolean;
	/** Whether to transform <think> tags in model responses */
	transformThink?: boolean;
}

/**
 * Provider configuration without the secret apiKey
 * Used for serialization to workspace storage
 */
export interface ProviderConfigWithoutSecrets extends Omit<ProviderConfig, 'apiKey'> {
	/** Indicates whether an API key is stored */
	hasApiKey: boolean;
}

/**
 * Message types for Webview communication
 */
export interface WebviewMessage {
	command: string;
	[key: string]: unknown;
}

/**
 * Response message from Webview
 */
export interface WebviewResponse {
	command: string;
	success?: boolean;
	error?: string;
	data?: unknown;
}
