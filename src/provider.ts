import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { updateContextStatusBar, resetStatusBar } from './statusBar';
import {
	convertOpenAIRequestToAnthropic,
	convertAnthropicEventToOpenAIChunks,
	convertAnthropicResponseToOpenAI,
	createAnthropicStreamState,
	type AnthropicStreamState,
	type OpenAIChunk,
} from './anthropicConverter';

const EXTENSION_LABEL = 'LLS OAI';
const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 16000;

/**
 * Get the debug directory path (cross-platform compatible).
 */
function getDebugDir(): string {
	return require('path').join(require('os').homedir(), '.LLSOAI');
}

/**
 * Ensure the debug directory exists (cross-platform compatible).
 */
function ensureDebugDir(): void {
	const dir = getDebugDir();
	if (!require('fs').existsSync(dir)) {
		require('fs').mkdirSync(dir, { recursive: true });
	}
}

/**
 * Write JSON data to a debug file in the .LLSOAI directory.
 */
function writeDebugFile(filename: string, data: any): void {
	try {
		ensureDebugDir();
		const filePath = require('path').join(getDebugDir(), filename);
		require('fs').writeFileSync(filePath, JSON.stringify(data, null, 2));
	} catch {
		// Ignore errors when saving debug files
	}
}

const FORCE_TODO_PROMPT = 'If there is no todo list, create one before making changes. If a todo list already exists, continue using the existing todo list, execute todo items in order, and update the todo status after completing each item.';
const TODO_STATUS_UPDATE_PROMPT = 'If an existing todo item is solved during this conversation, update the todo status when it is completed.';
const MANDATORY_TODO_PROMPT = 'You MUST use the TODO tool before taking any action. All TODO items must be clear, specific, and detailed with actionable steps. Do not execute any task without first creating or updating a TODO item. All work must be tracked through the TODO tool.';

function getCurrentTodoTaskContent(): string | null {
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return null;
		}

		const fs = require('fs');
		const path = require('path');
		const currentTaskPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'TODO', 'task.json');
		if (!fs.existsSync(currentTaskPath)) {
			return null;
		}

		return fs.readFileSync(currentTaskPath, 'utf8');
	} catch (error) {
		writeDebugFile(`todo_current_task_read_error_${Date.now()}.json`, {
			error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
			timestamp: new Date().toISOString(),
		});
		return null;
	}
}

/**
 * Save manage_todo_list tool arguments into the active workspace .vscode/TODO folder.
 * Only saves when forceTodoEnabled is true.
 */
function saveTodoToolState(todoData: any, forceTodoEnabled: boolean): void {
	if (!forceTodoEnabled) {
		return;
	}
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return;
		}

		const fs = require('fs');
		const path = require('path');
		const todoDir = path.join(workspaceFolder.uri.fsPath, '.vscode', 'TODO');
		fs.mkdirSync(todoDir, { recursive: true });

		const todoList = Array.isArray(todoData?.todoList) ? todoData.todoList : [];
		const allCompleted = todoList.length > 0 && todoList.every((item: any) => item?.status === 'completed');
		const currentTaskPath = path.join(todoDir, 'task.json');

		if (allCompleted) {
			// Move existing task.json to task_时间缀.json
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const archivedPath = path.join(todoDir, `task_${timestamp}.json`);
			if (fs.existsSync(currentTaskPath)) {
				fs.renameSync(currentTaskPath, archivedPath);
			}
		} else {
			// Save current todo state to task.json
			fs.writeFileSync(currentTaskPath, JSON.stringify({
				timestamp: new Date().toISOString(),
				todoList,
			}, null, 2));
		}
	} catch (error) {
		writeDebugFile(`todo_save_error_${Date.now()}.json`, {
			error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
			todoData,
			timestamp: new Date().toISOString(),
		});
	}
}

/**
 * Read the existing unfinished task.json content so it can be sent to the model
 * before tool calling starts. This keeps VS Code tool-call animations working.
 */
function getExistingTodoTaskPrompt(): string | null {
	try {
		const existingTaskContent = getCurrentTodoTaskContent();
		if (!existingTaskContent) {
			return null;
		}
		return `An unfinished todo task already exists. Do not create a different new todo list yet. Continue with the following existing todo task by calling the todo tool with this todo list and updating item statuses in order. Only create a different new todo list after all existing items are completed.\n\n${existingTaskContent}`;
	} catch (error) {
		writeDebugFile(`todo_existing_task_read_error_${Date.now()}.json`, {
			error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
			timestamp: new Date().toISOString(),
		});
		return null;
	}
}

/**
 * Return merged manage_todo_list input when the model tries to create a different
 * todo task while an unfinished task.json already exists.
 */
function getMergedTodoInputForConflict(todoData: any): any | null {
	try {
		const todoList = Array.isArray(todoData?.todoList) ? todoData.todoList : [];
		const incomingFirstItem = todoList[0];
		const incomingFirstStatus = incomingFirstItem?.status;
		if (incomingFirstStatus !== 'in-progress' && incomingFirstStatus !== 'not-started') {
			return null;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return null;
		}

		const fs = require('fs');
		const path = require('path');
		const currentTaskPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'TODO', 'task.json');
		if (!fs.existsSync(currentTaskPath)) {
			return null;
		}

		const existingTaskContent = fs.readFileSync(currentTaskPath, 'utf8');
		const existingTask = JSON.parse(existingTaskContent);
		const existingTodoList = Array.isArray(existingTask?.todoList) ? existingTask.todoList : [];
		const existingFirstItem = existingTodoList[0];
		const incomingFirstContent = JSON.stringify(incomingFirstItem ?? {});
		const existingFirstContent = JSON.stringify(existingFirstItem ?? {});

		if (incomingFirstContent === existingFirstContent) {
			return null;
		}

		const firstUnfinishedIndex = existingTodoList.findIndex((item: any) => item?.status !== 'completed');
		const insertIndex = firstUnfinishedIndex === -1
			? existingTodoList.length
			: firstUnfinishedIndex === 0
				? 1
				: firstUnfinishedIndex;
		const existingCompletedItems = existingTodoList.slice(0, insertIndex);
		const existingRemainingItems = existingTodoList.slice(insertIndex);
		const mergedTodoList = [...existingCompletedItems, ...todoList, ...existingRemainingItems].map((item: any, index: number) => ({
			...item,
			id: index + 1,
		}));
		const mergedTodoInput = {
			timestamp: new Date().toISOString(),
			todoList: mergedTodoList,
		};
		writeDebugFile('mergedTodoList.test.json', mergedTodoInput);

		return mergedTodoInput;
	} catch (error) {
		writeDebugFile(`todo_conflict_tool_result_error_${Date.now()}.json`, {
			error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
			todoData,
			timestamp: new Date().toISOString(),
		});
		return null;
	}
}

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
						apiType: (provider as any).apiType ?? 'openai-compatible',
						modelId: model.modelId,
						temperature: model.temperature ?? 0.7,
						topP: model.topP ?? 1.0,
						samplingMode: model.samplingMode ?? 'both',
						transformThink: model.transformThink ?? false,
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
		const apiType = (metadata.apiType as string) ?? 'openai-compatible';
		const temperature = metadata.temperature as number ?? 0.7;
		const topP = metadata.topP as number ?? 1.0;
		const samplingMode = (metadata.samplingMode as string) ?? 'both';
		const transformThink = (metadata.transformThink as boolean) ?? false;
		const forceTodoEnabled = this._configManager.getGlobalForceTodoEnabled() || this._configManager.getWorkspaceForceTodoEnabled();

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

		// Debug: Write system message content to system.txt for verification
		try {
			const systemMessages = requestBody.messages.filter((m: any) => m.role === 'system');
			writeDebugFile('system.txt', {
				count: systemMessages.length,
				messages: systemMessages,
				timestamp: new Date().toISOString()
			});
		} catch (e) {
			console.error('[DEBUG] Failed to write system debug file:', e);
		}

		// Only pass temperature/top_p based on samplingMode
		// Some models (e.g. Claude) don't support both simultaneously
		if (samplingMode === 'temperature') {
			requestBody.temperature = temperature;
		} else if (samplingMode === 'top_p') {
			requestBody.top_p = topP;
		} else if (samplingMode === 'none') {
			// Do not pass temperature or top_p
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
		let assistantResponse = ''; // Collect full response for chat history
		
		// Debug variables (declared outside try for finally access)
		let debugSseEvents: any[] = [];
		let debugConvertedChunks: any[] = [];
		let debugDeltaHandling: any[] = [];
		let debugPendingToolCalls: Array<[number, { id?: string; name?: string; arguments: string }]> = [];

		token.onCancellationRequested(() => {
			abortController.abort();
		});

		try {
			const isAnthropic = apiType === 'anthropic';
			const normalizedBase = baseUrl.replace(/\/+$/, '');
			const url = isAnthropic ? `${normalizedBase}/messages` : `${normalizedBase}/chat/completions`;
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (isAnthropic) {
				headers['x-api-key'] = apiKey;
				headers['anthropic-version'] = '2023-06-01';
			} else {
				headers['Authorization'] = `Bearer ${apiKey}`;
			}
			const finalBody = isAnthropic
				? convertOpenAIRequestToAnthropic(requestBody)
				: requestBody;

			const response = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(finalBody),
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
			// Track think tag state for transformThink
			const thinkState = { isInThinkTag: false, thinkBuffer: '' };
			// Anthropic streaming state (only used when isAnthropic)
			const anthState: AnthropicStreamState | null = isAnthropic
				? createAnthropicStreamState(modelId, true)
				: null;
			// Track the current SSE event name for Anthropic streams
			let currentEventName = '';
			let streamDone = false;

			// Debug: Collect raw SSE events for inspection (Anthropic only)
			debugSseEvents = [];
			debugConvertedChunks = [];
			debugDeltaHandling = [];

			// Process a single OpenAI-style delta (used for both OpenAI and converted Anthropic chunks)
			const handleOpenAIDelta = (delta: any) => {
				if (!delta) return;
				// Debug: Log delta handling
				debugDeltaHandling.push({ delta, pendingBefore: Array.from(pendingToolCalls.entries()) });
				const content: string | undefined = delta.content ?? undefined;
				if (typeof content === 'string' && content.length > 0) {
					if (transformThink) {
						this._processThinkTags(content, (text) => {
							progress.report(new vscode.LanguageModelTextPart(text));
						}, thinkState);
						assistantResponse += content;
					} else {
						progress.report(new vscode.LanguageModelTextPart(content));
						assistantResponse += content;
					}
				}

				const toolCalls = delta.tool_calls;
				if (toolCalls && Array.isArray(toolCalls)) {
					for (const tc of toolCalls) {
						const index = tc.index;
						const existing = pendingToolCalls.get(index) || { arguments: '' };
						if (tc.id) existing.id = tc.id;
						if (tc.function?.name) existing.name = tc.function.name;
						if (tc.function?.arguments !== undefined) existing.arguments += tc.function.arguments;
						pendingToolCalls.set(index, existing);
						// Don't try to parse/report here - wait for content_block_stop
						// when all arguments have been received
					}
				}
				if (debugDeltaHandling.length > 0) {
					debugDeltaHandling[debugDeltaHandling.length - 1].pendingAfter = Array.from(pendingToolCalls.entries());
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done || streamDone) {
				// Flush any remaining think content (without [Thinking] label)
				if (transformThink && thinkState.thinkBuffer.length > 0) {
					progress.report(new vscode.LanguageModelTextPart(`${thinkState.thinkBuffer}\n\n`));
						thinkState.thinkBuffer = '';
					}
					// Flush any completed tool calls that didn't get reported
					for (const [index, tc] of pendingToolCalls) {
						if (tc.name) {
							try {
								// Empty arguments string means no parameters - treat as empty object
								const argsStr = tc.arguments.trim();
								const parsedArgs = argsStr === '' ? {} : JSON.parse(argsStr);
								if (tc.name === 'manage_todo_list') {
									const mergedTodoInput = getMergedTodoInputForConflict(parsedArgs);
									const finalArgs = mergedTodoInput ?? parsedArgs;
									saveTodoToolState(finalArgs, forceTodoEnabled);
									progress.report(new vscode.LanguageModelToolCallPart(
										tc.id || `call_${index}`,
										tc.name,
										finalArgs
									));
									continue;
								}
								progress.report(new vscode.LanguageModelToolCallPart(
									tc.id || `call_${index}`,
									tc.name,
									parsedArgs
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
					if (!trimmedLine) {
						// Blank line indicates end of one SSE event; reset event name
						currentEventName = '';
						continue;
					}

					if (isAnthropic && trimmedLine.startsWith('event:')) {
						currentEventName = trimmedLine.slice(6).trim();
						continue;
					}

					if (trimmedLine === 'data: [DONE]') {
						continue;
					}

					if (trimmedLine.startsWith('data: ')) {
						try {
							const json = trimmedLine.slice(6);
							const parsed = JSON.parse(json);

							if (isAnthropic && anthState) {
								const eventType = currentEventName || (typeof parsed.type === 'string' ? parsed.type : '');
								// Debug: Collect important SSE events (non-text_delta)
								if (eventType && eventType !== 'message_delta' && !parsed.delta?.text) {
									debugSseEvents.push({ event: eventType, data: parsed });
								}
								const chunks: OpenAIChunk[] = convertAnthropicEventToOpenAIChunks(eventType, parsed, anthState);
								// Debug: Record converted chunks
								debugConvertedChunks.push({
									event: eventType,
									rawEvent: parsed,
									convertedChunks: chunks
								});
								for (const chunk of chunks) {
									if (chunk.done) {
										streamDone = true;
										break;
									}
									if (chunk.delta) {
										handleOpenAIDelta(chunk.delta);
									}
								}
								if (streamDone) break;
							} else {
								const delta = parsed.choices?.[0]?.delta;
								handleOpenAIDelta(delta);
							}
						} catch (e) {
							// Save SSE parse errors to file for debugging
								writeDebugFile(`sse_error_${Date.now()}.json`, {
									error: e instanceof Error ? { message: e.message, stack: e.stack } : String(e),
									line: trimmedLine,
									eventName: currentEventName,
									modelId,
									timestamp: new Date().toISOString()
								});
						}
					}
				}
				if (streamDone) {
					// Loop will exit on next iteration via top-of-loop check
				}
			}
			
			// Debug: Capture pending tool calls before exiting
			debugPendingToolCalls = Array.from(pendingToolCalls.entries());
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return; // Request was cancelled
			}
			// Save error details to file for debugging
			writeDebugFile(`error_${Date.now()}.json`, {
				error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : String(error),
				modelId,
				providerId,
				apiType,
				baseUrl,
				requestBody,
				timestamp: new Date().toISOString()
			});
			throw error;
		} finally {
			this._abortControllers.delete(providerId);
			
			// Save chat history after response completes
			if (assistantResponse) {
				const chatMessages = this._buildChatMessages(messages, assistantResponse);
				await this._configManager.saveChatHistory(chatMessages, modelId, options.tools ? [...options.tools] : undefined);
			}

			// Debug: Write response data to file
			writeDebugFile('debug_response.json', {
				assistantResponse,
				sseEvents: debugSseEvents,
				pendingToolCalls: debugPendingToolCalls,
				timestamp: new Date().toISOString()
			});
			// Also write detailed conversion debug
			writeDebugFile('debug_conversion.json', {
				convertedChunks: debugConvertedChunks,
				deltaHandling: debugDeltaHandling,
				finalPendingToolCalls: debugPendingToolCalls,
				timestamp: new Date().toISOString()
			});
		}
	}

	/**
	 * Build chat messages array for saving to history file
	 */
	private _buildChatMessages(
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		assistantResponse: string
	): Array<{ role: string; content: string; name?: string }> {
		const result: Array<{ role: string; content: string; name?: string }> = [];
		
		for (const msg of messages) {
			const role = this._mapRole(msg);
			const content = msg.content
				.filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
				.map(p => p.value)
				.join('');
			
			if (content) {
				// 合并连续的用户消息
				const lastMsg = result.length > 0 ? result[result.length - 1] : null;
				if (lastMsg && lastMsg.role === role && (role === 'user' || role === 'assistant')) {
					lastMsg.content += '\n' + content;
				} else {
					result.push({
						role,
						content,
						name: msg.name || undefined,
					});
				}
			}
		}
		
		// Add assistant response
		if (assistantResponse) {
			const lastMsg = result.length > 0 ? result[result.length - 1] : null;
			if (lastMsg && lastMsg.role === 'assistant') {
				lastMsg.content += '\n' + assistantResponse;
			} else {
				result.push({
					role: 'assistant',
					content: assistantResponse,
				});
			}
		}
		
		return result;
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

		// Collect all system prompt parts and merge into a single system message
		const systemParts: string[] = [];

		// 1. Custom global system prompt
		const globalPrompt = this._configManager.getGlobalSystemPrompt();
		if (globalPrompt) {
			systemParts.push(globalPrompt);
		}

		// 2. Custom workspace (project) system prompt
		const workspacePrompt = this._configManager.getWorkspaceSystemPrompt();
		if (workspacePrompt) {
			systemParts.push(workspacePrompt);
		}

		// 2.1 Force TODO prompt switch: check global first, then workspace/project
		const forceTodoEnabled = this._configManager.getGlobalForceTodoEnabled() || this._configManager.getWorkspaceForceTodoEnabled();
		const hasCurrentTodoTask = getCurrentTodoTaskContent() !== null;

		// 3. VS Code system messages (filtered)
		for (const message of messages) {
			if (this._mapRole(message) === 'system') {
				const filteredContent = this._filterSystemMessage(message, model);
				if (filteredContent) {
					systemParts.push(filteredContent);
				}
			}
		}

		// Push merged single system message
		if (systemParts.length > 0) {
			result.push({ role: 'system', content: systemParts.join('\n\n') });
		}

		for (const message of messages) {
			const role = this._mapRole(message);
			
			if (role === 'user') {
				const { textParts, toolResults } = this._extractUserContent(message);
				
				// If there are tool results, emit them as separate "tool" role messages FIRST
				for (const tr of toolResults) {
					result.push({
						role: 'tool',
						tool_call_id: tr.tool_call_id,
						content: hasCurrentTodoTask ? `${tr.text}\n\n${TODO_STATUS_UPDATE_PROMPT}` : tr.text,
					});
				}
				
				// Check if we should merge with the previous user message
				const lastMsg = result.length > 0 ? result[result.length - 1] : null;
				const canMerge = lastMsg && lastMsg.role === 'user' && toolResults.length === 0;
				
				if (textParts.length > 0) {
					// Check if it's a simple string or needs array format (for images)
					const hasNonText = textParts.some(p => p.type !== 'text');
					let content;
					if (hasNonText) {
						content = textParts;
					} else if (textParts.length === 1) {
						content = textParts[0].text;
					} else {
						content = textParts.map(p => p.text).join('\n');
					}
					
					if (canMerge) {
						// Merge with previous user message
						if (typeof lastMsg.content === 'string' && typeof content === 'string') {
							lastMsg.content += '\n' + content;
						} else if (Array.isArray(lastMsg.content) && Array.isArray(content)) {
							lastMsg.content = [...lastMsg.content, ...content];
						}
					} else {
						result.push({ role: 'user', content });
					}
				} else if (toolResults.length === 0 && !canMerge) {
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
			}
			// system messages are already merged above; skip here
		}

		// If the last message is user, append custom prompts to it for better model adherence
		if (result.length > 0) {
			const lastMsg = result[result.length - 1];
			if (lastMsg.role === 'user') {
				const promptAppendix: string[] = [];
				if (hasCurrentTodoTask) {
					promptAppendix.push(TODO_STATUS_UPDATE_PROMPT);
				}
				if (forceTodoEnabled) {
					const existingTodoTaskPrompt = getExistingTodoTaskPrompt();
					if (existingTodoTaskPrompt) {
						promptAppendix.push(existingTodoTaskPrompt);
					} else {
						promptAppendix.push('If there is no todo, please create one after analysis and execute in order. If a todo list already exists, continue using it and update item statuses after completing each one.');
					}
					promptAppendix.push(FORCE_TODO_PROMPT);
					promptAppendix.push(MANDATORY_TODO_PROMPT);
				}
				if (globalPrompt) { promptAppendix.push(globalPrompt); }
				if (workspacePrompt) { promptAppendix.push(workspacePrompt); }
				if (promptAppendix.length > 0) {
					const appendixText = '\n\n' + promptAppendix.join('\n\n');
					if (typeof lastMsg.content === 'string') {
						lastMsg.content += appendixText;
					} else if (Array.isArray(lastMsg.content)) {
						// If content is an array (multimodal), append as a new text part
						lastMsg.content.push({ type: 'text', text: appendixText });
					}
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
			const modelName = model.id || model.name;
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

	/**
	 * Process think tags in streaming content.
	 * When transformThink is enabled, this extracts content between <think> and </think> tags
	 * and reports them as separate text parts with a thinking indicator.
	 */
	private _processThinkTags(
		content: string,
		report: (text: string) => void,
		thinkState: { isInThinkTag: boolean; thinkBuffer: string }
	): boolean {
		let result = '';
		let i = 0;
		const len = content.length;

		while (i < len) {
			// Check for opening think tag
			if (content.startsWith('<think>', i)) {
				// Flush any accumulated normal content
				if (result.length > 0) {
					report(result);
					result = '';
				}
				thinkState.isInThinkTag = true;
				thinkState.thinkBuffer = '';
				i += 7; // length of '<think>'
				continue;
			}

			// Check for closing think tag
			if (content.startsWith('</think>', i)) {
				thinkState.isInThinkTag = false;
				// Report the think content as a thinking block
				if (thinkState.thinkBuffer.length > 0) {
					report(`${thinkState.thinkBuffer}\n\n`);
					thinkState.thinkBuffer = '';
				}
				i += 8; // length of '</think>'
				continue;
			}

			// Accumulate content
			if (thinkState.isInThinkTag) {
				thinkState.thinkBuffer += content[i];
			} else {
				result += content[i];
			}
			i++;
		}

		// Flush remaining normal content (but not incomplete think content)
		if (result.length > 0 && !thinkState.isInThinkTag) {
			report(result);
			return true;
		}

		return false;
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
