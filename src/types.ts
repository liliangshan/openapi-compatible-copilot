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
	/** API type: 'openai-compatible' | 'anthropic' | 'v1-response' */
	apiType: 'openai-compatible' | 'anthropic' | 'v1-response';
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
	samplingMode: 'temperature' | 'top_p' | 'both' | 'none';
	/** Whether the model shows up in the chat model selector */
	isUserSelectable?: boolean;
	/** Whether to transform 认 tags in model responses */
	transformThink?: boolean;
	/** Whether to preserve and replay reasoning_content for APIs that require it, such as DeepSeek thinking mode */
	preserveReasoningContent?: boolean;
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
 * Expert mode global settings
 */
export interface ExpertModeConfig {
	/** Whether expert mode is enabled */
	enabled: boolean;
	/** Provider used by expert mode */
	providerId: string;
	/** Model used by expert mode */
	modelId: string;
}

export type WorkspaceExpertModeEnabledState = 'global' | 'enabled' | 'disabled';

/**
 * Expert mode workspace settings
 */
export interface WorkspaceExpertModeConfig extends ExpertModeConfig {
	/** Whether the workspace uses global enabled state, forces enabled, or forces disabled */
	enabledState: WorkspaceExpertModeEnabledState;
}

/**
 * Solution provider global settings
 */
export interface SolutionProviderConfig {
	/** Whether solution provider is enabled */
	enabled: boolean;
	/** Provider used by solution provider */
	providerId: string;
	/** Model used by solution provider */
	modelId: string;
	/** Whether solution provider must request expert review before finalizing */
	reviewWithExpert: boolean;
}

export type WorkspaceSolutionProviderEnabledState = 'global' | 'enabled' | 'disabled';

export type WorkspaceSolutionProviderReviewWithExpertState = 'global' | 'enabled' | 'disabled';

/**
 * Solution provider workspace settings
 */
export interface WorkspaceSolutionProviderConfig extends SolutionProviderConfig {
	/** Whether the workspace uses global enabled state, forces enabled, or forces disabled */
	enabledState: WorkspaceSolutionProviderEnabledState;
	/** Whether the workspace uses global review-with-expert state, forces enabled, or forces disabled */
	reviewWithExpertState: WorkspaceSolutionProviderReviewWithExpertState;
}

/**
 * Prompt enhancement global settings
 */
export interface PromptEnhancementConfig {
	/** Whether prompt enhancement is enabled */
	enabled: boolean;
	/** Whether to automatically submit the optimized prompt after inserting it */
	autoSend: boolean;
	/** Provider used by prompt enhancement */
	providerId: string;
	/** Model used by prompt enhancement */
	modelId: string;
}

/**
 * Prompt enhancement context cache settings
 */
export interface PromptEnhancementContextCacheConfig {
	/** Maximum number of recent messages cached per session. 0 means unlimited by message count. */
	contextMessageLimit: number;
}

/**
 * Workspace overrides for prompt enhancement context cache settings
 */
export interface WorkspacePromptEnhancementContextCacheConfig {
	/** Maximum number of recent messages cached per session. undefined means using global setting. */
	contextMessageLimit?: number;
}

export type WorkspacePromptEnhancementEnabledState = 'global' | 'enabled' | 'disabled';
export type WorkspacePromptEnhancementAutoSendState = 'global' | 'enabled' | 'disabled';

/**
 * Prompt enhancement workspace settings
 */
export interface WorkspacePromptEnhancementConfig extends PromptEnhancementConfig {
	/** Whether the workspace uses global enabled state, forces enabled, or forces disabled */
	enabledState: WorkspacePromptEnhancementEnabledState;
	/** Whether the workspace uses global auto-send state, forces enabled, or forces disabled */
	autoSendState: WorkspacePromptEnhancementAutoSendState;
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
