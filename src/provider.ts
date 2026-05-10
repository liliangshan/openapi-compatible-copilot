import * as vscode from 'vscode';
import { ConfigManager, type ResolvedAppLanguage } from './configManager.js';
import {
	OPTIMIZED_PROMPT_PREFIX,
	optimizePrompt,
	insertIntoChatInput,
	type PromptEnhancementResult,
} from './promptEnhancementStatusBar';
import {
	promptContextMessagesFromOpenAIMessages,
	promptContextMessagesFromVSCodeMessages,
	savePromptEnhancementContextCache,
} from './promptContextCache';
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
import { TimelineService, timelineErrorToJson } from './timeline/service';

const EXTENSION_LABEL = 'LLS OAI';
const DEFAULT_CONTEXT_LENGTH = 128000;

const AUTO_PROMPT_ENHANCEMENT_DONE_MESSAGE: Record<ResolvedAppLanguage, string> = {
	en: 'Prompt optimized. Please submit again, or edit it before submitting.',
	'zh-cn': '提示词已优化，请再次提交，或者修改后提交。',
	'zh-tw': '提示詞已最佳化，請再次提交，或修改後再提交。',
	ko: '프롬프트가 최적화되었습니다. 다시 제출하거나 수정한 후 제출하세요.',
	ja: 'プロンプトを最適化しました。再度送信するか、編集してから送信してください。',
	fr: 'Le prompt a été optimisé. Veuillez le soumettre à nouveau, ou le modifier avant de le soumettre.',
	de: 'Der Prompt wurde optimiert. Bitte erneut senden oder vor dem Senden bearbeiten.',
};
const DEFAULT_MAX_TOKENS = 16000;
const ASK_LLSOAI_TOOL_NAME = 'ask_llsoai';
const EXPERT_TOOL_CALL_PREFIX = 'llsoai';
const ASK_SOLUTION_PROVIDER_TOOL_NAME = 'ask_solution_provider';
const SOLUTION_TOOL_CALL_PREFIX = 'llsoai_solution';
const TODO_TOOL_NAME = 'manage_todo_list';
const TIMELINE_LIST_TOOL_NAME = 'timeline_list_by_file';
const TIMELINE_RESTORE_TOOL_NAME = 'timeline_restore_snapshot';
const TIMELINE_READ_LINES_TOOL_NAME = 'timeline_read_snapshot_lines';
const MAX_TIMELINE_TOOL_ROUNDS = 3;
const MAX_SOLUTION_EXPERT_REVIEW_COUNT = 2;
const MAX_FORCE_EXPERT_REVIEW_REMINDERS = 2;

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
	sessionId?: string;
	requestLabel?: string;
	transformThink?: boolean;
	progress?: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>;
	token: vscode.CancellationToken;
	reportText?: boolean;
}

interface ModelRequestResult {
	text: string;
	reasoningContent: string;
	toolCalls: CollectedToolCall[];
}

interface ExpertRunState {
	runId: string;
	sessionId: string;
	askLlsoaiCallId: string;
	askLlsoaiArguments: any;
	returnTarget: { type: 'main' } | { type: 'solution'; solutionRunId: string; solutionToolCallId: string };
	expertContextRecords: any[];
	expertProviderId: string;
	expertModelId: string;
	expertRequestContext: MainRequestContext;
	expertToolCalling: boolean;
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

interface SolutionRunState {
	runId: string;
	sessionId: string;
	askSolutionCallId: string;
	askSolutionArguments: any;
	solutionContextRecords: any[];
	solutionProviderId: string;
	solutionModelId: string;
	solutionDraftFile: string;
	solutionRequestContext: MainRequestContext;
	solutionMessages: any[];
	consumedToolResultCallIds: Set<string>;
	pendingSolutionToolCallIds: string[];
	pendingSolutionToolCalls: CollectedToolCall[];
	pendingSolutionToolResults: Map<string, string>;
	pendingSolutionUserFollowUps: string[];
	originalMainMessages: any[];
	mainRequestContext: MainRequestContext;
	mainTools: readonly any[];
	solutionToolCalling: boolean;
	reviewSkippedReason?: string;
	forceExpertReviewReminderCount: number;
	reviewWithExpert: boolean;
	expertReviewAvailable: boolean;
	requireInitialExpertReview: boolean;
	expertReviewCompleted: boolean;
	expertReviewCount: number;
	pendingExpertReviewCallId?: string;
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

function getReasoningCacheFilePath(sessionId: string): string {
	const os = require('os');
	const path = require('path');
	const safeSessionId = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
	return path.join(os.homedir(), '.LLSOAI', 'reasoning', `${safeSessionId}.json`);
}

function readReasoningCache(sessionId: string): Record<string, any> {
	try {
		const fs = require('fs');
		const filePath = getReasoningCacheFilePath(sessionId);
		if (!fs.existsSync(filePath)) {
			return {};
		}
		const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function writeReasoningCache(sessionId: string, cache: Record<string, any>): void {
	try {
		const fs = require('fs');
		const path = require('path');
		const filePath = getReasoningCacheFilePath(sessionId);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
	} catch {
		// Ignore reasoning cache write errors.
	}
}

function saveReasoningContentForToolCalls(sessionId: string | undefined, toolCalls: CollectedToolCall[], reasoningContent: string): void {
	if (!sessionId || toolCalls.length === 0 || !reasoningContent) {
		return;
	}
	const cache = readReasoningCache(sessionId);
	for (const toolCall of toolCalls) {
		cache[toolCall.id] = {
			reasoning_content: reasoningContent,
			updatedAt: new Date().toISOString(),
		};
	}
	writeReasoningCache(sessionId, cache);
}

function getReasoningContentForToolCall(sessionId: string, toolCallId: string): string | undefined {
	const cache = readReasoningCache(sessionId);
	const entry = cache[toolCallId];
	if (typeof entry === 'string') {
		return entry;
	}
	if (entry && typeof entry.reasoning_content === 'string') {
		return entry.reasoning_content;
	}
	return undefined;
}

function withReasoningContentForToolCall(sessionId: string, assistantMessage: any, toolCallId: string): any {
	const reasoningContent = getReasoningContentForToolCall(sessionId, toolCallId);
	if (!reasoningContent || assistantMessage?.role !== 'assistant' || !Array.isArray(assistantMessage.tool_calls)) {
		return assistantMessage;
	}
	const hasToolCall = assistantMessage.tool_calls.some((toolCall: any) => toolCall?.id === toolCallId);
	if (!hasToolCall) {
		return assistantMessage;
	}
	return {
		...assistantMessage,
		reasoning_content: reasoningContent,
	};
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
	private _activeExpertRunBySession: Map<string, string> = new Map();
	private _solutionRuns: Map<string, SolutionRunState> = new Map();
	private _activeSolutionRunId?: string;
	private _activeSolutionRunBySession: Map<string, string> = new Map();

	/**
	 * Event fired when the available set of language models changes.
	 * This tells VS Code to refresh the model list in Copilot.
	 */
	readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this._onDidChangeModels.event;

	constructor(
		private readonly _configManager: ConfigManager,
		statusBarItem: vscode.StatusBarItem,
		private readonly _timelineService?: TimelineService
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
		if (isCompressionRequest(messages) && this._getSolutionRunForSession(currentSessionId)) {
			const compressionText = this._buildSolutionCompressionResponse(currentSessionId);
			progress.report(new vscode.LanguageModelTextPart(compressionText));
			return;
		}

		const solutionToolResults = this._findSolutionToolResults(messages, currentSessionId);
		if (solutionToolResults.length > 0) {
			for (const solutionToolResult of solutionToolResults) {
				await this._continueSolutionFromToolResult(solutionToolResult.runId, solutionToolResult.originCallId, solutionToolResult.prefixedCallId, solutionToolResult.text, progress, token);
			}
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
		const latestUserRequestText = this._extractUserRequestText(latestUserText);
		const promptTextForEnhancement = latestUserRequestText || latestUserText;

		// ── Auto prompt enhancement interception ─────────────────────────────────
		const autoEnhanceConfig = this._configManager.getEffectivePromptEnhancementConfig();
		if (autoEnhanceConfig.enabled) {
			const lastMsg = messages[messages.length - 1];
			const isLastUser = lastMsg?.role === vscode.LanguageModelChatMessageRole.User;
			if (isLastUser && promptTextForEnhancement) {
				if (!this._hasOptimizedPromptPrefix(promptTextForEnhancement) && !promptTextForEnhancement.includes('creating a comprehensive')) {
					// No prefix → ask model if optimization is needed (skip if compressed context).
					const language = this._configManager.getResolvedLanguage();
					if (autoEnhanceConfig.providerId && autoEnhanceConfig.modelId) {
						let optimizationResult: PromptEnhancementResult = { status: false, prompt: promptTextForEnhancement };
						try {
							await this._savePromptContextCacheFromVSCodeMessages(currentSessionId, messages);
							optimizationResult = await optimizePrompt(this._configManager, promptTextForEnhancement, language, undefined, { sessionId: currentSessionId });
						} catch (err) {
							console.error('[Auto Prompt Enhancement] Failed:', err);
						}

						if (optimizationResult.status && optimizationResult.prompt?.trim()) {
							// Optimization needed and has valid prompt → insert optimized prompt and return.
							const prefixed = `${OPTIMIZED_PROMPT_PREFIX[language]}\n${optimizationResult.prompt}`;
							await insertIntoChatInput(prefixed, autoEnhanceConfig.autoSend);
							progress.report(new vscode.LanguageModelTextPart(AUTO_PROMPT_ENHANCEMENT_DONE_MESSAGE[language]));
							return;
						}
						// else: status is false OR prompt is empty → skip optimization, continue to main model request below.
					}
				} else {
					// Has prefix → will strip it below after message conversion.
				}
			}
		}
		// ── End auto prompt enhancement ──────────────────────────────────────────

		const activeExpertRun = this._getExpertRunForSession(currentSessionId);
		const activeExpertRunId = activeExpertRun?.runId;
		if (activeExpertRunId && latestUserText) {
			if (activeExpertRun.returnTarget.type === 'solution') {
				const solutionState = this._solutionRuns.get(activeExpertRun.returnTarget.solutionRunId);
				if (solutionState) {
					solutionState.pendingSolutionUserFollowUps.push(latestUserText);
					return;
				}
			}
			await this._continueExpertFromUserMessage(activeExpertRunId, latestUserText, progress, token);
			return;
		}
		const activeSolutionRun = this._getSolutionRunForSession(currentSessionId);
		if (activeSolutionRun?.runId && latestUserText) {
			await this._continueSolutionFromUserMessage(activeSolutionRun.runId, latestUserText, progress, token);
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
		const apiKey = (await this._configManager.getApiKey(providerId)).trim();
		if (apiType === 'anthropic' && !apiKey) {
			throw new Error(`No API key configured for Anthropic provider "${metadata.providerName}". Please configure it in the provider management UI.`);
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
		const solutionModel = await this._getConfiguredSolutionProviderModel();
		const solutionEnabled = !!solutionModel;

		// Update token usage status bar
		await updateContextStatusBar(
			messages,
			options.tools,
			model,
			this._statusBarItem,
			async (text: string | vscode.LanguageModelChatRequestMessage) => this._estimateTokens(text)
		);

		// Build request body
		let convertedMessages = this._convertMessages(
			messages,
			model,
			currentSessionId,
			expertEnabled,
			solutionEnabled,
			!!solutionModel?.reviewWithExpert && expertEnabled
		);

		// Strip the optimized prompt prefix from all user messages if the last user
		// message had the prefix (meaning this request originated from auto-enhancement).
		if (autoEnhanceConfig.enabled && this._hasOptimizedPromptPrefix(promptTextForEnhancement)) {
			this._stripOptimizedPromptPrefixFromMessages(convertedMessages);
		}

		await this._savePromptContextCacheFromOpenAIMessages(currentSessionId, convertedMessages);

		const requestBody: any = {
			model: modelId,
			messages: this._withSolutionProviderPrompt(
				this._withExpertPrompt(convertedMessages, expertEnabled),
				solutionEnabled,
				!!solutionModel?.reviewWithExpert && expertEnabled
			),
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
		const builtInTools = [
			...(this._timelineService ? this._buildTimelineTools() : []),
			...(expertEnabled ? [this._buildAskLlsoaiTool()] : []),
			...(solutionEnabled ? [this._buildAskSolutionProviderTool()] : []),
		];
		const apiTools = this._mergeToolsWithBuiltIns(options.tools ?? [], builtInTools);
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

		const result = await this._requestModelWithTimelineTools({
			...mainContext,
			requestBody,
			sessionId: currentSessionId,
			requestLabel: 'main',
			progress,
			token,
			reportText: true,
		});

		if (result.toolCalls.length > 0) {
			const internalToolCalls = result.toolCalls.filter(toolCall => toolCall.name === ASK_LLSOAI_TOOL_NAME || toolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME);
			const ordinaryToolCalls = result.toolCalls.filter(toolCall => toolCall.name !== ASK_LLSOAI_TOOL_NAME && toolCall.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME);
			if (internalToolCalls.length > 1 || (internalToolCalls.length > 0 && ordinaryToolCalls.length > 0)) {
				await this._continueMainAfterInvalidInternalToolCalls(internalToolCalls, ordinaryToolCalls, requestBody.messages, mainContext, apiTools, currentSessionId, progress, token);
				return;
			}
			for (const toolCall of result.toolCalls) {
				if (toolCall.name === ASK_LLSOAI_TOOL_NAME) {
					if (expertModel) {
						await this._startExpertRun(toolCall, expertModel, currentSessionId, requestBody.messages, mainContext, apiTools, progress, token);
					} else {
						await this._continueMainAfterUnavailableExpert(toolCall, requestBody.messages, mainContext, apiTools, currentSessionId, progress, token);
					}
					continue;
				}
				if (toolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
					if (solutionEnabled && solutionModel) {
						await this._startSolutionRun(toolCall, solutionModel, expertModel, currentSessionId, requestBody.messages, mainContext, apiTools, progress, token);
					} else {
						await this._continueMainAfterUnavailableSolutionProvider(toolCall, requestBody.messages, mainContext, apiTools, currentSessionId, progress, token);
					}
					continue;
				}
				let finalArgs = toolCall.input;
				if (toolCall.name === TODO_TOOL_NAME) {
					const mergedTodoInput = getMergedTodoInputForConflict(toolCall.input, currentSessionId);
					finalArgs = mergedTodoInput ?? toolCall.input;
					saveTodoToolState(finalArgs, forceTodoEnabled, currentSessionId);
				}
				// Create snapshot for read_file tool calls (OpenAI-Compatible format: params in arguments JSON string)
				if (toolCall.name === 'read_file') {
					let readFileInput = toolCall.input;
					let filePath = readFileInput?.filePath ?? readFileInput?.path;

					// If not found in input, try parsing from arguments (OpenAI-Compatible JSON string format)
					if (typeof filePath !== 'string' || !filePath) {
						if (typeof toolCall.arguments === 'string' && toolCall.arguments.trim()) {
							try {
								const parsedArgs = JSON.parse(toolCall.arguments);
								if (parsedArgs && typeof parsedArgs === 'object') {
									readFileInput = { ...(readFileInput ?? {}), ...parsedArgs };
									filePath = readFileInput?.filePath ?? readFileInput?.path;
								}
							} catch {
								// ignore parse error
							}
						}
					}

					if (typeof filePath === 'string' && filePath) {
						try {
							await this._timelineService?.checkAndCreateSnapshotByPath(filePath);
						} catch {
							// snapshot failure should not block tool call
						}
					}
				}
				progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, finalArgs));
			}
		}

		if (result.text) {
			const chatMessages = this._buildChatMessages(messages, result.text);
			await this._configManager.saveChatHistory(chatMessages, modelId, options.tools ? [...options.tools] : undefined);
			await this._savePromptContextCacheFromOpenAIMessages(currentSessionId, requestBody.messages, result.text);
		}
	}

	private async _continueMainAfterInvalidInternalToolCalls(
		internalToolCalls: CollectedToolCall[],
		ordinaryToolCalls: CollectedToolCall[],
		mainMessages: any[],
		mainContext: MainRequestContext,
		mainTools: readonly any[],
		sessionId: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const internalToolList = internalToolCalls.map(toolCall => `- ${toolCall.name} (${toolCall.id})`).join('\n');
		const rejectedToolList = ordinaryToolCalls.map(toolCall => `- ${toolCall.name} (${toolCall.id})`).join('\n');
		const reason = internalToolCalls.length > 1
			? 'Internal delegation was not started because this assistant message requested multiple internal delegation tool calls. Only one internal delegation tool call is allowed per assistant message.'
			: 'Internal delegation was not started because this assistant message mixed an internal delegation tool call with ordinary VS Code tool calls.';
		const requestBody: any = {
			model: mainContext.modelId,
			messages: [
				...mainMessages,
				withReasoningContentForToolCall(sessionId, {
					role: 'assistant',
					tool_calls: internalToolCalls.map(toolCall => this._toOpenAIToolCall(toolCall)),
				}, internalToolCalls[0]?.id ?? ''),
				...internalToolCalls.map((internalToolCall) => ({
					role: 'tool',
					tool_call_id: internalToolCall.id,
					content: [
						reason,
						'',
						'Internal delegation tool calls:',
						internalToolList,
						'',
						ordinaryToolCalls.length > 0 ? 'Ordinary tool calls that must be retried in a later assistant message:' : '',
						ordinaryToolCalls.length > 0 ? rejectedToolList : '',
						'',
						'Please continue by choosing exactly one path at a time: call one internal delegation tool alone, or call ordinary tools alone in the next assistant message.',
					].join('\n'),
				})),
			],
			stream: true,
		};
		this._applySamplingOptions(requestBody, mainContext);
		if (mainTools.length > 0) {
			requestBody.tools = mainTools
				.filter((tool: any) => tool?.name !== ASK_LLSOAI_TOOL_NAME && tool?.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME)
				.map((tool: any) => ({
					type: 'function',
					function: {
						name: tool.name,
						description: tool.description || '',
						parameters: tool.inputSchema && Object.keys(tool.inputSchema).length > 0 ? tool.inputSchema : { type: 'object', properties: {} },
					}
				}));
		}
		const result = await this._requestModel({ ...mainContext, requestBody, requestLabel: `main_after_invalid_internal_tools_${Date.now()}`, progress, token, reportText: true });
		await this._saveMainChatHistoryFromMessages(requestBody.messages, result.text, mainContext.modelId, mainTools);
		for (const toolCall of result.toolCalls) {
			if (toolCall.name === ASK_LLSOAI_TOOL_NAME || toolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, toolCall.input));
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

	private _buildChatMessagesFromOpenAIMessages(
		messages: any[],
		assistantResponse: string
	): Array<{ role: string; content: string; name?: string }> {
		const result: Array<{ role: string; content: string; name?: string }> = [];
		for (const msg of messages) {
			const role = typeof msg?.role === 'string' ? msg.role : 'user';
			let content = '';
			if (typeof msg?.content === 'string') {
				content = msg.content;
			} else if (Array.isArray(msg?.content)) {
				content = msg.content.map((part: any) => typeof part?.text === 'string' ? part.text : JSON.stringify(part)).join('\n');
			} else if (msg?.tool_calls) {
				content = `Tool calls made:\n${JSON.stringify(msg.tool_calls, null, 2)}`;
			}
			if (role === 'tool') {
				content = `[Tool result for ${msg.tool_call_id || 'unknown'}]: ${content}`;
			}
			if (!content) {
				continue;
			}
			const mappedRole = role === 'assistant' || role === 'system' ? role : 'user';
			const lastMsg = result.length > 0 ? result[result.length - 1] : null;
			if (lastMsg && lastMsg.role === mappedRole && (mappedRole === 'user' || mappedRole === 'assistant')) {
				lastMsg.content += '\n' + content;
			} else {
				result.push({ role: mappedRole, content });
			}
		}
		if (assistantResponse) {
			const lastMsg = result.length > 0 ? result[result.length - 1] : null;
			if (lastMsg && lastMsg.role === 'assistant') {
				lastMsg.content += '\n' + assistantResponse;
			} else {
				result.push({ role: 'assistant', content: assistantResponse });
			}
		}
		return result;
	}

	private async _saveMainChatHistoryFromMessages(
		messages: any[],
		assistantResponse: string,
		modelId: string,
		tools?: readonly any[]
	): Promise<void> {
		if (!assistantResponse && (!messages || messages.length === 0)) {
			return;
		}
		try {
			const chatMessages = this._buildChatMessagesFromOpenAIMessages(messages, assistantResponse);
			await this._configManager.saveChatHistory(chatMessages, modelId, tools ? [...tools] : undefined);
		} catch (error) {
			console.error('Failed to save main chat history:', error);
		}
	}

	private async _savePromptContextCacheFromVSCodeMessages(
		sessionId: string,
		messages: readonly vscode.LanguageModelChatRequestMessage[]
	): Promise<void> {
		try {
			const config = this._configManager.getEffectivePromptEnhancementContextCacheConfig();
			await savePromptEnhancementContextCache(
				sessionId,
				promptContextMessagesFromVSCodeMessages(messages),
				config
			);
		} catch (error) {
			console.error('Failed to save prompt context cache from VS Code messages:', error);
		}
	}

	private async _savePromptContextCacheFromOpenAIMessages(
		sessionId: string,
		messages: any[],
		assistantResponse?: string
	): Promise<void> {
		try {
			const config = this._configManager.getEffectivePromptEnhancementContextCacheConfig();
			await savePromptEnhancementContextCache(
				sessionId,
				promptContextMessagesFromOpenAIMessages(messages, assistantResponse),
				config
			);
		} catch (error) {
			console.error('Failed to save prompt context cache from OpenAI messages:', error);
		}
	}

	private _buildTimelineTools(): any[] {
		return [
			{
				name: TIMELINE_LIST_TOOL_NAME,
				description: 'List local timeline snapshots for a source file by absolute path or workspace-relative path.',
				inputSchema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						filePath: { type: 'string', description: 'Source file path. Absolute path or workspace-relative path.' },
						includeCommittedCleaned: { type: 'boolean', description: 'Whether to include lastGitCleanup info. Defaults to true.' },
					},
					required: ['filePath'],
				},
			},
			{
				name: TIMELINE_RESTORE_TOOL_NAME,
				description: 'Restore a local timeline snapshot for a file. Only restores snapshots still present in metadata and refuses tracked clean files.',
				inputSchema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						filePath: { type: 'string', description: 'Source file path. Absolute path or workspace-relative path.' },
						snapshotId: { type: 'string', description: 'Snapshot id returned by timeline_list_by_file.' },
						expectedSha256: { type: 'string', description: 'Optional expected snapshot sha256.' },
					},
					required: ['filePath', 'snapshotId'],
				},
			},
			{
				name: TIMELINE_READ_LINES_TOOL_NAME,
				description: 'Read a line range from a local timeline snapshot. Lines are 1-based and at most 200 lines are returned.',
				inputSchema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						filePath: { type: 'string', description: 'Source file path. Absolute path or workspace-relative path.' },
						snapshotId: { type: 'string', description: 'Snapshot id returned by timeline_list_by_file.' },
						startLine: { type: 'integer', minimum: 1, description: '1-based start line.' },
						lineCount: { type: 'integer', minimum: 1, maximum: 200, description: 'Number of lines to read, max 200.' },
					},
					required: ['filePath', 'snapshotId', 'startLine', 'lineCount'],
				},
			},
		];
	}

	private _mergeToolsWithBuiltIns(externalTools: readonly any[], builtIns: any[]): any[] {
		if (builtIns.length === 0) {
			return [...externalTools];
		}
		const builtInNames = new Set(builtIns.map(tool => tool.name));
		return [
			...externalTools.filter((tool: any) => !builtInNames.has(tool?.name)),
			...builtIns,
		];
	}

	private _isTimelineTool(name: string): boolean {
		return name === TIMELINE_LIST_TOOL_NAME || name === TIMELINE_RESTORE_TOOL_NAME || name === TIMELINE_READ_LINES_TOOL_NAME;
	}

	private _isInternalDelegationTool(name: string): boolean {
		return name === ASK_LLSOAI_TOOL_NAME || name === ASK_SOLUTION_PROVIDER_TOOL_NAME;
	}

	private _isToolHiddenFromChildModel(name: string): boolean {
		return name === TODO_TOOL_NAME || this._isInternalDelegationTool(name) || this._isTimelineTool(name);
	}

	private _buildSolutionDraftFilePath(runId: string): string {
		const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
		return `.LLSOAI/Solution/drafts/${timestamp}-${runId}-draft.md`;
	}

	private _isWriteFileToolName(name: string): boolean {
		return [
			'create_file',
			'write_file',
			'edit_file',
			'apply_patch',
			'replace_string_in_file',
			'multi_replace_string_in_file',
			'insert_edit_into_file',
		].includes(name);
	}

	private _normalizeWorkspaceRelativePathForPolicy(rawPath: unknown): string | null {
		if (typeof rawPath !== 'string' || !rawPath.trim()) {
			return null;
		}
		let candidate = rawPath.trim();
		try {
			if (candidate.startsWith('file://')) {
				candidate = vscode.Uri.parse(candidate).fsPath;
			}
		} catch {
			return null;
		}
		const path = require('path');
		let relativePath = candidate;
		if (path.isAbsolute(candidate)) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.find((folder) => {
				const rel = path.relative(folder.uri.fsPath, candidate);
				return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
			});
			if (!workspaceFolder) {
				return null;
			}
			relativePath = path.relative(workspaceFolder.uri.fsPath, candidate);
		}
		relativePath = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
		if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
			return null;
		}
		return relativePath;
	}

	private _extractWriteToolTargetPaths(toolCall: CollectedToolCall): string[] {
		const input = toolCall.input ?? {};
		const paths = new Set<string>();
		const addPath = (value: unknown) => {
			if (typeof value === 'string' && value.trim()) {
				paths.add(value.trim());
			}
		};
		addPath(input.filePath ?? input.path ?? input.uri ?? input.targetPath);
		if (toolCall.name === 'apply_patch') {
			const patchText = typeof input.input === 'string'
				? input.input
				: typeof input.patch === 'string'
					? input.patch
					: typeof toolCall.arguments === 'string'
						? toolCall.arguments
						: '';
			for (const line of patchText.split('\n')) {
				const match = line.match(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+?)(?:\s*$|\s+->\s+)/);
				if (match?.[1]) {
					addPath(match[1]);
				}
			}
		}
		return [...paths];
	}

	private _getSolutionWriteToolPolicyError(state: SolutionRunState, toolCall: CollectedToolCall): string | null {
		if (!this._isWriteFileToolName(toolCall.name)) {
			return null;
		}
		const targetPaths = this._extractWriteToolTargetPaths(toolCall);
		if (targetPaths.length === 0) {
			return `Write tool ${toolCall.name} was blocked because the target file path could not be determined. Files may only be written under .LLSOAI/Solution/`;
		}
		const solutionDir = '.LLSOAI/Solution';
		for (const targetPath of targetPaths) {
			const normalizedTarget = this._normalizeWorkspaceRelativePathForPolicy(targetPath);
			if (!normalizedTarget || !normalizedTarget.startsWith(solutionDir + '/')) {
				return `Write tool ${toolCall.name} was blocked because it attempted to write outside the .LLSOAI/Solution/ directory. Files may only be created under .LLSOAI/Solution/ with a descriptive name. Requested path: ${targetPath}`;
			}
		}
		return null;
	}

	private async _executeTimelineToolAsJson(name: string, input: any): Promise<string> {
		if (!this._timelineService) {
			return JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Timeline service is not available.', retryable: false } });
		}
		try {
			if (name === TIMELINE_LIST_TOOL_NAME) {
				return JSON.stringify(await this._timelineService.listSnapshotsByFile(String(input?.filePath ?? '')));
			}
			if (name === TIMELINE_RESTORE_TOOL_NAME) {
				return JSON.stringify(await this._timelineService.restoreSnapshotById(String(input?.filePath ?? ''), String(input?.snapshotId ?? ''), input?.expectedSha256));
			}
			if (name === TIMELINE_READ_LINES_TOOL_NAME) {
				return JSON.stringify(await this._timelineService.readSnapshotLines(String(input?.filePath ?? ''), String(input?.snapshotId ?? ''), Number(input?.startLine), Number(input?.lineCount)));
			}
			return JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: `Unknown timeline tool: ${name}`, retryable: false } });
		} catch (error) {
			return timelineErrorToJson(error);
		}
	}

	private _toOpenAIToolCall(toolCall: CollectedToolCall): any {
		return {
			id: toolCall.id,
			type: 'function',
			function: {
				name: toolCall.name,
				arguments: toolCall.arguments || JSON.stringify(toolCall.input ?? {}),
			},
		};
	}

	private async _requestModelWithTimelineTools(params: ModelRequestParams): Promise<ModelRequestResult> {
		let requestBody = params.requestBody;
		for (let round = 0; round <= MAX_TIMELINE_TOOL_ROUNDS; round++) {
			const result = await this._requestModel({
				...params,
				requestBody,
				requestLabel: round === 0 ? params.requestLabel : `${params.requestLabel ?? 'main'}_timeline_${round}`,
			});
			const timelineCalls = result.toolCalls.filter(call => this._isTimelineTool(call.name));
			if (timelineCalls.length === 0) {
				return result;
			}
			if (round === MAX_TIMELINE_TOOL_ROUNDS) {
				return {
					text: `${result.text}\n${JSON.stringify({ ok: false, error: { code: 'TOO_MANY_INTERNAL_TOOL_ROUNDS', message: 'Timeline tool call loop exceeded the maximum number of rounds.', retryable: false } })}`,
					reasoningContent: result.reasoningContent,
					toolCalls: result.toolCalls.filter(call => !this._isTimelineTool(call.name)),
				};
			}

			const nextMessages = [...(requestBody.messages ?? [])];
			nextMessages.push({
				role: 'assistant',
				content: result.text || null,
				tool_calls: timelineCalls.map(call => this._toOpenAIToolCall(call)),
			});
			for (const call of timelineCalls) {
				const resultText = await this._executeTimelineToolAsJson(call.name, call.input);
				params.progress?.report(new vscode.LanguageModelToolResultPart(call.id, [new vscode.LanguageModelTextPart(resultText)]));
				nextMessages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: resultText,
				});
			}
			requestBody = { ...requestBody, messages: nextMessages };
		}
		return { text: '', reasoningContent: '', toolCalls: [] };
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
		let assistantReasoningContent = '';
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
			} else if (apiKey) {
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
				if ('reasoning_content' in delta) {
					if (typeof delta.reasoning_content === 'string') {
						assistantReasoningContent += delta.reasoning_content;
					}
				}
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
			saveReasoningContentForToolCalls(params.sessionId, collectedToolCalls, assistantReasoningContent);
			return { text: assistantResponse, reasoningContent: assistantReasoningContent, toolCalls: collectedToolCalls };
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				saveReasoningContentForToolCalls(params.sessionId, collectedToolCalls, assistantReasoningContent);
				return { text: assistantResponse, reasoningContent: assistantReasoningContent, toolCalls: collectedToolCalls };
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

	private async _getConfiguredExpertModel(): Promise<(MainRequestContext & { providerName: string; modelName: string; toolCalling: boolean }) | null> {
		const config = this._configManager.getEffectiveExpertModeConfig();
		if (!config.enabled || !config.providerId || !config.modelId) {
			return null;
		}
		const providers = await this._configManager.getProvidersWithSecrets();
		const provider = providers.find((p) => p.id === config.providerId && p.enabled);
		const expertModel = provider?.models.find((m) => m.modelId === config.modelId);
		const apiKey = provider?.apiKey?.trim() || '';
		if (!provider || !expertModel || !apiKey) {
			return null;
		}
		return {
			providerId: provider.id,
			providerName: provider.name,
			modelId: expertModel.modelId,
			modelName: (expertModel.displayName && expertModel.displayName.trim()) || expertModel.modelId,
			baseUrl: provider.baseUrl,
			apiType: (provider as any).apiType ?? 'openai-compatible',
			apiKey,
			temperature: expertModel.temperature ?? 0.7,
			topP: expertModel.topP ?? 1.0,
			samplingMode: expertModel.samplingMode ?? 'both',
			transformThink: expertModel.transformThink ?? false,
			toolCalling: expertModel.toolCalling ?? true,
		};
	}

	private async _getConfiguredSolutionProviderModel(): Promise<(MainRequestContext & { providerName: string; modelName: string; reviewWithExpert: boolean; toolCalling: boolean }) | null> {
		const config = this._configManager.getEffectiveSolutionProviderConfig();
		if (!config.enabled || !config.providerId || !config.modelId) {
			return null;
		}
		const providers = await this._configManager.getProvidersWithSecrets();
		const provider = providers.find((p) => p.id === config.providerId && p.enabled);
		const solutionModel = provider?.models.find((m) => m.modelId === config.modelId);
		const apiKey = provider?.apiKey?.trim() || '';
		if (!provider || !solutionModel || !apiKey) {
			return null;
		}
		return {
			providerId: provider.id,
			providerName: provider.name,
			modelId: solutionModel.modelId,
			modelName: (solutionModel.displayName && solutionModel.displayName.trim()) || solutionModel.modelId,
			baseUrl: provider.baseUrl,
			apiType: (provider as any).apiType ?? 'openai-compatible',
			apiKey,
			temperature: solutionModel.temperature ?? 0.7,
			topP: solutionModel.topP ?? 1.0,
			samplingMode: solutionModel.samplingMode ?? 'both',
			transformThink: solutionModel.transformThink ?? false,
			reviewWithExpert: config.reviewWithExpert ?? false,
			toolCalling: solutionModel.toolCalling ?? true,
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

	private _buildAskSolutionProviderTool(): any {
		return {
			name: ASK_SOLUTION_PROVIDER_TOOL_NAME,
			description: 'Delegate solution design, implementation planning, architecture proposal, migration plan, risk analysis, or validation strategy to the configured LLS OAI solution provider model. The solution provider will NOT receive previous conversation history, so the request must be self-contained.',
			inputSchema: {
				type: 'object',
				properties: {
					question: { type: 'string', description: 'The self-contained solution design task. Include goals, constraints, relevant files, current state, expected deliverables, risks, and acceptance criteria.' },
					context: { type: 'string', description: 'Optional record-only context for user-visible logging; do not rely on this as full conversation history.' },
					expectedOutput: { type: 'string', description: 'Optional expected output format, such as implementation plan, phased roadmap, architecture proposal, migration plan, or checklist.' },
				},
				required: ['question'],
			},
		};
	}

	private _buildExpertPrompt(): string {
		return `Expert mode is enabled. If you cannot confidently solve the task, need independent verification, need deeper investigation, or want another model to perform a tool-assisted subtask, call the tool ${ASK_LLSOAI_TOOL_NAME}. This tool starts an expert model run; it is not limited to pure analysis. The expert model can use the same currently available VS Code tools as you, including file/search/error tools when available. Do not refuse to call ${ASK_LLSOAI_TOOL_NAME} merely because the task may require tool or file access. The expert will NOT receive previous conversation history, your current message list, or the main model context. Therefore, the question you send to ${ASK_LLSOAI_TOOL_NAME} MUST be self-contained: include the user's concrete requirement, relevant file paths, active file/selection when useful, symbol/function names, constraints, errors, attempted changes, expected output, and any other information required for the expert to work independently. Do not pass long prior conversation history to the expert; instead summarize only the task-relevant facts inside question. If you need to preserve non-essential previous conversation context, put it in the optional context field as record-only context. The record-only context is not sent to the expert model. After the expert returns, continue as the main model and produce the final user-facing answer.`;
	}

	private _buildSolutionProviderPrompt(reviewWithExpertAvailable: boolean): string {
		const reviewText = reviewWithExpertAvailable
			? ` If solution expert review is enabled and available, the solution provider will call ${ASK_LLSOAI_TOOL_NAME} internally before returning its final solution.`
			: '';
		return `Solution provider is enabled. If the user asks for a design specification solution, design plan, implementation plan, implementation roadmap, architecture proposal, phased migration plan, migration plan, risk analysis, validation strategy, or any other structured solution planning task, call the tool ${ASK_SOLUTION_PROVIDER_TOOL_NAME}. Use ${ASK_SOLUTION_PROVIDER_TOOL_NAME} for planning, design, architecture, roadmap, migration, risk analysis, validation strategy, and solution drafting. Use ${ASK_LLSOAI_TOOL_NAME} for independent investigation, verification, or expert review of difficult issues. The solution provider will NOT receive previous conversation history, so the question must be self-contained and include relevant goals, constraints, files, assumptions, expected output, and acceptance criteria. After the solution provider returns, continue as the main model and produce the final user-facing answer.${reviewText}`;
	}

	private _withExpertPrompt(messages: any[], enabled: boolean): any[] {
		if (!enabled) {
			return messages;
		}
		const prompt = this._buildExpertPrompt();
		const next = [...messages];
		const system = next.find(m => m.role === 'system');
		if (system && typeof system.content === 'string') {
			system.content += `\n\n${prompt}`;
		} else {
			next.unshift({ role: 'system', content: prompt });
		}
		return next;
	}

	private _withSolutionProviderPrompt(messages: any[], enabled: boolean, reviewWithExpertAvailable: boolean): any[] {
		if (!enabled) {
			return messages;
		}
		const prompt = this._buildSolutionProviderPrompt(reviewWithExpertAvailable);
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
		expertContext: MainRequestContext & { providerName?: string; modelName?: string; toolCalling?: boolean },
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
			returnTarget: { type: 'main' },
			expertContextRecords,
			expertProviderId: expertContext.providerId,
			expertModelId: expertContext.modelId,
			expertRequestContext: expertContext,
			expertToolCalling: expertContext.toolCalling ?? true,
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
		this._activeExpertRunBySession.set(sessionId, runId);
		const expertModelName = expertContext.modelName || expertContext.modelId;
		progress.report(new vscode.LanguageModelTextPart(`\n\n### 🧠 LLSOAI Expert Mode Started\n\nmodelName: ${expertModelName}\n\nrunId: ${runId}\n\n`));
		await this._runExpertTurn(state, expertContext, progress, token);
	}

	private async _continueMainAfterUnavailableExpert(
		toolCall: CollectedToolCall,
		mainMessages: any[],
		mainContext: MainRequestContext,
		mainTools: readonly any[],
		sessionId: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const unavailableMessage = 'There is currently no available expert.';

		const requestBody: any = {
			model: mainContext.modelId,
			messages: [
				...mainMessages,
				withReasoningContentForToolCall(sessionId, {
					role: 'assistant',
					tool_calls: [{
						id: toolCall.id,
						type: 'function',
						function: {
							name: ASK_LLSOAI_TOOL_NAME,
							arguments: JSON.stringify(toolCall.input ?? {}),
						},
					}],
				}, toolCall.id),
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
				.filter((tool: any) => tool?.name !== ASK_LLSOAI_TOOL_NAME && tool?.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME)
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
		await this._saveMainChatHistoryFromMessages(requestBody.messages, result.text, mainContext.modelId, mainTools);
		for (const nextToolCall of result.toolCalls) {
			if (nextToolCall.name === ASK_LLSOAI_TOOL_NAME || nextToolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
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
		const sessionRunId = this._activeExpertRunBySession.get(currentSessionId);
		const sessionState = sessionRunId ? this._expertRuns.get(sessionRunId) : undefined;
		if (sessionState?.sessionId === currentSessionId) {
			return sessionState;
		}
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
		return tools.filter((tool: any) => !this._isToolHiddenFromChildModel(tool?.name));
	}

	/**
	 * Build chat messages array for expert mode chat history
	 * Converts expert messages to the format expected by saveChatHistory
	 */
	private _buildExpertChatMessages(
		state: ExpertRunState,
		currentResponse?: string
	): Array<{ role: string; content: string; name?: string }> {
		const result: Array<{ role: string; content: string; name?: string }> = [];

		// Add system message indicating expert mode
		result.push({
			role: 'system',
			content: `LLSOAI expert mode. Expert model ID: ${state.expertModelId}. Return target: ${state.returnTarget.type}${state.returnTarget.type === 'solution' ? ` (solutionRunId: ${state.returnTarget.solutionRunId})` : ''}`,
		});

		// Add user's question
		const question = typeof state.askLlsoaiArguments?.question === 'string'
			? state.askLlsoaiArguments.question
			: JSON.stringify(state.askLlsoaiArguments ?? {}, null, 2);
		result.push({
			role: 'user',
			content: question,
		});

		// Add all expert messages from state
		for (const msg of state.expertMessages) {
			if (msg.role === 'assistant') {
				let content = '';
				if (msg.content) {
					content += msg.content;
				}
				if ((msg as any).tool_calls && (msg as any).tool_calls.length > 0) {
					if (content) {
						content += '\n\n';
					}
					content += 'Tool calls made:\n';
					for (const tc of (msg as any).tool_calls) {
						const func = tc.function || tc;
						content += `- ${func.name}: ${func.arguments || JSON.stringify(tc.input || {})}\n`;
					}
				}
				if (content) {
					result.push({ role: 'assistant', content });
				}
			} else if (msg.role === 'tool') {
				const toolMsg = msg as any;
				const content = `[Tool result for ${toolMsg.tool_call_id}]: ${toolMsg.content || ''}`;
				result.push({ role: 'user', content });
			} else if (msg.role === 'user') {
				const userContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
				if (userContent) {
					result.push({ role: 'user', content: userContent });
				}
			}
		}

		// Add current response if provided (for the response that just completed)
		if (currentResponse) {
			result.push({ role: 'assistant', content: currentResponse });
		}

		return result;
	}

	/**
	 * Save expert mode chat history
	 * Called after each expert response (tool call or text)
	 */
	private async _saveExpertChatHistory(
		state: ExpertRunState,
		currentResponse?: string
	): Promise<void> {
		try {
			const chatMessages = this._buildExpertChatMessages(state, currentResponse);
			const expertTools = this._filterExpertTools(state.mainTools);
			await this._configManager.saveChatHistory(
				chatMessages,
				state.expertModelId,
				expertTools.length > 0 ? expertTools : undefined
			);
		} catch (error) {
			console.error('Failed to save expert chat history:', error);
		}
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
		const expertTools = state.expertToolCalling ? this._filterExpertTools(state.mainTools) : [];
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
			// 流式处理完成后保存（消息已加入 state.expertMessages）
			await this._saveExpertChatHistory(state);
			return;
		}

		state.expertMessages.push({ role: 'assistant', content: result.text || '' });
		if (result.text) {
			this._appendExpertContextRecord(state, {
				type: 'expert_response',
				content: result.text,
			});
		}
		// 流式处理完成后保存（消息已加入 state.expertMessages）
		await this._saveExpertChatHistory(state);
		if (state.returnTarget.type === 'solution') {
			await this._finishExpertAndContinueSolution(state, result.text || '', progress, token);
		} else {
			await this._finishExpertAndContinueMain(state, result.text || '', progress, token);
		}
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
			try {
				await this._runExpertTurn(state, expertContext, progress, token);
			} catch (error) {
				if (state.returnTarget.type === 'solution') {
					await this._failExpertReviewBackToSolution(state, error, progress, token);
					return;
				}
				throw error;
			}
			return;
		}

		state.pendingExpertToolResults.set(originCallId, text);
		const missingToolCallIds = state.pendingExpertToolCallIds.filter(toolCallId => !state.pendingExpertToolResults.has(toolCallId));
		if (missingToolCallIds.length > 0) {
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
		try {
			await this._runExpertTurn(state, expertContext, progress, token);
		} catch (error) {
			if (state.returnTarget.type === 'solution') {
				await this._failExpertReviewBackToSolution(state, error, progress, token);
				return;
			}
			throw error;
		}
	}

	private async _failExpertReviewBackToSolution(
		state: ExpertRunState,
		error: unknown,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		this._expertRuns.delete(state.runId);
		this._activeExpertRunBySession.delete(state.sessionId);
		if (this._activeExpertRunId === state.runId) {
			this._activeExpertRunId = undefined;
		}
		if (state.returnTarget.type !== 'solution') {
			return;
		}
		const solutionState = this._solutionRuns.get(state.returnTarget.solutionRunId);
		if (!solutionState) {
			progress.report(new vscode.LanguageModelTextPart('\n\nExpert review failed, but the solution run no longer exists.\n\n'));
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		progress.report(new vscode.LanguageModelTextPart(`\n\n### ❌ Expert Review Failed\n\nError: ${message}\n\n`));
		solutionState.pendingExpertReviewCallId = undefined;
		solutionState.reviewSkippedReason = `expert review failed: ${message}`;
		solutionState.solutionMessages.push({
			role: 'tool',
			tool_call_id: state.returnTarget.solutionToolCallId,
			content: `Expert review failed: ${message}\n\nPlease continue by producing the best final solution based on available information, and mention that expert review failed.`,
		});
		if (solutionState.pendingSolutionUserFollowUps.length > 0) {
			solutionState.solutionMessages.push({
				role: 'user',
				content: solutionState.pendingSolutionUserFollowUps.join('\n\n'),
			});
			solutionState.pendingSolutionUserFollowUps = [];
		}
		await this._runSolutionTurn(solutionState, progress, token);
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
		this._activeExpertRunBySession.delete(state.sessionId);
		if (this._activeExpertRunId === state.runId) {
			this._activeExpertRunId = undefined;
		}
		progress.report(new vscode.LanguageModelTextPart('\n\n### 🧠 LLSOAI Expert Result Returned to Main Model\n\n'));
		const mainMessages = [
			...state.originalMainMessages,
			withReasoningContentForToolCall(state.sessionId, {
				role: 'assistant',
				tool_calls: [{
					id: state.askLlsoaiCallId,
					type: 'function',
					function: {
						name: ASK_LLSOAI_TOOL_NAME,
						arguments: JSON.stringify(state.askLlsoaiArguments ?? {}),
					},
				}],
			}, state.askLlsoaiCallId),
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
				.filter((tool: any) => tool?.name !== ASK_LLSOAI_TOOL_NAME && tool?.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME)
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
		await this._saveMainChatHistoryFromMessages(mainMessages, result.text, state.mainRequestContext.modelId, state.mainTools);
		for (const toolCall of result.toolCalls) {
			if (toolCall.name === ASK_LLSOAI_TOOL_NAME || toolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, toolCall.input));
		}
	}

	private async _finishExpertAndContinueSolution(
		state: ExpertRunState,
		expertAnswer: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		this._expertRuns.delete(state.runId);
		this._activeExpertRunBySession.delete(state.sessionId);
		if (this._activeExpertRunId === state.runId) {
			this._activeExpertRunId = undefined;
		}
		if (state.returnTarget.type !== 'solution') {
			return;
		}
		const solutionState = this._solutionRuns.get(state.returnTarget.solutionRunId);
		if (!solutionState) {
			progress.report(new vscode.LanguageModelTextPart('\n\nSolution run no longer exists. Expert review result cannot be applied.\n\n'));
			return;
		}
		progress.report(new vscode.LanguageModelTextPart('\n\n### ✅ Expert Review Returned to Solution Provider\n\n'));
		solutionState.expertReviewCompleted = true;
		solutionState.pendingExpertReviewCallId = undefined;
		solutionState.solutionMessages.push({
			role: 'tool',
			tool_call_id: state.returnTarget.solutionToolCallId,
			content: expertAnswer,
		});
		if (solutionState.pendingSolutionUserFollowUps.length > 0) {
			solutionState.solutionMessages.push({
				role: 'user',
				content: solutionState.pendingSolutionUserFollowUps.join('\n\n'),
			});
			solutionState.pendingSolutionUserFollowUps = [];
		}
		await this._runSolutionTurn(solutionState, progress, token);
	}

	private async _startSolutionRun(
		toolCall: CollectedToolCall,
		solutionContext: MainRequestContext & { providerName?: string; modelName?: string; reviewWithExpert: boolean; toolCalling: boolean },
		expertContext: (MainRequestContext & { providerName?: string; modelName?: string; toolCalling: boolean }) | null,
		sessionId: string,
		mainMessages: any[],
		mainContext: MainRequestContext,
		mainTools: readonly any[],
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		const solutionDraftFile = this._buildSolutionDraftFilePath(runId);
		const expertReviewAvailable = !!expertContext;
		const solutionToolCalling = solutionContext.toolCalling ?? true;
		const state: SolutionRunState = {
			runId,
			sessionId,
			askSolutionCallId: toolCall.id,
			askSolutionArguments: toolCall.input,
			solutionContextRecords: [],
			solutionProviderId: solutionContext.providerId,
			solutionModelId: solutionContext.modelId,
			solutionDraftFile,
			solutionRequestContext: solutionContext,
			solutionMessages: [],
			consumedToolResultCallIds: new Set<string>(),
			pendingSolutionToolCallIds: [],
			pendingSolutionToolCalls: [],
			pendingSolutionToolResults: new Map<string, string>(),
			pendingSolutionUserFollowUps: [],
			originalMainMessages: mainMessages,
			mainRequestContext: mainContext,
			mainTools,
			solutionToolCalling,
			forceExpertReviewReminderCount: 0,
			reviewWithExpert: !!solutionContext.reviewWithExpert,
			expertReviewAvailable,
			requireInitialExpertReview: !!solutionContext.reviewWithExpert && expertReviewAvailable && solutionToolCalling,
			expertReviewCompleted: false,
			expertReviewCount: 0,
			createdAt: Date.now(),
		};
		if (state.reviewWithExpert && !expertReviewAvailable) {
			state.reviewSkippedReason = 'expert review is enabled but expert mode is not currently available';
		} else if (state.reviewWithExpert && !solutionToolCalling) {
			state.reviewSkippedReason = 'solution model does not support tool calling';
		}
		state.solutionMessages = this._buildSolutionInitialMessages(toolCall.input, solutionContext.modelId, state);
		this._solutionRuns.set(runId, state);
		this._activeSolutionRunId = runId;
		this._activeSolutionRunBySession.set(sessionId, runId);
		const solutionModelName = solutionContext.modelName || solutionContext.modelId;
		progress.report(new vscode.LanguageModelTextPart(`\n\n### 🧭 LLSOAI Solution Provider Started\n\nmodelName: ${solutionModelName}\n\nrunId: ${runId}\n\n`));
		await this._runSolutionTurn(state, progress, token);
	}

	private _buildSolutionInitialMessages(input: any, solutionModelId: string, state: SolutionRunState): any[] {
		const question = typeof input?.question === 'string' ? input.question : JSON.stringify(input ?? {});
		const expectedOutput = typeof input?.expectedOutput === 'string' ? input.expectedOutput : '';
		const context = typeof input?.context === 'string' ? input.context : '';
		const reviewPrompt = state.requireInitialExpertReview
			? `\n\nSolution expert review is enabled. You have access to the ${ASK_LLSOAI_TOOL_NAME} tool for expert review. Before you produce your final solution provider result, you MUST call ${ASK_LLSOAI_TOOL_NAME} at least once to review your proposed solution. The request must include the original delegated task, your proposed solution, relevant files, constraints, assumptions, acceptance criteria, and exact review criteria. Review criteria must include: Correctness, Completeness, Feasibility, Risks and edge cases, Missing constraints or assumptions, Validation plan, Required changes, Optional improvements, and Final recommendation. Do not call ${ASK_LLSOAI_TOOL_NAME} in the same assistant message as ordinary tools. First gather evidence with ordinary tools, wait for their results, draft a complete proposal, then call ${ASK_LLSOAI_TOOL_NAME} with the complete proposal. If you saved the solution draft as Markdown, include solutionFile plus solutionSummary and reviewFocus; do not pass only the path. If the file cannot be read by the expert, include fallbackInlineSolution. After the expert review returns, revise or confirm your solution and then produce the final solution provider result.`
			: '';
		const persistencePrompt = `\n\nSolution draft persistence guidance:\nYou may persist the full solution as a Markdown file when doing so improves traceability, expert review quality, or avoids very long inline responses. If you decide to persist the solution, place it under the .LLSOAI/Solution/ directory with a descriptive name that reflects the task and solution type (e.g., .LLSOAI/Solution/\${task-name}-impl-plan.md, .LLSOAI/Solution/\${feature}-migration-guide.md, .LLSOAI/Solution/\${problem}-fix-proposal.md). Do not create or modify files outside .LLSOAI/Solution/. Saving is recommended when the solution is long or multi-phase, expert review is enabled, the task includes architecture/migration/implementation plan details, or the user may need to review, reuse, or audit the plan later. Saving can be skipped when the solution is short, no file writing tool is available, workspace persistence appears unavailable, the task is exploratory, or the user explicitly asked not to write files. Your final solution provider result must include writeStatus (succeeded/skipped/failed), solutionSummary, solutionFile if saved, fullSolutionInline if not saved, and writeReason/writeError when applicable.`;
		return [
			{
				role: 'system',
				content: `You are LLSOAI solution provider. Your solution model ID is "${solutionModelId}". Your job is to draft a clear, actionable solution or implementation plan for the delegated task. Focus on goals, constraints, affected files/modules, phased steps, risks, validation plan, rollback plan, and open questions. Use tools when available to inspect the workspace and make the plan grounded in the actual project. Do not call ${ASK_SOLUTION_PROVIDER_TOOL_NAME}. Do not use TODO enforcement. When finished, produce a final solution proposal for the main model.${persistencePrompt}${reviewPrompt}`,
			},
			{
				role: 'user',
				content: `Question:\n${question}${context ? `\n\nRecord-only context:\n${context}` : ''}${expectedOutput ? `\n\nExpected output:\n${expectedOutput}` : ''}`,
			},
		];
	}

	private _appendSolutionContextRecord(state: SolutionRunState, record: any): void {
		state.solutionContextRecords.push({
			...record,
			timestamp: new Date().toISOString(),
		});
	}

	private _buildSolutionChatMessages(
		state: SolutionRunState,
		currentResponse?: string
	): Array<{ role: string; content: string; name?: string }> {
		const result: Array<{ role: string; content: string; name?: string }> = [];
		result.push({
			role: 'system',
			content: [
				`LLSOAI solution provider. Solution model ID: ${state.solutionModelId}`,
				`Run ID: ${state.runId}`,
				`Solution files directory: .LLSOAI/Solution/`,
				`Review with expert: ${state.reviewWithExpert}`,
				state.reviewSkippedReason ? `Review skipped reason: ${state.reviewSkippedReason}` : '',
			].filter(Boolean).join('\n'),
		});
		for (const msg of state.solutionMessages) {
			if (msg.role === 'assistant') {
				let content = '';
				if (msg.content) {
					content += msg.content;
				}
				if ((msg as any).tool_calls && (msg as any).tool_calls.length > 0) {
					if (content) {
						content += '\n\n';
					}
					content += 'Tool calls made:\n';
					for (const tc of (msg as any).tool_calls) {
						const func = tc.function || tc;
						content += `- ${func.name}: ${func.arguments || JSON.stringify(tc.input || {})}\n`;
					}
				}
				if (content) {
					result.push({ role: 'assistant', content });
				}
			} else if (msg.role === 'tool') {
				const toolMsg = msg as any;
				result.push({ role: 'user', content: `[Tool result for ${toolMsg.tool_call_id}]: ${toolMsg.content || ''}` });
			} else if (msg.role === 'user') {
				const userContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
				if (userContent) {
					result.push({ role: 'user', content: userContent });
				}
			}
		}
		if (currentResponse) {
			result.push({ role: 'assistant', content: currentResponse });
		}
		return result;
	}

	private async _saveSolutionChatHistory(
		state: SolutionRunState,
		currentResponse?: string
	): Promise<void> {
		try {
			const chatMessages = this._buildSolutionChatMessages(state, currentResponse);
			const solutionTools = this._filterSolutionTools(state, state.mainTools);
			await this._configManager.saveChatHistory(
				chatMessages,
				state.solutionModelId,
				solutionTools.length > 0 ? solutionTools : undefined
			);
		} catch (error) {
			console.error('Failed to save solution provider chat history:', error);
		}
	}

	private _buildSolutionMessagesWithContext(state: SolutionRunState): any[] {
		return [...state.solutionMessages];
	}

	private _filterSolutionTools(state: SolutionRunState, tools: readonly any[]): any[] {
		if (!state.solutionToolCalling) {
			return [];
		}
		return tools.filter((tool: any) => {
			if (tool?.name === ASK_SOLUTION_PROVIDER_TOOL_NAME || tool?.name === TODO_TOOL_NAME || this._isTimelineTool(tool?.name)) {
				return false;
			}
			if (tool?.name === ASK_LLSOAI_TOOL_NAME) {
				return state.reviewWithExpert && state.expertReviewAvailable;
			}
			return true;
		});
	}

	private async _runSolutionTurn(
		state: SolutionRunState,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const requestBody: any = {
			model: state.solutionRequestContext.modelId,
			messages: this._buildSolutionMessagesWithContext(state),
			stream: true,
		};
		this._applySamplingOptions(requestBody, state.solutionRequestContext);
		const solutionTools = this._filterSolutionTools(state, state.mainTools);
		if (solutionTools.length > 0) {
			requestBody.tools = solutionTools.map((tool: any) => ({
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
			...state.solutionRequestContext,
			requestBody,
			requestLabel: `solution_${state.runId}`,
			progress,
			token,
			reportText: true,
		});

		if (result.toolCalls.length > 0) {
			const assistantMessage: any = { role: 'assistant', tool_calls: [] };
			if (result.text) {
				assistantMessage.content = result.text;
				this._appendSolutionContextRecord(state, { type: 'solution_response', content: result.text });
			}
			for (const toolCall of result.toolCalls) {
				assistantMessage.tool_calls.push(this._toOpenAIToolCall(toolCall));
				this._appendSolutionContextRecord(state, { type: 'tool_call', callId: toolCall.id, name: toolCall.name, input: toolCall.input });
			}
			state.solutionMessages.push(assistantMessage);
			await this._saveSolutionChatHistory(state);

			const ordinaryCalls = result.toolCalls.filter(toolCall => toolCall.name !== ASK_LLSOAI_TOOL_NAME && toolCall.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME);
			const expertCalls = result.toolCalls.filter(toolCall => toolCall.name === ASK_LLSOAI_TOOL_NAME);
			const recursiveCalls = result.toolCalls.filter(toolCall => toolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME);
			const allowedOrdinaryCalls: CollectedToolCall[] = [];
			let appendedImmediateToolResult = false;

			for (const recursiveCall of recursiveCalls) {
				state.solutionMessages.push({ role: 'tool', tool_call_id: recursiveCall.id, content: 'Recursive ask_solution_provider calls are not allowed. Continue with the current solution task directly.' });
				appendedImmediateToolResult = true;
			}

			if (expertCalls.length > 0 && ordinaryCalls.length > 0) {
				for (const expertCall of expertCalls) {
					state.solutionMessages.push({
						role: 'tool',
						tool_call_id: expertCall.id,
						content: `Expert review was not started because ${ASK_LLSOAI_TOOL_NAME} was called in the same assistant message as ordinary tools. Please wait for ordinary tool results, update the proposal, then call ${ASK_LLSOAI_TOOL_NAME} again with the complete proposal.`,
					});
					appendedImmediateToolResult = true;
				}
			}

			for (const ordinaryCall of ordinaryCalls) {
				const policyError = this._getSolutionWriteToolPolicyError(state, ordinaryCall);
				if (policyError) {
					state.solutionMessages.push({ role: 'tool', tool_call_id: ordinaryCall.id, content: policyError });
					appendedImmediateToolResult = true;
				} else {
					allowedOrdinaryCalls.push(ordinaryCall);
				}
			}

			if (allowedOrdinaryCalls.length > 0) {
				state.pendingSolutionToolCallIds = allowedOrdinaryCalls.map(toolCall => toolCall.id);
				state.pendingSolutionToolCalls = allowedOrdinaryCalls;
				state.pendingSolutionToolResults = new Map<string, string>();
				for (const toolCall of allowedOrdinaryCalls) {
					progress.report(new vscode.LanguageModelToolCallPart(
						`${SOLUTION_TOOL_CALL_PREFIX}:${state.runId}:${toolCall.id}`,
						toolCall.name,
						toolCall.input,
					));
				}
				return;
			}

			if (expertCalls.length > 0) {
				const firstExpertCall = expertCalls[0];
				for (const extraExpertCall of expertCalls.slice(1)) {
					state.solutionMessages.push({ role: 'tool', tool_call_id: extraExpertCall.id, content: 'Only one expert review can be processed at a time. Continue after the first expert review result.' });
				}
				await this._startExpertReviewForSolutionRun(state, firstExpertCall, progress, token);
				return;
			}

			if (appendedImmediateToolResult) {
				await this._runSolutionTurn(state, progress, token);
			}
			return;
		}

		state.solutionMessages.push({ role: 'assistant', content: result.text || '' });
		if (result.text) {
			this._appendSolutionContextRecord(state, { type: 'solution_response', content: result.text });
		}
		await this._saveSolutionChatHistory(state);
		if (state.requireInitialExpertReview && !state.expertReviewCompleted) {
			if (state.forceExpertReviewReminderCount >= MAX_FORCE_EXPERT_REVIEW_REMINDERS) {
				state.reviewSkippedReason = 'solution model did not call ask_llsoai after required reminders';
				state.requireInitialExpertReview = false;
				await this._finishSolutionAndContinueMain(state, result.text || '', progress, token);
				return;
			}
			state.forceExpertReviewReminderCount += 1;
			state.solutionMessages.push({
				role: 'user',
				content: [
					'Expert review is required before finalizing the solution.',
					`You have not called ${ASK_LLSOAI_TOOL_NAME} yet, or the expert review has not completed.`,
					`Please call ${ASK_LLSOAI_TOOL_NAME} now to review your proposed solution.`,
					'Do not produce the final solution provider result until the expert review result is returned.',
				].join('\n'),
			});
			await this._runSolutionTurn(state, progress, token);
			return;
		}
		await this._finishSolutionAndContinueMain(state, result.text || '', progress, token);
	}

	private async _startExpertReviewForSolutionRun(
		state: SolutionRunState,
		toolCall: CollectedToolCall,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		if (!state.reviewWithExpert || !state.expertReviewAvailable) {
			state.solutionMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Expert review is not available for this solution run. Continue with the best final solution based on available information.' });
			await this._runSolutionTurn(state, progress, token);
			return;
		}
		if (state.expertReviewCount >= MAX_SOLUTION_EXPERT_REVIEW_COUNT) {
			state.solutionMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Maximum expert review count reached. Continue with the current review results.' });
			await this._runSolutionTurn(state, progress, token);
			return;
		}
		const expertContext = await this._getConfiguredExpertModel();
		if (!expertContext) {
			state.reviewSkippedReason = 'expert review became unavailable during solution run';
			state.solutionMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Expert review became unavailable. Continue with the best final solution based on available information.' });
			await this._runSolutionTurn(state, progress, token);
			return;
		}
		state.pendingExpertReviewCallId = toolCall.id;
		state.expertReviewCount += 1;
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		const expertState: ExpertRunState = {
			runId,
			sessionId: state.sessionId,
			askLlsoaiCallId: toolCall.id,
			askLlsoaiArguments: toolCall.input,
			returnTarget: { type: 'solution', solutionRunId: state.runId, solutionToolCallId: toolCall.id },
			expertContextRecords: [],
			expertProviderId: expertContext.providerId,
			expertModelId: expertContext.modelId,
			expertRequestContext: expertContext,
			expertToolCalling: expertContext.toolCalling ?? true,
			expertMessages: this._buildExpertInitialMessages(toolCall.input, expertContext.modelId),
			consumedToolResultCallIds: new Set<string>(),
			pendingExpertToolCallIds: [],
			pendingExpertToolCalls: [],
			pendingExpertToolResults: new Map<string, string>(),
			pendingExpertUserFollowUps: [],
			originalMainMessages: state.originalMainMessages,
			mainRequestContext: state.mainRequestContext,
			mainTools: state.mainTools,
			createdAt: Date.now(),
		};
		this._expertRuns.set(runId, expertState);
		this._activeExpertRunId = runId;
		this._activeExpertRunBySession.set(state.sessionId, runId);
		const expertModelName = expertContext.modelName || expertContext.modelId;
		progress.report(new vscode.LanguageModelTextPart(`\n\n### 🧠 Solution Provider Requested Expert Review\n\nSolution runId: ${state.runId}\nExpert review runId: ${runId}\nExpert model: ${expertModelName}\n\n`));
		try {
			await this._runExpertTurn(expertState, expertContext, progress, token);
		} catch (error) {
			await this._failExpertReviewBackToSolution(expertState, error, progress, token);
		}
	}

	private async _continueSolutionFromToolResult(
		runId: string,
		originCallId: string,
		prefixedCallId: string,
		text: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const state = this._solutionRuns.get(runId);
		if (!state) {
			progress.report(new vscode.LanguageModelTextPart(`\n\nLLSOAI solution run ${runId} no longer exists. Unable to continue processing the tool result.\n\n`));
			return;
		}
		state.consumedToolResultCallIds.add(prefixedCallId);
		this._appendSolutionContextRecord(state, { type: 'tool_result', callId: originCallId, prefixedCallId, content: text });
		if (state.pendingSolutionToolCallIds.length === 0) {
			state.solutionMessages.push({ role: 'tool', tool_call_id: originCallId, content: text });
			try {
				await this._runSolutionTurn(state, progress, token);
			} catch (error) {
				await this._failSolutionRunAndContinueMain(state, error, progress, token);
			}
			return;
		}
		state.pendingSolutionToolResults.set(originCallId, text);
		const missingToolCallIds = state.pendingSolutionToolCallIds.filter(toolCallId => !state.pendingSolutionToolResults.has(toolCallId));
		if (missingToolCallIds.length > 0) {
			this._reportPendingSolutionToolCalls(state, missingToolCallIds, progress);
			return;
		}
		for (const toolCallId of state.pendingSolutionToolCallIds) {
			state.solutionMessages.push({ role: 'tool', tool_call_id: toolCallId, content: state.pendingSolutionToolResults.get(toolCallId) || '' });
		}
		state.pendingSolutionToolCallIds = [];
		state.pendingSolutionToolCalls = [];
		state.pendingSolutionToolResults = new Map<string, string>();
		if (state.pendingSolutionUserFollowUps.length > 0) {
			state.solutionMessages.push({ role: 'user', content: state.pendingSolutionUserFollowUps.join('\n\n') });
			state.pendingSolutionUserFollowUps = [];
		}
		try {
			await this._runSolutionTurn(state, progress, token);
		} catch (error) {
			await this._failSolutionRunAndContinueMain(state, error, progress, token);
		}
	}

	private async _continueSolutionFromUserMessage(
		runId: string,
		text: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const state = this._solutionRuns.get(runId);
		if (!state) {
			this._activeSolutionRunId = undefined;
			return;
		}
		if (state.pendingSolutionToolCallIds.length > 0 || state.pendingExpertReviewCallId) {
			const missingToolCallIds = state.pendingSolutionToolCallIds.filter(toolCallId => !state.pendingSolutionToolResults.has(toolCallId));
			state.pendingSolutionUserFollowUps.push(text);
			if (missingToolCallIds.length > 0) {
				this._reportPendingSolutionToolCalls(state, missingToolCallIds, progress);
			}
			return;
		}
		state.solutionMessages.push({ role: 'user', content: text });
		this._appendSolutionContextRecord(state, { type: 'user_follow_up', content: text });
		progress.report(new vscode.LanguageModelTextPart('\n\n### 🧭 User Follow-up Forwarded to LLSOAI Solution Provider\n\n'));
		await this._runSolutionTurn(state, progress, token);
	}

	private async _failSolutionRunAndContinueMain(
		state: SolutionRunState,
		error: unknown,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		state.reviewSkippedReason = state.reviewSkippedReason || `solution provider failed: ${message}`;
		state.pendingSolutionToolCallIds = [];
		state.pendingSolutionToolCalls = [];
		state.pendingSolutionToolResults = new Map<string, string>();
		state.pendingExpertReviewCallId = undefined;
		state.solutionMessages.push({
			role: 'assistant',
			content: `Solution provider failed: ${message}`,
		});
		await this._saveSolutionChatHistory(state);
		await this._finishSolutionAndContinueMain(state, `Solution provider failed before producing a final solution. Error: ${message}`, progress, token);
	}

	private _reportPendingSolutionToolCalls(
		state: SolutionRunState,
		toolCallIds: string[],
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
	): void {
		const missingIds = new Set(toolCallIds);
		for (const toolCall of state.pendingSolutionToolCalls) {
			if (!missingIds.has(toolCall.id)) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(
				`${SOLUTION_TOOL_CALL_PREFIX}:${state.runId}:${toolCall.id}`,
				toolCall.name,
				toolCall.input,
			));
		}
	}

	private async _continueMainAfterUnavailableSolutionProvider(
		toolCall: CollectedToolCall,
		mainMessages: any[],
		mainContext: MainRequestContext,
		mainTools: readonly any[],
		sessionId: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const unavailableMessage = 'There is currently no available solution provider.';
		const requestBody: any = {
			model: mainContext.modelId,
			messages: [
				...mainMessages,
				withReasoningContentForToolCall(sessionId, { role: 'assistant', tool_calls: [{ id: toolCall.id, type: 'function', function: { name: ASK_SOLUTION_PROVIDER_TOOL_NAME, arguments: JSON.stringify(toolCall.input ?? {}) } }] }, toolCall.id),
				{ role: 'tool', tool_call_id: toolCall.id, content: unavailableMessage },
			],
			stream: true,
		};
		this._applySamplingOptions(requestBody, mainContext);
		if (mainTools.length > 0) {
			requestBody.tools = mainTools
				.filter((tool: any) => tool?.name !== ASK_LLSOAI_TOOL_NAME && tool?.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME)
				.map((tool: any) => ({
					type: 'function',
					function: {
						name: tool.name,
						description: tool.description || '',
						parameters: tool.inputSchema && Object.keys(tool.inputSchema).length > 0 ? tool.inputSchema : { type: 'object', properties: {} },
					}
				}));
		}
		const result = await this._requestModel({ ...mainContext, requestBody, requestLabel: `main_after_unavailable_solution_${Date.now()}`, progress, token, reportText: true });
		await this._saveMainChatHistoryFromMessages(requestBody.messages, result.text, mainContext.modelId, mainTools);
		for (const nextToolCall of result.toolCalls) {
			if (nextToolCall.name === ASK_LLSOAI_TOOL_NAME || nextToolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(nextToolCall.id, nextToolCall.name, nextToolCall.input));
		}
	}

	private async _finishSolutionAndContinueMain(
		state: SolutionRunState,
		solutionAnswer: string,
		progress: vscode.Progress<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart>,
		token: vscode.CancellationToken
	): Promise<void> {
		this._solutionRuns.delete(state.runId);
		this._activeSolutionRunBySession.delete(state.sessionId);
		if (this._activeSolutionRunId === state.runId) {
			this._activeSolutionRunId = undefined;
		}
		this._cleanupExpertRunsForSolution(state.runId);
		progress.report(new vscode.LanguageModelTextPart('\n\n### 🧭 Final Solution Provider Result Returned to Main Model\n\n'));
		const finalSolutionToolResult = [
			'Solution provider result:',
			'',
			solutionAnswer,
			'',
			'Expert review status:',
			`- enabled: ${state.reviewWithExpert}`,
			`- available: ${state.expertReviewAvailable}`,
			`- completed: ${state.expertReviewCompleted}`,
			`- reviewCount: ${state.expertReviewCount}`,
			state.reviewSkippedReason ? `- skippedReason: ${state.reviewSkippedReason}` : '',
			'',
			'Please synthesize the final user-facing answer based on the final solution provider result.',
		].filter(Boolean).join('\n');
		const mainMessages = [
			...state.originalMainMessages,
			withReasoningContentForToolCall(state.sessionId, { role: 'assistant', tool_calls: [{ id: state.askSolutionCallId, type: 'function', function: { name: ASK_SOLUTION_PROVIDER_TOOL_NAME, arguments: JSON.stringify(state.askSolutionArguments ?? {}) } }] }, state.askSolutionCallId),
			{ role: 'tool', tool_call_id: state.askSolutionCallId, content: finalSolutionToolResult },
		];
		const requestBody: any = { model: state.mainRequestContext.modelId, messages: mainMessages, stream: true };
		this._applySamplingOptions(requestBody, state.mainRequestContext);
		if (state.mainTools.length > 0) {
			requestBody.tools = state.mainTools
				.filter((tool: any) => tool?.name !== ASK_LLSOAI_TOOL_NAME && tool?.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME)
				.map((tool: any) => ({
					type: 'function',
					function: {
						name: tool.name,
						description: tool.description || '',
						parameters: tool.inputSchema && Object.keys(tool.inputSchema).length > 0 ? tool.inputSchema : { type: 'object', properties: {} },
					}
				}));
		}
		const result = await this._requestModel({ ...state.mainRequestContext, requestBody, requestLabel: `main_after_solution_${state.runId}`, progress, token, reportText: true });
		await this._saveMainChatHistoryFromMessages(mainMessages, result.text, state.mainRequestContext.modelId, state.mainTools);
		for (const toolCall of result.toolCalls) {
			if (toolCall.name === ASK_LLSOAI_TOOL_NAME || toolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
				continue;
			}
			progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, toolCall.input));
		}
	}

	private _cleanupExpertRunsForSolution(solutionRunId: string): void {
		for (const [expertRunId, expertState] of [...this._expertRuns.entries()]) {
			if (expertState.returnTarget.type === 'solution' && expertState.returnTarget.solutionRunId === solutionRunId) {
				this._expertRuns.delete(expertRunId);
				this._activeExpertRunBySession.delete(expertState.sessionId);
				if (this._activeExpertRunId === expertRunId) {
					this._activeExpertRunId = undefined;
				}
			}
		}
	}

	private _findSolutionToolResults(messages: readonly vscode.LanguageModelChatRequestMessage[], currentSessionId: string): Array<{ runId: string; originCallId: string; prefixedCallId: string; text: string }> {
		const lastMessage = messages[messages.length - 1];
		if (!lastMessage) {
			return [];
		}
		const results: Array<{ runId: string; originCallId: string; prefixedCallId: string; text: string }> = [];
		for (const part of lastMessage.content) {
			if (!isToolResultPart(part)) {
				continue;
			}
			const parsed = this._parseSolutionCallId(part.callId);
			const state = parsed ? this._solutionRuns.get(parsed.runId) : undefined;
			if (parsed && state && state.sessionId === currentSessionId && !state.consumedToolResultCallIds.has(part.callId)) {
				results.push({ ...parsed, prefixedCallId: part.callId, text: collectToolResultText(part) });
			}
		}
		return results;
	}

	private _parseSolutionCallId(callId: string): { runId: string; originCallId: string } | null {
		const prefix = `${SOLUTION_TOOL_CALL_PREFIX}:`;
		if (!callId.startsWith(prefix)) {
			return null;
		}
		const rest = callId.slice(prefix.length);
		const sep = rest.indexOf(':');
		if (sep <= 0) {
			return null;
		}
		return { runId: rest.slice(0, sep), originCallId: rest.slice(sep + 1) };
	}

	private _getSolutionRunForSession(currentSessionId: string): SolutionRunState | undefined {
		const sessionRunId = this._activeSolutionRunBySession.get(currentSessionId);
		const sessionState = sessionRunId ? this._solutionRuns.get(sessionRunId) : undefined;
		if (sessionState?.sessionId === currentSessionId) {
			return sessionState;
		}
		const activeState = this._activeSolutionRunId ? this._solutionRuns.get(this._activeSolutionRunId) : undefined;
		return activeState?.sessionId === currentSessionId
			? activeState
			: [...this._solutionRuns.values()].find(run => run.sessionId === currentSessionId);
	}

	private _buildSolutionCompressionResponse(currentSessionId: string): string {
		const state = this._getSolutionRunForSession(currentSessionId);
		if (!state) {
			return 'No active LLSOAI solution provider run context is currently available for this session.';
		}
		return [
			'LLSOAI solution provider context summary:',
			'',
			`runId: ${state.runId}`,
			`sessionId: ${state.sessionId}`,
			`solutionModelId: ${state.solutionModelId}`,
			'',
			'Original delegated request:',
			JSON.stringify(state.askSolutionArguments ?? {}, null, 2),
			'',
			'Solution context records:',
			JSON.stringify(state.solutionContextRecords ?? [], null, 2),
			'',
			'Pending solution tool call ids:',
			JSON.stringify(state.pendingSolutionToolCallIds ?? [], null, 2),
		].join('\n');
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
	 * Extract the actual user request from VS Code-wrapped messages when present.
	 */
	private _extractUserRequestText(text: string): string {
		if (!text) {
			return '';
		}
		const match = text.match(/<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/i);
		return match?.[1]?.trim() ?? '';
	}

	/**
	 * Check if the given text contains an optimized prompt prefix (in any language).
	 */
	private _hasOptimizedPromptPrefix(text: string): boolean {
		if (!text) {
			return false;
		}
		const normalizedText = text.normalize('NFKC');
		return Object.values(OPTIMIZED_PROMPT_PREFIX)
			.some(prefix => normalizedText.startsWith(prefix.normalize('NFKC')));
	}

	/**
	 * Strip the optimized prompt prefix (in any language) from text.
	 * Returns the original text if no prefix is found.
	 */
	private _stripOptimizedPromptPrefix(text: string): string {
		if (!text) {
			return text;
		}
		const normalizedText = text.normalize('NFKC');
		for (const prefix of Object.values(OPTIMIZED_PROMPT_PREFIX)) {
			const normalizedPrefix = prefix.normalize('NFKC');
			const prefixIndex = normalizedText.indexOf(normalizedPrefix);
			if (prefixIndex >= 0) {
				return `${text.slice(0, prefixIndex)}${text.slice(prefixIndex + prefix.length).trimStart()}`;
			}
		}
		return text;
	}

	/**
	 * Strip the optimized prompt prefix from the last user message content in the converted array.
	 * Only the last user message is processed since that's where the auto-enhancement result is inserted.
	 * The array may contain strings or multimodal content arrays.
	 */
	private _stripOptimizedPromptPrefixFromMessages(convertedMessages: Array<{ role: string; content: any }>): void {
		// Find the last user message (working backwards from the end)
		for (let i = convertedMessages.length - 1; i >= 0; i--) {
			const msg = convertedMessages[i];
			if (msg.role !== 'user') {
				continue;
			}
			// Found the last user message, strip prefix and stop
			if (typeof msg.content === 'string') {
				msg.content = this._stripOptimizedPromptPrefix(msg.content);
			} else if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part?.type === 'text' && typeof part.text === 'string') {
						part.text = this._stripOptimizedPromptPrefix(part.text);
					}
				}
			}
			break;
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
	private _convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[], model: vscode.LanguageModelChatInformation, sessionId: string, expertEnabled = false, solutionEnabled = false, solutionReviewWithExpertAvailable = false): Array<any> {
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
					const reasoningContent = getReasoningContentForToolCall(sessionId, tr.tool_call_id);
					if (reasoningContent) {
						const assistantMsg = [...result]
							.reverse()
							.find(msg => msg?.role === 'assistant'
								&& Array.isArray(msg.tool_calls)
								&& msg.tool_calls.some((toolCall: any) => toolCall?.id === tr.tool_call_id));
						if (assistantMsg) {
							assistantMsg.reasoning_content = reasoningContent;
						}
					}
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
				if (expertEnabled) {
					promptAppendix.push(this._buildExpertPrompt());
				}
				if (solutionEnabled) {
					promptAppendix.push(this._buildSolutionProviderPrompt(solutionReviewWithExpertAvailable));
				}
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
				if (this._parseExpertCallId(part.callId) || this._parseSolutionCallId(part.callId)) {
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
				if (this._parseExpertCallId(part.callId) || this._parseSolutionCallId(part.callId)) {
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
