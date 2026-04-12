import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { updateContextStatusBar, resetStatusBar } from './statusBar';

const EXTENSION_LABEL = 'LLS OAI';
const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Type guard for LanguageModelToolResultPart-like values.
 */
function isToolResultPart(value: unknown): value is { callId: string; content: unknown[] } {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const obj = value as { callId?: string; content?: unknown };
	const hasCallId = typeof obj.callId === 'string';
	const hasContent = 'content' in obj;
	return hasCallId && hasContent;
}

/**
 * Concatenate tool result content into a single text string.
 */
function collectToolResultText(pr: { content?: unknown[] }): string {
	let text = '';
	for (const c of pr.content ?? []) {
		if (c instanceof vscode.LanguageModelTextPart) {
			text += c.value;
		} else if (typeof c === 'string') {
			text += c;
		} else if (c instanceof vscode.LanguageModelDataPart && c.mimeType === 'cache_control') {
			/* ignore cache_control markers */
		} else {
			try {
				text += JSON.stringify(c);
			} catch {
				/* ignore */
			}
		}
	}
	return text;
}

/**
 * OpenAI-compatible Language Model Chat Provider
 */
export class OpenAPIChatModelProvider implements vscode.LanguageModelChatProvider {
	private _statusBarItem: vscode.StatusBarItem;
	private _abortControllers: Map<string, AbortController> = new Map();
	private _onDidChangeModels: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

	/**
	 * Event fired when the available set of language models changes.
	 * This tells VS Code to refresh the model list in Copilot.
	 */
	readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this._onDidChangeModels.event;

	constructor(
		private readonly _configManager: ConfigManager,
		statusBarItem: vscode.StatusBarItem
	) {
		this._statusBarItem = statusBarItem;
	}

	/**
	 * Notify VS Code that models have changed.
	 * Call this after adding, editing, or deleting providers.
	 */
	notifyModelsChanged(): void {
		this._onDidChangeModels.fire();
	}

	/**
	 * Provide the list of available language models
	 */
	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		const providers = await this._configManager.getProvidersWithSecrets();
		const infos: vscode.LanguageModelChatInformation[] = [];

		for (const provider of providers) {
			if (!provider.enabled) {
				continue;
			}

			for (const model of provider.models) {
				// Skip models without modelId
				if (!model.modelId || !model.modelId.trim()) {
					continue;
				}

				const contextLen = model.contextLength || DEFAULT_CONTEXT_LENGTH;
				const maxOutput = model.maxTokens || DEFAULT_MAX_TOKENS;
				const maxInput = Math.max(1, contextLen - maxOutput);

				// Use displayName if set, otherwise fall back to modelId
				const modelDisplayName = (model.displayName && model.displayName.trim()) || model.modelId.trim();
				// Format: "provider name: model display name" to avoid cross-vendor conflicts
				const modelName = `${provider.name}: ${modelDisplayName}`;
				// Show provider name in detail field
				const detail = `${EXTENSION_LABEL}`;

				infos.push({
					id: `${provider.id}::${model.modelId}`,
					name: modelName,
					detail: detail,
					tooltip: `${provider.name} - ${model.modelId}`,
					family: model.modelId.toLowerCase().includes('claude') ? 'claude' : 
					        model.modelId.toLowerCase().includes('gemini') ? 'gemini' : 
					        EXTENSION_LABEL,
					version: '1.0.0',
					maxInputTokens: maxInput,
					maxOutputTokens: maxOutput,
					isUserSelectable: model.isUserSelectable,
					capabilities: {
						toolCalling: model.toolCalling ?? true,
						imageInput: model.vision || false,
					},
					// Store provider config reference for later use
					__providerData: {
						providerId: provider.id,
						providerName: provider.name,
						providerBaseUrl: provider.baseUrl,
						modelId: model.modelId,
						temperature: model.temperature ?? 0.7,
						topP: model.topP ?? 1.0,
						samplingMode: model.samplingMode ?? 'both',
					}
				} as vscode.LanguageModelChatInformation & { __providerData: any });
			}
		}

		return infos;
	}

	/**
	 * Provide token count for text
	 */
	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		return this._estimateTokens(text);
	}

	/**
	 * Estimate token count for text or message
	 */
	private _estimateTokens(text: string | vscode.LanguageModelChatRequestMessage): number {
		if (typeof text === 'string') {
			// ~4 characters per token for English, ~1.5 for Chinese
			return Math.ceil(text.length / 2.5);
		}
		// For messages, sum up all text parts
		let total = 3; // base tokens per message
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				total += Math.ceil(part.value.length / 2.5);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				total += 1 + Math.ceil(JSON.stringify(part.input).length / 2.5);
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				total += Math.ceil(JSON.stringify(part.content).length / 2.5);
			}
		}
		return total;
	}

	/**
	 * Handle chat responses
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation & { __providerData?: any },
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const metadata = model.__providerData;
		if (!metadata) {
			throw new Error('Model metadata not found');
		}

		const providerId = metadata.providerId as string;
		const modelId = metadata.modelId as string;
		const baseUrl = metadata.providerBaseUrl as string;
		const temperature = metadata.temperature as number ?? 0.7;
		const topP = metadata.topP as number ?? 1.0;
		const samplingMode = (metadata.samplingMode as string) ?? 'both';

		// Get API key from secrets
		const apiKey = await this._configManager.getApiKey(providerId);
		if (!apiKey) {
			throw new Error(`No API key configured for provider "${metadata.providerName}". Please configure it in the provider management UI.`);
		}

		// Update token usage status bar
		await updateContextStatusBar(
			messages,
			options.tools,
			model,
			this._statusBarItem,
			async (text) => this._estimateTokens(text)
		);

		// Build request body
		const requestBody: any = {
			model: modelId,
			messages: this._convertMessages(messages, model),
			stream: true,
		};

		// Only pass temperature/top_p based on samplingMode
		// Some models (e.g. Claude) don't support both simultaneously
		if (samplingMode === 'temperature') {
			requestBody.temperature = temperature;
		} else if (samplingMode === 'top_p') {
			requestBody.top_p = topP;
		} else {
			requestBody.temperature = temperature;
			requestBody.top_p = topP;
		}

		// Handle tool calling if present
		if (options.tools && options.tools.length > 0) {
			requestBody.tools = options.tools
				.map((tool: any) => ({
					type: 'function',
					function: {
						name: tool.name,
						description: tool.description || '',
						parameters: tool.inputSchema && Object.keys(tool.inputSchema).length > 0
							? tool.inputSchema
							: { type: 'object', properties: {} },
					}
				}));
		}

		// Make API request
		const abortController = new AbortController();
		this._abortControllers.set(providerId, abortController);

		token.onCancellationRequested(() => {
			abortController.abort();
		});

		try {
			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(requestBody),
				signal: abortController.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
			}

			if (!response.body) {
				throw new Error('No response body');
			}

			// Process streaming response
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			// Track in-progress tool calls across chunks
			const pendingToolCalls: Map<number, { id?: string; name?: string; arguments: string }> = new Map();

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					// Flush any completed tool calls that didn't get reported
					for (const [index, tc] of pendingToolCalls) {
						if (tc.name && tc.arguments) {
							try {
								progress.report(new vscode.LanguageModelToolCallPart(
									tc.id || `call_${index}`,
									tc.name,
									JSON.parse(tc.arguments)
								));
							} catch {
								// Invalid JSON, skip
							}
						}
					}
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmedLine = line.trim();
					if (!trimmedLine || trimmedLine === 'data: [DONE]') {
						continue;
					}

					if (trimmedLine.startsWith('data: ')) {
						try {
							const json = trimmedLine.slice(6);
							const parsed = JSON.parse(json);
							
							// Handle content
							const content = parsed.choices?.[0]?.delta?.content;
							if (content) {
								progress.report(new vscode.LanguageModelTextPart(content));
							}

							// Handle tool calls - accumulate arguments across chunks
							const toolCalls = parsed.choices?.[0]?.delta?.tool_calls;
							if (toolCalls && Array.isArray(toolCalls)) {
								for (const tc of toolCalls) {
									const index = tc.index;
									const existing = pendingToolCalls.get(index) || { arguments: '' };
									
									if (tc.id) existing.id = tc.id;
									if (tc.function?.name) existing.name = tc.function.name;
									if (tc.function?.arguments) existing.arguments += tc.function.arguments;
									
									pendingToolCalls.set(index, existing);
									
									// If we have both name and complete-looking arguments, report it
									if (existing.name && existing.arguments) {
										try {
											const parsedArgs = JSON.parse(existing.arguments);
											progress.report(new vscode.LanguageModelToolCallPart(
												existing.id || `call_${index}`,
												existing.name,
												parsedArgs
											));
											// Clear after reporting to avoid duplicates
											pendingToolCalls.delete(index);
										} catch {
											// Arguments not yet complete, keep accumulating
										}
									}
								}
							}
						} catch (e) {
							// Ignore parse errors for incomplete chunks
						}
					}
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return; // Request was cancelled
			}
			throw error;
		} finally {
			this._abortControllers.delete(providerId);
		}
	}

	/**
	 * Map VS Code message role to OpenAI role string.
	 * VS Code only defines User and Assistant roles, but may pass system messages
	 * with a different role value at runtime.
	 */
	private _mapRole(message: vscode.LanguageModelChatRequestMessage): string {
		const USER = vscode.LanguageModelChatMessageRole.User;
		const ASSISTANT = vscode.LanguageModelChatMessageRole.Assistant;
		const r = message.role;
		if (r === USER) {
			return 'user';
		}
		if (r === ASSISTANT) {
			return 'assistant';
		}
		return 'system';
	}

	/**
	 * Convert VS Code chat messages to OpenAI format
	 */
	private _convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[], model: vscode.LanguageModelChatInformation): Array<any> {
		const result: Array<any> = [];

		for (const message of messages) {
			const role = this._mapRole(message);
			
			if (role === 'user') {
				const { textParts, toolResults } = this._extractUserContent(message);
				
				// If there are tool results, emit them as separate "tool" role messages FIRST
				for (const tr of toolResults) {
					result.push({
						role: 'tool',
						tool_call_id: tr.tool_call_id,
						content: tr.text,
					});
				}
				
				// Then emit the user message with text content (if any)
				if (textParts.length > 0) {
					// Check if it's a simple string or needs array format (for images)
					const hasNonText = textParts.some(p => p.type !== 'text');
					if (hasNonText) {
						result.push({ role: 'user', content: textParts });
					} else if (textParts.length === 1) {
						result.push({ role: 'user', content: textParts[0].text });
					} else {
						result.push({ role: 'user', content: textParts.map(p => p.text).join('\n') });
					}
				} else if (toolResults.length === 0) {
					// Empty user message - send empty string
					result.push({ role: 'user', content: '' });
				}
				// If only tool results, the tool messages above are sufficient
			} else if (role === 'assistant') {
				const assistantData = this._extractAssistantContent(message);
				const msg: any = { role: 'assistant' };
				if (assistantData.content) {
					msg.content = assistantData.content;
				}
				if (assistantData.tool_calls && assistantData.tool_calls.length > 0) {
					msg.tool_calls = assistantData.tool_calls;
				}
				if (!msg.content && !msg.tool_calls) {
					msg.content = ''; // OpenAI requires at least one field
				}
				result.push(msg);
			} else if (role === 'system') {
				// Intercept system messages: filter out VS Code Copilot identity injection
				const filteredContent = this._filterSystemMessage(message, model);
				if (filteredContent) {
					result.push({ role: 'system', content: filteredContent });
				}
			}
		}

		return result;
	}

	/**
	 * Filter system messages to remove incorrect model identity injection from VS Code Copilot.
	 * Replaces references to built-in models (GPT, Claude, etc.) with our actual model info.
	 */
	private _filterSystemMessage(message: vscode.LanguageModelChatRequestMessage, model: vscode.LanguageModelChatInformation): string | null {
		let content = '';
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				content += part.value;
			}
		}

		if (!content) {
			return null;
		}

		// Patterns that indicate VS Code Copilot identity injection
		const copilotPatterns = [
			/GitHub Copilot/i,
			/Microsoft.*Copilot/i,
			/GPT-\d/i,
			/gpt-\d/i,
			/Claude/i,
			/model.*family/i,
			/you are .*gpt/i,
		];

		const hasCopilotIdentity = copilotPatterns.some(pattern => pattern.test(content));

		if (hasCopilotIdentity) {
			// Replace the system message with our actual model info
			const modelName = model.name || model.id;
			return `You are ${modelName}, a helpful AI assistant.`;
		}

		return content;
	}

	private _extractUserContent(message: vscode.LanguageModelChatRequestMessage): { textParts: Array<{ type: string; text?: string; image_url?: { url: string } }>; toolResults: Array<{ tool_call_id: string; text: string }> } {
		const textParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
		const toolResults: Array<{ tool_call_id: string; text: string }> = [];
		
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textParts.push({ type: 'text', text: part.value });
			} else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
				// Handle image data parts
				const base64 = Buffer.from(part.data).toString('base64');
				textParts.push({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${base64}` } });
			} else if (isToolResultPart(part)) {
				// Handle tool results using unified type guard (reference project approach)
				const text = collectToolResultText(part);
				toolResults.push({ tool_call_id: part.callId, text });
			}
		}

		return { textParts, toolResults };
	}

	private _extractAssistantContent(message: vscode.LanguageModelChatRequestMessage): { content?: string; tool_calls?: any[] } {
		const textParts: string[] = [];
		const toolCalls: any[] = [];
		
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textParts.push(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					type: 'function',
				id: part.callId || `call_${Date.now()}_${toolCalls.length}`,
					function: {
						name: part.name,
						arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input),
					}
				});
			}
		}
		
		const result: { content?: string; tool_calls?: any[] } = {};
		if (textParts.length > 0) {
			result.content = textParts.join('\n');
		}
		if (toolCalls.length > 0) {
			result.tool_calls = toolCalls;
		}
		return result;
	}
}
