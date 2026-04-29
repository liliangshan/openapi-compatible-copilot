import * as vscode from 'vscode';
import { ConfigManager } from './configManager.js';
import { updateContextStatusBar, resetStatusBar } from './statusBar';
import {
	convertOpenAIRequestToAnthropic,
	convertAnthropicEventToOpenAIChunks,
	createAnthropicStreamState,
	type AnthropicStreamState,
} from './utils/anthropicConverter';
import { type OpenAIChunk } from './utils/openaiChunk';
import {
	convertChatCompletionsToResponsesAPI,
	createV1ResponseStreamState,
	convertV1ResponseEventToOpenAIChunks,
	type V1ResponseStreamState,
} from './utils/v1ResponseConverter';

const EXTENSION_LABEL = 'LLS OAI';
const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 16000;
const ASK_LLSOAI_TOOL_NAME = 'ask_llsoai';
const EXPERT_TOOL_CALL_PREFIX = 'llsoai';
const TODO_TOOL_NAME = 'manage_todo_list';

/**
 * Mask an API key for display, showing first 4 and last 4 characters
 */
function maskApiKey(key: string): string {
	if (!key || key.length <= 8) {
		return '****';
	}
	return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

interface CollectedToolCall {
	id: string;
	name: string;
	arguments: string;
	input: any;
}

interface ModelRequestParams {
	providerId: string;
	modelId: string;
	baseUrl: string;
	apiType: string;
	apiKey: string;
	requestBody: any;
	requestLabel?: string;
	transformThink?: boolean;
	progress?: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>;
	token: vscode.CancellationToken;
	reportText?: boolean;
}

interface ModelRequestResult {
	text: string;
	toolCalls: CollectedToolCall[];
}

interface ExpertRunState {
	runId: string;
	sessionId: string;
	askLlsoaiCallId: string;
	askLlsoaiArguments: any;
	expertContextRecords: any[];
	expertProviderId: string;
	expertModelId: string;
	expertRequestContext: MainRequestContext;
	expertMessages: any[];
	consumedToolResultCallIds: Set<string>;
	pendingExpertToolCallIds: string[];
	pendingExpertToolCalls: CollectedToolCall[];
	pendingExpertToolResults: Map<string, string>;
	pendingExpertUserFollowUps: string[];
	originalMainMessages: any[];
	mainRequestContext: MainRequestContext;
	mainTools: readonly any[];
	createdAt: number;
}

interface MainRequestContext {
	providerId: string;
	modelId: string;
	baseUrl: string;
	apiType: string;
	apiKey: string;
	temperature: number;
	topP: number;
	samplingMode: string;
	transformThink: boolean;
}

const FORCE_TODO_PROMPT = 'If there is no todo list, create one before making changes. If a todo list already exists, continue using the existing todo list, execute todo items in order, and update the todo status after completing each item.';
const TODO_STATUS_UPDATE_PROMPT = 'If an existing todo item is solved during this conversation, update the todo status when it is completed.';
const MANDATORY_TODO_PROMPT = 'You MUST use the TODO tool before taking any action. All TODO items must be clear, specific, and detailed with actionable steps. Do not execute any task without first creating or updating a TODO item. All work must be tracked through the TODO tool.';

function getCurrentTodoTaskContent(sessionId: string): string | null {
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return null;
		}

		const fs = require('fs');
		const path = require('path');
		const currentTaskPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'TODO', `task_${sessionId}.json`);
		if (!fs.existsSync(currentTaskPath)) {
			return null;
		}

		return fs.readFileSync(currentTaskPath, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Save manage_todo_list tool arguments into the active workspace .vscode/TODO folder.
 * Only saves when forceTodoEnabled is true.
 */
function saveTodoToolState(todoData: any, forceTodoEnabled: boolean, sessionId: string): void {
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
		const currentTaskPath = path.join(todoDir, `task_${sessionId}.json`);

		if (allCompleted) {
			// Append completed tasks to a daily archive file: task_YYYY-MM-DD.json
			const now = new Date();
			const timestamp = now.toISOString();
			const day = timestamp.slice(0, 10);
			const archivedPath = path.join(todoDir, `task_${day}.json`);
			const completedTask = {
				timestamp,
				todoList,
			};

			let archivedTasks: any[] = [];
			if (fs.existsSync(archivedPath)) {
				try {
					const existingArchive = JSON.parse(fs.readFileSync(archivedPath, 'utf8'));
					archivedTasks = Array.isArray(existingArchive) ? existingArchive : [existingArchive];
				} catch {
					archivedTasks = [];
				}
			}
			archivedTasks.push(completedTask);
			fs.writeFileSync(archivedPath, JSON.stringify(archivedTasks, null, 2));

			if (fs.existsSync(currentTaskPath)) {
				fs.unlinkSync(currentTaskPath);
			}
		} else {
			// Save current todo state to task.json
			fs.writeFileSync(currentTaskPath, JSON.stringify({
				timestamp: new Date().toISOString(),
				todoList,
			}, null, 2));
		}
	} catch {
		// Ignore errors when saving todo state
	}
}

function getExistingTodoTaskPrompt(sessionId: string): string | null {
	try {
		const existingTaskContent = getCurrentTodoTaskContent(sessionId);
		if (!existingTaskContent) {
			return null;
		}
		return 'TODO-LOCK: Active TODOs must finish first. Only after ALL active TODOs are completed may you process the user message below. Treat it as a queued next request, not as part of the active TODO. Do not create/merge/rename/reorder/replace TODOs until all active items are completed.';
	} catch {
		return null;
	}
}

/**
 * Return merged manage_todo_list input when the model tries to create a different
 * todo task while an unfinished task.json already exists.
 */
function getMergedTodoInputForConflict(todoData: any, sessionId: string): any | null {
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
		const currentTaskPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'TODO', `task_${sessionId}.json`);
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
		return mergedTodoInput;
	} catch {
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

function getFallbackChatSessionId(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
	for (const message of messages) {
		const role = message.role === vscode.LanguageModelChatMessageRole.User
			? 'user'
			: message.role === vscode.LanguageModelChatMessageRole.Assistant
				? 'assistant'
				: 'system';
		const text = message.content
			.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
			.map(part => part.value)
			.join('\n');
		if (text.trim()) {
			return require('crypto')
				.createHash('md5')
				.update(`${role}:${text}`)
				.digest('hex')
				.substring(0, 12);
		}
	}
	return 'unknown';
}

function getChatSessionId(
	options: vscode.ProvideLanguageModelChatResponseOptions,
	messages: readonly vscode.LanguageModelChatRequestMessage[]
): string {
	const rawOptions = options as any;
	const sessionId = rawOptions?.sessionId;
	if (typeof sessionId === 'string' && sessionId.trim()) {
		return sessionId;
	}
	return getFallbackChatSessionId(messages);
}

function isCompressionRequest(messages: readonly vscode.LanguageModelChatRequestMessage[]): boolean {
	const firstSystemText = messages
		.find(message => message.role !== vscode.LanguageModelChatMessageRole.User && message.role !== vscode.LanguageModelChatMessageRole.Assistant)
		?.content
		.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
		.map(part => part.value)
		.join('\n')
		.trim() || '';

	return firstSystemText.startsWith('Your task is to create a comprehensive')
		&& /summary|summar/i.test(firstSystemText);
}

/**
 * OpenAI-compatible Language Model Chat Provider
 */
export class OpenAPIChatModelProvider implements vscode.LanguageModelChatProvider {
	private _statusBarItem: vscode.StatusBarItem;
	private _abortControllers: Map<string, Set<AbortController>> = new Map();
	private _onDidChangeModels: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	private _expertRuns: Map<string, ExpertRunState> = new Map();
	private _activeExpertRunId?: string;

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

		const currentSessionId = getChatSessionId(options, messages);
		if (isCompressionRequest(messages) && this._getExpertRunForSession(currentSessionId)) {
			const compressionText = this._buildExpertCompressionResponse(currentSessionId);
			progress.report(new vscode.LanguageModelTextPart(compressionText));
			return;
		}

		const expertToolResults = this._findExpertToolResults(messages, currentSessionId);
		if (expertToolResults.length > 0) {
			for (const expertToolResult of expertToolResults) {
				await this._continueExpertFromToolResult(expertToolResult.runId, expertToolResult.originCallId, expertToolResult.prefixedCallId, expertToolResult.text, progress, token);
			}
			return;
		}

		const latestUserText = this._getLatestUserText(messages);
		const activeExpertRun = this._activeExpertRunId ? this._expertRuns.get(this._activeExpertRunId) : undefined;
		if (activeExpertRun && activeExpertRun.sessionId !== currentSessionId) {
			this._activeExpertRunId = undefined;
		}
		if (this._activeExpertRunId && activeExpertRun?.sessionId === currentSessionId && latestUserText) {
			await this._continueExpertFromUserMessage(this._activeExpertRunId, latestUserText, progress, token);
			return;
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

		const mainContext: MainRequestContext = {
			providerId,
			modelId,
			baseUrl,
			apiType,
			apiKey,
			temperature,
			topP,
			samplingMode,
			transformThink,
		};
		const expertModel = await this._getConfiguredExpertModel();
		const expertEnabled = !!expertModel;

		// Update token usage status bar
		await updateContextStatusBar(
			messages,
			options.tools,
			model,
			this._statusBarItem,
			async (text: string | vscode.LanguageModelChatRequestMessage) => this._estimateTokens(text)
		);

		// Build request body
		const requestBody: any = {
			model: modelId,
			messages: this._withExpertPrompt(this._convertMessages(messages, model, currentSessionId), expertEnabled),
			stream: true,
		};

		

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
		const apiTools = expertEnabled
			? [...(options.tools ?? []), this._buildAskLlsoaiTool()]
			: options.tools;
		if (apiTools && apiTools.length > 0) {
			requestBody.tools = apiTools
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

		const result = await this._requestModel({
			...mainContext,
			requestBody,
			requestLabel: 'main',
			progress,
			token,
			reportText: true,
		});

		if (result.toolCalls.length > 0) {
			for (const toolCall of result.toolCalls) {
				if (toolCall.name === ASK_LLSOAI_TOOL_NAME) {
					if (expertModel) {
						await this._startExpertRun(toolCall, expertModel, currentSessionId, requestBody.messages, mainContext, options.tools ?? [], progress, token);
					} else {
						await this._continueMainAfterUnavailableExpert(toolCall, requestBody.messages, mainContext, options.tools ?? [], progress, token);
					}
					continue;
				}
				let finalArgs = toolCall.input;
				if (toolCall.name === TODO_TOOL_NAME) {
					const mergedTodoInput = getMergedTodoInputForConflict(toolCall.input, currentSessionId);
					finalArgs = mergedTodoInput ?? toolCall.input;
					saveTodoToolState(finalArgs, forceTodoEnabled, currentSessionId);
				}
				progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, finalArgs));
			}
		}

		if (result.text) {
			const chatMessages = this._buildChatMessages(messages, result.text);
			await this._configManager.saveChatHistory(chatMessages, modelId, options.tools ? [...options.tools] : undefined);
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

	private async _requestModel(params: ModelRequestParams): Promise<ModelRequestResult> {
		const {
			providerId,
			modelId,
			baseUrl,
			apiType,
			apiKey,
			requestBody,
			requestLabel = 'model',
			transformThink = false,
			progress,
			token,
			reportText = true,
		} = params;
		const abortController = new AbortController();
		const providerAbortControllers = this._abortControllers.get(providerId) || new Set<AbortController>();
		providerAbortControllers.add(abortController);
		this._abortControllers.set(providerId, providerAbortControllers);
		let assistantResponse = '';
		const collectedToolCalls: CollectedToolCall[] = [];
		token.onCancellationRequested(() => {
			abortController.abort();
		});

		try {
			const isAnthropic = apiType === 'anthropic';
			const isV1Response = apiType === 'v1-response';
			const normalizedBase = baseUrl.replace(/\/+$/, '');
			let endpoint = '/chat/completions';
			if (isAnthropic) {
				endpoint = '/messages';
			} else if (isV1Response) {
				endpoint = '/responses';
			}
			const url = `${normalizedBase}${endpoint}`;
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (isAnthropic) {
				headers['x-api-key'] = apiKey;
				headers['anthropic-version'] = '2023-06-01';
			} else {
				headers['Authorization'] = `Bearer ${apiKey}`;
			}
			// Request body: v1-response needs conversion from chat completions format to Responses API format.
			// Note: Anthropic's /v1/responses API expects "input" and "instructions" instead of "messages" and "system".
			const finalBody = isAnthropic
				? convertOpenAIRequestToAnthropic(requestBody)
				: isV1Response
					? convertChatCompletionsToResponsesAPI(requestBody)
					: requestBody;

			// 创建带有掩码密钥头的格式化 headers
			const formatHeadersForError = (hdrs: Record<string, string>): string => {
				const formatted: string[] = [];
				for (const [key, value] of Object.entries(hdrs)) {
					if (key.toLowerCase() === 'authorization') {
						// Authorization: Bearer sk-xxx...xxxx
						const parts = value.split(' ');
						if (parts.length >= 2) {
							formatted.push(`${key}: ${parts[0]} ${maskApiKey(parts[1])}`);
						} else {
							formatted.push(`${key}: ${maskApiKey(value)}`);
						}
					} else if (key.toLowerCase() === 'x-api-key') {
						formatted.push(`${key}: ${maskApiKey(value)}`);
					} else {
						formatted.push(`${key}: ${value}`);
					}
				}
				return formatted.join('\n');
			};

			let response: Response;
			try {
				response = await fetch(url, {
					method: 'POST',
					headers,
					body: JSON.stringify(finalBody),
					signal: abortController.signal,
				});
			} catch (fetchError) {
				// fetch 失败时的详细错误信息
				const errorDetails = [
					`请求地址: ${url}`,
					`请求头:`,
					formatHeadersForError(headers),
					'',
					`错误: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
				].join('\n');

				throw new Error(`API 请求失败 (fetch failed)\n\n${errorDetails}`);
			}

			if (!response.ok) {
				const errorText = await response.text();
				const errorDetails = [
					`请求地址: ${url}`,
					`请求头:`,
					formatHeadersForError(headers),
					'',
					`HTTP 状态: ${response.status} ${response.statusText}`,
					`响应内容: ${errorText}`
				].join('\n');
				throw new Error(`API 请求失败\n\n${errorDetails}`);
			}

			if (!response.body) {
				throw new Error('No response body');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			const pendingToolCalls: Map<number, { id?: string; name?: string; arguments: string }> = new Map();
			const thinkState = { isInThinkTag: false, thinkBuffer: '' };
			const anthState: AnthropicStreamState | null = isAnthropic
				? createAnthropicStreamState(modelId, true)
				: null;
			const v1ResponseState: V1ResponseStreamState | null = isV1Response
				? createV1ResponseStreamState(modelId)
				: null;
			let currentEventName = '';
			let currentEventDataLines: string[] = [];
			let streamDone = false;

			const handleOpenAIDelta = (delta: any) => {
				if (!delta) return;
				const content: string | undefined = delta.content ?? undefined;
				if (typeof content === 'string' && content.length > 0) {
					assistantResponse += content;
					if (reportText && progress) {
						if (transformThink) {
							this._processThinkTags(content, (text) => {
								progress.report(new vscode.LanguageModelTextPart(text));
							}, thinkState);
						} else {
							progress.report(new vscode.LanguageModelTextPart(content));
						}
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
					}
				}
			};

			const processSseData = (data: string, eventName: string) => {
				const trimmedData = data.trim();
				if (!trimmedData) {
					return;
				}
				if (trimmedData.includes('}data:')) {
					for (const dataPart of trimmedData.split(/(?<=})data:\s*/g)) {
						processSseData(dataPart, eventName);
						if (streamDone) {
							return;
						}
					}
					return;
				}
				if (trimmedData === '[DONE]') {
					streamDone = true;
					return;
				}

				try {
					const parsed = JSON.parse(trimmedData);

					if (isAnthropic && anthState) {
						const eventType = eventName || (typeof parsed.type === 'string' ? parsed.type : '');
						const chunks: OpenAIChunk[] = convertAnthropicEventToOpenAIChunks(eventType, parsed, anthState);
						for (const chunk of chunks) {
							if (chunk.done) {
								streamDone = true;
								break;
							}
							if (chunk.delta) {
								handleOpenAIDelta(chunk.delta);
							}
						}
					} else if (isV1Response && v1ResponseState) {
						const eventType = eventName || (typeof parsed.type === 'string' ? parsed.type : '');
						const chunks: OpenAIChunk[] = convertV1ResponseEventToOpenAIChunks(eventType, parsed, v1ResponseState);
						for (const chunk of chunks) {
							if (chunk.done) {
								streamDone = true;
								break;
							}
							if (chunk.delta) {
								handleOpenAIDelta(chunk.delta);
							}
						}
					} else {
						const delta = parsed.choices?.[0]?.delta;
						handleOpenAIDelta(delta);
					}
				} catch (e) {
					if (trimmedData.includes('\n')) {
						for (const dataLine of trimmedData.split('\n')) {
							processSseData(dataLine, eventName);
							if (streamDone) {
								return;
							}
						}
						return;
					}
				}
			};

			const flushSseEvent = () => {
				if (currentEventDataLines.length === 0) {
					currentEventName = '';
					return;
				}
				const data = currentEventDataLines.join('\n');
				const eventName = currentEventName;
				currentEventName = '';
				currentEventDataLines = [];
				processSseData(data, eventName);
			};

			const collectPendingToolCalls = () => {
				for (const [index, tc] of pendingToolCalls) {
					if (!tc.name) {
						continue;
					}
					try {
						const argsStr = tc.arguments.trim();
						const parsedArgs = argsStr === '' ? {} : JSON.parse(argsStr);
						collectedToolCalls.push({
							id: tc.id || `call_${index}`,
							name: tc.name,
							arguments: argsStr,
							input: parsedArgs,
						});
					} catch {
						// ignore JSON parse errors
					}
				}
			};

			const processBuffer = () => {
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmedLine = line.trim();
					if (!trimmedLine) {
						flushSseEvent();
						continue;
					}

					if (trimmedLine.startsWith('event:')) {
						if (currentEventDataLines.length > 0) {
							flushSseEvent();
							if (streamDone) return;
						}
						currentEventName = trimmedLine.slice(6).trim();
						continue;
					}

					if (trimmedLine.startsWith('data:')) {
						if (!isAnthropic && !isV1Response && currentEventDataLines.length > 0) {
							flushSseEvent();
						}
						currentEventDataLines.push(trimmedLine.slice(5).trimStart());
						if (currentEventDataLines.length === 1 && currentEventDataLines[0] === '[DONE]') {
							flushSseEvent();
						}
					}
					if (streamDone) return;
				}
			};

			try {
				while (!streamDone) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}

					const decodedChunk = decoder.decode(value, { stream: true });
					buffer += decodedChunk;
					processBuffer();
				}
			} finally {
				try {
					await reader.cancel();
				} catch {
					// ignore
				}
			}

			// Final decoder flush & buffer processing
			const finalDecodedChunk = decoder.decode();
			buffer += finalDecodedChunk;
			if (buffer.trim()) {
				const tailLines = buffer.split('\n');
				for (const tailLine of tailLines) {
					const trimmedLine = tailLine.trim();
					if (!trimmedLine) {
						flushSseEvent();
						continue;
					}
					if (trimmedLine.startsWith('event:')) {
						currentEventName = trimmedLine.slice(6).trim();
						continue;
					}
					if (trimmedLine.startsWith('data:')) {
						currentEventDataLines.push(trimmedLine.slice(5).trimStart());
					}
				}
				buffer = '';
			}
			flushSseEvent();

			if (reportText && progress && transformThink && thinkState.thinkBuffer.length > 0) {
				progress.report(new vscode.LanguageModelTextPart(`${thinkState.thinkBuffer}\n\n`));
				thinkState.thinkBuffer = '';
			}
			collectPendingToolCalls();
			return { text: assistantResponse, toolCalls: collectedToolCalls };
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return { text: assistantResponse, toolCalls: collectedToolCalls };
			}
			throw error;
		} finally {
			const providerAbortControllers = this._abortControllers.get(providerId);
			if (providerAbortControllers) {
				providerAbortControllers.delete(abortController);
				if (providerAbortControllers.size === 0) {
					this._abortControllers.delete(providerId);
				}
			}
		}
	}

	private _applySamplingOptions(requestBody: any, context: MainRequestContext): void {
		if (context.samplingMode === 'temperature') {
			requestBody.temperature = context.temperature;
		} else if (context.samplingMode === 'top_p') {
			requestBody.top_p = context.topP;
		} else if (context.samplingMode !== 'none') {
			requestBody.temperature = context.temperature;
			requestBody.top_p = context.topP;
		}
	}

	private async _getConfiguredExpertModel(): Promise<(MainRequestContext & { providerName: string; modelName: string }) | null> {
		const config = this._configManager.getEffectiveExpertModeConfig();
		if (!config.enabled || !config.providerId || !config.modelId) {
			return null;
		}
		const providers = await this._configManager.getProvidersWithSecrets();
		const provider = providers.find((p) => p.id === config.providerId && p.enabled);
		const expertModel = provider?.models.find((m) => m.modelId === config.modelId);
		if (!provider || !expertModel || !provider.apiKey) {
			return null;
		}
		return {
			providerId: provider.id,
			providerName: provider.name,
			modelId: expertModel.modelId,
			modelName: (expertModel.displayName && expertModel.displayName.trim()) || expertModel.modelId,
			baseUrl: provider.baseUrl,
			apiType: (provider as any).apiType ?? 'openai-compatible',
			apiKey: provider.apiKey,
			temperature: expertModel.temperature ?? 0.7,
			topP: expertModel.topP ?? 1.0,
			samplingMode: expertModel.samplingMode ?? 'both',
			transformThink: expertModel.transformThink ?? false,
		};
	}

	private _buildAskLlsoaiTool(): any {
		return {
			name: ASK_LLSOAI_TOOL_NAME,
			description: 'Delegate a task to the configured LLS OAI expert model. The expert will NOT receive previous conversation history or the main model context, so the question must be self-contained and include the relevant user requirement, file paths, symbol names, error messages, attempted changes, and expected outcome needed to solve the task. This is not a pure analysis-only tool: the expert can independently analyze the problem and may use the same currently available VS Code tools as the main model, including file/search/error tools when available. Do not refuse delegation merely because the task may require tool or file access.',
			inputSchema: {
				type: 'object',
				properties: {
					question: { type: 'string', description: 'The self-contained concrete question or task for the expert model. Include all relevant requirements, file paths, symbol names, error messages, constraints, and expected outcome because previous conversation context is not sent to the expert.' },
					context: { type: 'string', description: 'Optional record-only context. This field is cached and shown to the user, but is not sent to the expert model. Put only non-essential previous conversation context here.' },
				},
				required: ['question'],
			},
		};
	}

	private _withExpertPrompt(messages: any[], enabled: boolean): any[] {
		if (!enabled) {
			return messages;
		}
		const prompt = `Expert mode is enabled. If you cannot confidently solve the task, need independent verification, need deeper investigation, or want another model to perform a tool-assisted subtask, call the tool ${ASK_LLSOAI_TOOL_NAME}. This tool starts an expert model run; it is not limited to pure analysis. The expert model can use the same currently available VS Code tools as you, including file/search/error tools when available. Do not refuse to call ${ASK_LLSOAI_TOOL_NAME} merely because the task may require tool or file access. The expert will NOT receive previous conversation history, your current message list, or the main model context. Therefore, the question you send to ${ASK_LLSOAI_TOOL_NAME} MUST be self-contained: include the user's concrete requirement, relevant file paths, active file/selection when useful, symbol/function names, constraints, errors, attempted changes, expected output, and any other information required for the expert to work independently. Do not pass long prior conversation history to the expert; instead summarize only the task-relevant facts inside question. If you need to preserve non-essential previous conversation context, put it in the optional context field as record-only context. The record-only context is not sent to the expert model. After the expert returns, continue as the main model and produce the final user-facing answer.`;
		const next = [...messages];
		const system = next.find(m => m.role === 'system');
		if (system && typeof system.content === 'string') {
			system.content += `\n\n${prompt}`;
		} else {
			next.unshift({ role: 'system', content: prompt });
		}
		return next;
	}

	private async _startExpertRun(
		toolCall: CollectedToolCall,
		expertContext: MainRequestContext & { providerName?: string; modelName?: string },
		sessionId: string,
		mainMessages: any[],
		mainContext: MainRequestContext,
		mainTools: readonly any[],
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		const expertContextRecords: any[] = [];
		const state: ExpertRunState = {
			runId,
			sessionId,
			askLlsoaiCallId: toolCall.id,
			askLlsoaiArguments: toolCall.input,
			expertContextRecords,
			expertProviderId: expertContext.providerId,
			expertModelId: expertContext.modelId,
			expertRequestContext: expertContext,
			expertMessages: this._buildExpertInitialMessages(toolCall.input, expertContext.modelId),
			consumedToolResultCallIds: new Set<string>(),
			pendingExpertToolCallIds: [],
			pendingExpertToolCalls: [],
			pendingExpertToolResults: new Map<string, string>(),
			pendingExpertUserFollowUps: [],
			originalMainMessages: mainMessages,
			mainRequestContext: mainContext,
			mainTools,
			createdAt: Date.now(),
		};
		this._expertRuns.set(runId, state);
		this._activeExpertRunId = runId;
		const expertModelName = expertContext.modelName || expertContext.modelId;
		progress.report(new vscode.LanguageModelTextPart(`\n\n### 🧠 LLSOAI Expert Mode Started\n\nmodelName: ${expertModelName}\n\nrunId: ${runId}\n\n`));
		await this._runExpertTurn(state, expertContext, progress, token);
	}

	private async _continueMainAfterUnavailableExpert(
		toolCall: CollectedToolCall,
		mainMessages: any[],
		mainContext: MainRequestContext,
		mainTools: readonly any[],
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const unavailableMessage = 'There is currently no available expert.';

		const requestBody: any = {
			model: mainContext.modelId,
			messages: [
				...mainMessages,
				{
					role: 'assistant',
					tool_calls: [{
						id: toolCall.id,
						type: 'function',
						function: {
							name: ASK_LLSOAI_TOOL_NAME,
							arguments: JSON.stringify(toolCall.input ?? {}),
						},
					}],
				},
				{
					role: 'tool',
					tool_call_id: toolCall.id,
					content: unavailableMessage,
				},
			],
			stream: true,
		};
		this._applySamplingOptions(requestBody, mainContext);
		if (mainTools.length > 0) {
			requestBody.tools = mainTools
				.filter((tool: any) => tool?.name !== ASK_LLSOAI_TOOL_NAME)
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
		const result = await this._requestModel({
			...mainContext,
			requestBody,
			requestLabel: `main_after_unavailable_expert_${Date.now()}`,
			progress,
			token,
			reportText: true,
		});
		for (const nextToolCall of result.toolCalls) {
			if (nextToolCall.name === ASK_LLSOAI_TOOL_NAME) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(nextToolCall.id, nextToolCall.name, nextToolCall.input));
		}
	}

	private _buildExpertInitialMessages(input: any, expertModelId: string): any[] {
		const question = typeof input?.question === 'string' ? input.question : JSON.stringify(input ?? {});
		return [
			{
				role: 'system',
				content: `You are LLSOAI expert mode. Your expert model ID is "${expertModelId}". Independently handle the delegated task from the question only. Previous conversation history and record-only context are intentionally not included in this expert request. You are not limited to analysis only: when tools are available, use them to inspect files, search text, check errors, gather evidence, or perform other tool-assisted investigation as needed. You may call the same currently available VS Code tools as the main model. Do not use TODO enforcement. Make intermediate reasoning and actions visible enough for the user to verify. When you have enough information, provide a clear final expert conclusion for the main model.`,
			},
			{
				role: 'user',
				content: `Question:\n${question}`,
			},
		];
	}

	private _buildExpertCompressionResponse(currentSessionId: string): string {
		const state = this._getExpertRunForSession(currentSessionId);

		if (!state) {
			return 'No active LLSOAI expert run context is currently available for this session.';
		}

		return [
			'LLSOAI expert mode context summary:',
			'',
			`runId: ${state.runId}`,
			`sessionId: ${state.sessionId}`,
			`expertModelId: ${state.expertModelId}`,
			'',
			'Original delegated request:',
			JSON.stringify(state.askLlsoaiArguments ?? {}, null, 2),
			'',
			'Expert context records:',
			JSON.stringify(state.expertContextRecords ?? [], null, 2),
			'',
			'Pending expert tool call ids:',
			JSON.stringify(state.pendingExpertToolCallIds ?? [], null, 2),
		].join('\n');
	}

	private _getExpertRunForSession(currentSessionId: string): ExpertRunState | undefined {
		const activeState = this._activeExpertRunId ? this._expertRuns.get(this._activeExpertRunId) : undefined;
		return activeState?.sessionId === currentSessionId
			? activeState
			: [...this._expertRuns.values()].find(run => run.sessionId === currentSessionId);
	}

	private _appendExpertContextRecord(state: ExpertRunState, record: any): void {
		state.expertContextRecords.push({
			...record,
			timestamp: new Date().toISOString(),
		});
	}

	private _buildExpertMessagesWithContext(state: ExpertRunState): any[] {
		const messages = [...state.expertMessages];
		if (state.expertContextRecords.length === 0) {
			return messages;
		}

		messages.push({
			role: 'user',
			content: `Expert context records from previous expert turns. Use this as the continuing expert context for this run:\n${JSON.stringify(state.expertContextRecords, null, 2)}`,
		});
		return messages;
	}

	private _filterExpertTools(tools: readonly any[]): any[] {
		return tools.filter((tool: any) => tool?.name !== TODO_TOOL_NAME);
	}

	private async _runExpertTurn(
		state: ExpertRunState,
		expertContext: MainRequestContext,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const requestBody: any = {
			model: expertContext.modelId,
			messages: this._buildExpertMessagesWithContext(state),
			stream: true,
		};
		this._applySamplingOptions(requestBody, expertContext);
		const expertTools = this._filterExpertTools(state.mainTools);
		if (expertTools.length > 0) {
			requestBody.tools = expertTools.map((tool: any) => ({
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

		const result = await this._requestModel({
			...expertContext,
			requestBody,
			requestLabel: `expert_${state.runId}`,
			progress,
			token,
			reportText: true,
		});

		if (result.toolCalls.length > 0) {
			const assistantMessage: any = { role: 'assistant', tool_calls: [] };
			if (result.text) {
				assistantMessage.content = result.text;
				this._appendExpertContextRecord(state, {
					type: 'expert_response',
					content: result.text,
				});
			}
			state.pendingExpertToolCallIds = result.toolCalls.map(toolCall => toolCall.id);
			state.pendingExpertToolCalls = result.toolCalls;
			state.pendingExpertToolResults = new Map<string, string>();
			for (const toolCall of result.toolCalls) {
				this._appendExpertContextRecord(state, {
					type: 'tool_call',
					callId: toolCall.id,
					name: toolCall.name,
					input: toolCall.input,
				});
				assistantMessage.tool_calls.push({
					id: toolCall.id,
					type: 'function',
					function: {
						name: toolCall.name,
						arguments: toolCall.arguments || JSON.stringify(toolCall.input ?? {}),
					},
				});
				progress.report(new vscode.LanguageModelToolCallPart(
					`${EXPERT_TOOL_CALL_PREFIX}:${state.runId}:${toolCall.id}`,
					toolCall.name,
					toolCall.input
				));
			}
			state.expertMessages.push(assistantMessage);
			return;
		}

		state.expertMessages.push({ role: 'assistant', content: result.text || '' });
		if (result.text) {
			this._appendExpertContextRecord(state, {
				type: 'expert_response',
				content: result.text,
			});
		}
		await this._finishExpertAndContinueMain(state, result.text || '', progress, token);
	}

	private async _continueExpertFromToolResult(
		runId: string,
		originCallId: string,
		prefixedCallId: string,
		text: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const state = this._expertRuns.get(runId);
		if (!state) {
			progress.report(new vscode.LanguageModelTextPart(`\n\nLLSOAI expert run ${runId} no longer exists. Unable to continue processing the tool result.\n\n`));
			return;
		}
		const expertContext = await this._getExpertContextFromState(state);
		state.consumedToolResultCallIds.add(prefixedCallId);
		this._appendExpertContextRecord(state, {
			type: 'tool_result',
			callId: originCallId,
			prefixedCallId,
			content: text,
		});
		if (state.pendingExpertToolCallIds.length === 0) {
			state.expertMessages.push({ role: 'tool', tool_call_id: originCallId, content: text });
			await this._runExpertTurn(state, expertContext, progress, token);
			return;
		}

		state.pendingExpertToolResults.set(originCallId, text);
		const missingToolCallIds = state.pendingExpertToolCallIds.filter(toolCallId => !state.pendingExpertToolResults.has(toolCallId));
		if (missingToolCallIds.length > 0) {
			progress.report(new vscode.LanguageModelTextPart(`\n\nLLSOAI expert is waiting for ${missingToolCallIds.length} more tool result(s) before continuing.\n\n`));
			this._reportPendingExpertToolCalls(state, missingToolCallIds, progress);
			return;
		}

		for (const toolCallId of state.pendingExpertToolCallIds) {
			state.expertMessages.push({
				role: 'tool',
				tool_call_id: toolCallId,
				content: state.pendingExpertToolResults.get(toolCallId) || '',
			});
		}
		state.pendingExpertToolCallIds = [];
		state.pendingExpertToolCalls = [];
		state.pendingExpertToolResults = new Map<string, string>();
		if (state.pendingExpertUserFollowUps.length > 0) {
			state.expertMessages.push({
				role: 'user',
				content: state.pendingExpertUserFollowUps.join('\n\n'),
			});
			state.pendingExpertUserFollowUps = [];
		}
		await this._runExpertTurn(state, expertContext, progress, token);
	}

	private async _continueExpertFromUserMessage(
		runId: string,
		text: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const state = this._expertRuns.get(runId);
		if (!state) {
			this._activeExpertRunId = undefined;
			return;
		}
		if (state.pendingExpertToolCallIds.length > 0) {
			const missingToolCallIds = state.pendingExpertToolCallIds.filter(toolCallId => !state.pendingExpertToolResults.has(toolCallId));
			state.pendingExpertUserFollowUps.push(text);
			progress.report(new vscode.LanguageModelTextPart(`\n\nLLSOAI expert is still waiting for ${missingToolCallIds.length} tool result(s). The user follow-up will be processed after the current expert tool calls finish.\n\n`));
			this._reportPendingExpertToolCalls(state, missingToolCallIds, progress);
			return;
		}
		const expertContext = await this._getExpertContextFromState(state);
		state.expertMessages.push({ role: 'user', content: text });
		this._appendExpertContextRecord(state, {
			type: 'user_follow_up',
			content: text,
		});
		progress.report(new vscode.LanguageModelTextPart('\n\n### 🧠 User Follow-up Forwarded to LLSOAI Expert\n\n'));
		await this._runExpertTurn(state, expertContext, progress, token);
	}

	private _reportPendingExpertToolCalls(
		state: ExpertRunState,
		toolCallIds: string[],
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
	): void {
		const missingIds = new Set(toolCallIds);
		for (const toolCall of state.pendingExpertToolCalls) {
			if (!missingIds.has(toolCall.id)) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(
				`${EXPERT_TOOL_CALL_PREFIX}:${state.runId}:${toolCall.id}`,
				toolCall.name,
				toolCall.input,
			));
		}
	}

	private async _getExpertContextFromState(state: ExpertRunState): Promise<MainRequestContext> {
		return state.expertRequestContext;
	}

	private async _finishExpertAndContinueMain(
		state: ExpertRunState,
		expertAnswer: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		this._expertRuns.delete(state.runId);
		if (this._activeExpertRunId === state.runId) {
			this._activeExpertRunId = undefined;
		}
		progress.report(new vscode.LanguageModelTextPart('\n\n### 🧠 LLSOAI Expert Result Returned to Main Model\n\n'));
		const mainMessages = [
			...state.originalMainMessages,
			{
				role: 'assistant',
				tool_calls: [{
					id: state.askLlsoaiCallId,
					type: 'function',
					function: {
						name: ASK_LLSOAI_TOOL_NAME,
						arguments: JSON.stringify(state.askLlsoaiArguments ?? {}),
					},
				}],
			},
			{
				role: 'tool',
				tool_call_id: state.askLlsoaiCallId,
				content: `${expertAnswer}\n\nI have completed the task. Please verify my work.`,
			},
		];
		const requestBody: any = {
			model: state.mainRequestContext.modelId,
			messages: mainMessages,
			stream: true,
		};
		this._applySamplingOptions(requestBody, state.mainRequestContext);
		if (state.mainTools.length > 0) {
			requestBody.tools = state.mainTools
				.filter((tool: any) => tool?.name !== ASK_LLSOAI_TOOL_NAME)
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
		const result = await this._requestModel({
			...state.mainRequestContext,
			requestBody,
			requestLabel: `main_after_expert_${state.runId}`,
			progress,
			token,
			reportText: true,
		});
		for (const toolCall of result.toolCalls) {
			if (toolCall.name === ASK_LLSOAI_TOOL_NAME) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, toolCall.input));
		}
	}

	private _findExpertToolResults(messages: readonly vscode.LanguageModelChatRequestMessage[], currentSessionId: string): Array<{ runId: string; originCallId: string; prefixedCallId: string; text: string }> {
		const lastMessage = messages[messages.length - 1];
		if (!lastMessage) {
			return [];
		}

		const results: Array<{ runId: string; originCallId: string; prefixedCallId: string; text: string }> = [];
		for (const part of lastMessage.content) {
			if (!isToolResultPart(part)) {
				continue;
			}
			const parsed = this._parseExpertCallId(part.callId);
			const state = parsed ? this._expertRuns.get(parsed.runId) : undefined;
			if (parsed && state && state.sessionId === currentSessionId && !state.consumedToolResultCallIds.has(part.callId)) {
				results.push({ ...parsed, prefixedCallId: part.callId, text: collectToolResultText(part) });
			}
		}
		return results;
	}

	private _parseExpertCallId(callId: string): { runId: string; originCallId: string } | null {
		const prefix = `${EXPERT_TOOL_CALL_PREFIX}:`;
		if (!callId.startsWith(prefix)) {
			return null;
		}
		const rest = callId.slice(prefix.length);
		const sep = rest.indexOf(':');
		if (sep <= 0) {
			return null;
		}
		return {
			runId: rest.slice(0, sep),
			originCallId: rest.slice(sep + 1),
		};
	}

	private _getLatestUserText(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
		const lastMessage = messages[messages.length - 1];
		if (!lastMessage || lastMessage.role !== vscode.LanguageModelChatMessageRole.User) {
			return '';
		}

		const text = lastMessage.content
			.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
			.map(part => part.value)
			.join('\n')
			.trim();
		if (text) {
			return text;
		}
		return '';
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
	private _convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[], model: vscode.LanguageModelChatInformation, sessionId: string): Array<any> {
		const result: Array<any> = [];
		const lastSourceMessage = messages[messages.length - 1];
		const isLastSourceMessageUser = lastSourceMessage?.role === vscode.LanguageModelChatMessageRole.User;
		const lastSourceUserText = isLastSourceMessageUser
			? lastSourceMessage.content
				.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
				.map(part => part.value)
				.join('\n')
			: '';
		const lastUserContainsTodoListTag = lastSourceUserText.includes('<todoList>');

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
		const hasCurrentTodoTask = getCurrentTodoTaskContent(sessionId) !== null;

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
				} else if (toolResults.length === 0) {
					// Skip empty user messages. VS Code may emit placeholder user messages
					// during tool/expert continuations; sending empty content can break
					// some OpenAI-compatible APIs.
					continue;
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
					if (isLastSourceMessageUser && !lastUserContainsTodoListTag) {
						promptAppendix.push(`TODO-LOCK: The user message below lacks <todoList>. It is a queued NEXT request, not a TODO item. Before any other action, call manage_todo_list with the exact active todoList below, finish ALL active unfinished TODOs in order, and update status after each item. Only after ALL active TODOs are completed may you process the user message below. Do not create/merge/rename/reorder/replace TODOs.\n\n${getCurrentTodoTaskContent(sessionId) || ''}`);
					} else {
						promptAppendix.push('TODO-LOCK: <todoList> is present. Do NOT recreate or modify TODO structure. Finish ALL active unfinished TODOs strictly in order and call manage_todo_list after each item. Only after ALL active TODOs are completed may you process the user message below.');
					}
					promptAppendix.push(TODO_STATUS_UPDATE_PROMPT);
				}
				if (forceTodoEnabled) {
					const existingTodoTaskPrompt = getExistingTodoTaskPrompt(sessionId);
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
					const promptText = promptAppendix.join('\n\n');
					const appendixText = hasCurrentTodoTask
						? `${promptText}\n\nUSER MESSAGE BELOW (process only after all active TODOs are completed):\n\n`
						: `\n\n${promptText}`;
					if (typeof lastMsg.content === 'string') {
						lastMsg.content = hasCurrentTodoTask
							? appendixText + lastMsg.content
							: lastMsg.content + appendixText;
					} else if (Array.isArray(lastMsg.content)) {
						// If content is an array (multimodal), prepend TODO-LOCK or append normal prompts as a text part
						if (hasCurrentTodoTask) {
							lastMsg.content.unshift({ type: 'text', text: appendixText });
						} else {
							lastMsg.content.push({ type: 'text', text: appendixText });
						}
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
				if (this._parseExpertCallId(part.callId)) {
					continue;
				}
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
				if (this._parseExpertCallId(part.callId)) {
					continue;
				}
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
