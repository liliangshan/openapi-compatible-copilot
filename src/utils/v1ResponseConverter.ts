/**
 * Conversion utilities for OpenAI-compatible /v1/responses API.
 *
 * The extension internally builds requests in Chat Completions format and
 * consumes streaming deltas in OpenAI Chat Completions chunk format. This file
 * bridges those two shapes directly, without any external adapter dependency.
 */

import type { OpenAIChunk } from './openaiChunk';

type AnyObj = Record<string, any>;

const nowUnixSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Convert an OpenAI Chat Completions request body to a Responses API request body.
 */
export function convertChatCompletionsToResponsesAPI(req: AnyObj): AnyObj {
	const messages = Array.isArray(req.messages) ? req.messages : [];
	const instructions: string[] = [];
	const input: AnyObj[] = [];

	for (const message of messages) {
		if (!message || typeof message !== 'object') {
			continue;
		}

		const role = typeof message.role === 'string' ? message.role : 'user';

		if (role === 'system' || role === 'developer') {
			const text = contentToPlainText(message.content);
			if (text) {
				instructions.push(text);
			}
			continue;
		}

		if (role === 'tool') {
			const callId = message.tool_call_id || message.call_id || message.id;
			if (callId) {
				input.push({
					type: 'function_call_output',
					call_id: String(callId),
					output: contentToPlainText(message.content),
				});
			}
			continue;
		}

		if (role === 'assistant' && Array.isArray(message.tool_calls)) {
			const text = contentToPlainText(message.content);
			if (text) {
				input.push({
					role: 'assistant',
					content: [{ type: 'output_text', text }],
				});
			}

			for (const toolCall of message.tool_calls) {
				const fn = toolCall?.function || {};
				input.push({
					type: 'function_call',
					id: toolCall?.id,
					call_id: toolCall?.id,
					name: fn.name || toolCall?.name || '',
					arguments: typeof fn.arguments === 'string'
						? fn.arguments
						: JSON.stringify(fn.arguments ?? {}),
				});
			}
			continue;
		}

		const responseRole = role === 'assistant' ? 'assistant' : 'user';
		input.push({
			role: responseRole,
			content: convertMessageContentForResponses(message.content, responseRole),
		});
	}

	const body: AnyObj = {
		model: req.model,
		input,
		stream: !!req.stream,
	};

	if (instructions.length > 0) {
		body.instructions = instructions.join('\n');
	}
	if (typeof req.temperature === 'number') {
		body.temperature = req.temperature;
	}
	if (typeof req.top_p === 'number') {
		body.top_p = req.top_p;
	}
	if (typeof req.max_tokens === 'number') {
		body.max_output_tokens = req.max_tokens;
	}
	if (Array.isArray(req.tools) && req.tools.length > 0) {
		body.tools = convertToolsToResponses(req.tools);
	}
	if (req.tool_choice !== undefined && req.tool_choice !== null) {
		body.tool_choice = convertToolChoiceToResponses(req.tool_choice);
	}

	copyIfPresent(req, body, [
		'parallel_tool_calls',
		'reasoning',
		'metadata',
		'store',
		'truncation',
		'previous_response_id',
		'user',
	]);

	return body;
}

function convertToolsToResponses(tools: any[]): any[] {
	return tools.map((tool) => {
		if (!tool || typeof tool !== 'object') {
			return tool;
		}

		// Chat Completions tool format:
		// { type: 'function', function: { name, description, parameters, strict } }
		// Responses API tool format:
		// { type: 'function', name, description, parameters, strict }
		if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
			const fn = tool.function;
			const converted: AnyObj = {
				type: 'function',
				name: fn.name || tool.name || ''
			};

			if (fn.description !== undefined || tool.description !== undefined) {
				converted.description = fn.description ?? tool.description;
			}
			if (fn.parameters !== undefined || tool.parameters !== undefined) {
				converted.parameters = fn.parameters ?? tool.parameters;
			}
			if (fn.strict !== undefined || tool.strict !== undefined) {
				converted.strict = fn.strict ?? tool.strict;
			}

			return converted;
		}

		return tool;
	});
}

export interface V1ResponseStreamState {
	responseId: string;
	model: string;
	created: number;
	seenTextDelta: boolean;
	seenToolCall: boolean;
	toolCallsByItemId: Map<string, { index: number; id: string; name: string; arguments: string; emittedArgumentsLength: number }>;
	nextToolIndex: number;
}

export function createV1ResponseStreamState(model: string): V1ResponseStreamState {
	return {
		responseId: '',
		model,
		created: nowUnixSeconds(),
		seenTextDelta: false,
		seenToolCall: false,
		toolCallsByItemId: new Map(),
		nextToolIndex: 0,
	};
}

/**
 * Convert one Responses API SSE event into OpenAI Chat Completions chunks.
 */
export function convertV1ResponseEventToOpenAIChunks(
	eventType: string,
	event: AnyObj,
	state: V1ResponseStreamState
): OpenAIChunk[] {
 const type = eventType || (typeof event?.type === 'string' ? event.type : '');
 updateResponseMetadata(event, state);

 switch (type) {
	case 'response.created':
	case 'response.in_progress':
	case 'response.content_part.added':
	case 'response.content_part.done':
	case 'response.output_text.done':
	case 'response.output_text.annotation.added':
	case 'response.reasoning_text.delta':
	case 'response.reasoning_text.done':
	 return [];

	case 'response.output_text.delta':
	case 'response.refusal.delta':
	 return textDeltaChunk(event.delta, state);

	case 'response.function_call.delta':
		return functionCallDeltaChunk(event, state);

	case 'response.function_call_arguments.delta':
	 return toolArgumentDeltaChunk(event, state);

	case 'response.function_call_arguments.done':
	 return toolArgumentDoneChunk(event, state);

	case 'response.output_item.added':
	 return outputItemAddedChunk(event.item, event.output_index, state);

	case 'response.output_item.done':
	 return outputItemDoneChunk(event.item, event.output_index, state);

	case 'response.completed':
	 return completedChunks(event.response || event, state);

	case 'response.failed':
	case 'response.incomplete':
	 return [makeChunk(state, {}, finishReasonFromResponse(event.response || event, state)), { done: true }];

	default:
	 return fallbackChunks(event, state);
 }
}

function convertMessageContentForResponses(content: any, role: string): AnyObj[] {
	const textType = role === 'assistant' ? 'output_text' : 'input_text';

	if (content === undefined || content === null) {
		return [];
	}
	if (typeof content === 'string') {
		return content ? [{ type: textType, text: content }] : [];
	}
	if (!Array.isArray(content)) {
		return [{ type: textType, text: String(content) }];
	}

	const parts: AnyObj[] = [];
	for (const part of content) {
		if (typeof part === 'string') {
			parts.push({ type: textType, text: part });
			continue;
		}
		if (!part || typeof part !== 'object') {
			continue;
		}

		if (part.type === 'text') {
			parts.push({ type: textType, text: String(part.text ?? '') });
		} else if (part.type === 'image_url') {
			parts.push({
				type: 'input_image',
				image_url: typeof part.image_url === 'string' ? part.image_url : part.image_url?.url,
			});
		} else if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'input_image' || part.type === 'input_file') {
			parts.push(part);
		} else {
			const text = contentPartToText(part);
			if (text) {
				parts.push({ type: textType, text });
			}
		}
	}

	return parts;
}



function convertToolChoiceToResponses(toolChoice: any): any {
	if (toolChoice === 'none' || toolChoice === 'auto' || toolChoice === 'required') {
		return toolChoice;
	}
	if (toolChoice?.type === 'function' && toolChoice.function?.name) {
		return { type: 'function', name: toolChoice.function.name };
	}
	return toolChoice;
}

function copyIfPresent(source: AnyObj, target: AnyObj, keys: string[]): void {
	for (const key of keys) {
		if (source[key] !== undefined) {
			target[key] = source[key];
		}
	}
}

function updateResponseMetadata(event: AnyObj, state: V1ResponseStreamState): void {
	const response = event?.response && typeof event.response === 'object' ? event.response : undefined;
	const id = event?.response_id || event?.id || response?.id;
	if (typeof id === 'string' && id) {
		state.responseId = id;
	}

	const model = event?.model || response?.model;
	if (typeof model === 'string' && model) {
		state.model = model;
	}

	const created = event?.created_at || response?.created_at || event?.created || response?.created;
	if (typeof created === 'number') {
		state.created = created > 10_000_000_000 ? Math.floor(created / 1000) : created;
	}
}

function textDeltaChunk(delta: any, state: V1ResponseStreamState): OpenAIChunk[] {
	if (delta === undefined || delta === null || delta === '') {
		return [];
	}
	state.seenTextDelta = true;
	return [makeChunk(state, { content: String(delta) })];
}

function functionCallDeltaChunk(event: AnyObj, state: V1ResponseStreamState): OpenAIChunk[] {
	const delta = event.delta && typeof event.delta === 'object' ? event.delta : {};
	const itemId = String(event.item_id || event.output_item_id || event.call_id || delta.id || delta.call_id || '');
	const latestTool = itemId ? undefined : getLatestToolCall(state);
	const tool = latestTool || ensureToolCall(state, itemId, event.output_index, delta.name || event.name, delta.id || delta.call_id || event.call_id);
	state.seenToolCall = true;

	const hasName = typeof delta.name === 'string' && delta.name.length > 0;
	const argsDelta = delta.arguments === undefined || delta.arguments === null ? '' : String(delta.arguments);
	if (argsDelta) {
		tool.arguments += argsDelta;
		tool.emittedArgumentsLength += argsDelta.length;
	}

	return [makeChunk(state, {
		tool_calls: [{
			index: tool.index,
			id: tool.id,
			type: 'function',
			function: {
				...(hasName ? { name: tool.name } : {}),
				arguments: argsDelta,
			},
		}],
	})];
}

function getLatestToolCall(
	state: V1ResponseStreamState
): { index: number; id: string; name: string; arguments: string; emittedArgumentsLength: number } | undefined {
	let latest: { index: number; id: string; name: string; arguments: string; emittedArgumentsLength: number } | undefined;
	for (const tool of state.toolCallsByItemId.values()) {
		if (!latest || tool.index > latest.index) {
			latest = tool;
		}
	}
	return latest;
}

function toolArgumentDeltaChunk(event: AnyObj, state: V1ResponseStreamState): OpenAIChunk[] {
	const deltaObj = event.delta && typeof event.delta === 'object' ? event.delta : undefined;
	const itemId = String(event.item_id || event.output_item_id || event.call_id || deltaObj?.id || deltaObj?.call_id || '');
	const latestTool = itemId ? undefined : getLatestToolCall(state);
	const tool = latestTool || ensureToolCall(state, itemId, event.output_index, deltaObj?.name || event.name, deltaObj?.id || deltaObj?.call_id || event.call_id);
	state.seenToolCall = true;
	const delta = deltaObj
		? (deltaObj.arguments === undefined || deltaObj.arguments === null ? '' : String(deltaObj.arguments))
		: (event.delta === undefined || event.delta === null ? '' : String(event.delta));
	tool.arguments += delta;
	tool.emittedArgumentsLength += delta.length;

	return [makeChunk(state, {
		tool_calls: [{
			index: tool.index,
			id: tool.id,
			type: 'function',
			function: {
				...(tool.name ? { name: tool.name } : {}),
				arguments: delta,
			},
		}],
	})];
}

function toolArgumentDoneChunk(event: AnyObj, state: V1ResponseStreamState): OpenAIChunk[] {
	const itemId = String(event.item_id || event.output_item_id || event.call_id || '');
	const latestTool = itemId ? undefined : getLatestToolCall(state);
	const existingTool = itemId ? state.toolCallsByItemId.get(itemId) : latestTool;
	if (!existingTool && typeof event.arguments !== 'string' && !event.name && !event.call_id) {
		return [];
	}
	const tool = existingTool || ensureToolCall(state, itemId, event.output_index, event.name, event.call_id);
	if (typeof event.arguments === 'string') {
		tool.arguments = event.arguments;
	}
	return emitMissingToolArguments(tool, state);
}

function outputItemAddedChunk(item: AnyObj, outputIndex: any, state: V1ResponseStreamState): OpenAIChunk[] {
	if (!item || typeof item !== 'object') {
		return [];
	}

	if (item.type === 'function_call') {
		state.seenToolCall = true;
		const itemId = responseItemKey(item.id, item.call_id, outputIndex, state.nextToolIndex);
		const tool = ensureToolCall(state, itemId, outputIndex, item.name, item.call_id || item.id);
		return [makeChunk(state, {
			tool_calls: [{
				index: tool.index,
				id: tool.id,
				type: 'function',
				function: {
					name: tool.name,
					arguments: '',
				},
			}],
		})];
	}

	return [];
}

function outputItemDoneChunk(item: AnyObj, outputIndex: any, state: V1ResponseStreamState): OpenAIChunk[] {
	if (!item || typeof item !== 'object') {
		return [];
	}

	if (item.type === 'function_call') {
		state.seenToolCall = true;
		const itemId = responseItemKey(item.id, item.call_id, outputIndex, state.nextToolIndex);
		const tool = ensureToolCall(state, itemId, outputIndex, item.name, item.call_id || item.id);
		if (typeof item.arguments === 'string') {
			tool.arguments = item.arguments;
		}
		return emitMissingToolArguments(tool, state);
	}


	// `response.output_text.delta` normally streams message text incrementally.
	// Only fall back to the final message item when no text delta has been seen,
	// which keeps official streams from duplicating text while still supporting
	// compatible services that only send the completed message item.
	if (item.type === 'message') {
		if (state.seenTextDelta) {
			return [];
		}
		const text = extractTextFromResponseItem(item);
		if (!text) {
			return [];
		}
		state.seenTextDelta = true;
		return [makeChunk(state, { content: text })];
	}

	return [];
}

function completedChunks(response: AnyObj, state: V1ResponseStreamState): OpenAIChunk[] {
	updateResponseMetadata({ response }, state);
	return [makeChunk(state, {}, finishReasonFromResponse(response, state)), { done: true }];
}

function fallbackChunks(event: AnyObj, state: V1ResponseStreamState): OpenAIChunk[] {
	const delta = event?.choices?.[0]?.delta;
	if (delta && typeof delta === 'object') {
		return [makeChunk(state, delta, event.choices?.[0]?.finish_reason)];
	}

	if (typeof event?.delta === 'string') {
		return textDeltaChunk(event.delta, state);
	}
	if (typeof event?.text === 'string') {
		return textDeltaChunk(event.text, state);
	}
	if (typeof event?.content === 'string') {
		return textDeltaChunk(event.content, state);
	}

	return [];
}

function ensureToolCall(
	state: V1ResponseStreamState,
	itemId: string,
	outputIndex: any,
	name: any,
	callId: any
): { index: number; id: string; name: string; arguments: string; emittedArgumentsLength: number } {
	const key = itemId || responseItemKey(undefined, callId, outputIndex, state.nextToolIndex);
	let tool = state.toolCallsByItemId.get(key);
	if (!tool) {
		const index = state.nextToolIndex++;
		tool = {
			index,
			id: String((callId ?? itemId) || `call_${index}`),
			name: typeof name === 'string' ? name : '',
			arguments: '',
			emittedArgumentsLength: 0,
		};
		state.toolCallsByItemId.set(key, tool);
	} else if (typeof name === 'string' && name) {
		tool.name = name;
	}
	return tool;
}

function responseItemKey(id: any, callId: any, outputIndex: any, fallbackIndex: number): string {
	if (id !== undefined && id !== null && id !== '') {
		return String(id);
	}
	if (callId !== undefined && callId !== null && callId !== '') {
		return String(callId);
	}
	if (outputIndex !== undefined && outputIndex !== null) {
		return `output_index:${String(outputIndex)}`;
	}
	return `generated:${fallbackIndex}`;
}

function emitMissingToolArguments(
	tool: { index: number; id: string; name: string; arguments: string; emittedArgumentsLength: number },
	state: V1ResponseStreamState
): OpenAIChunk[] {
	const missingArgs = tool.arguments.slice(tool.emittedArgumentsLength);
	if (!missingArgs) {
		return [];
	}
	tool.emittedArgumentsLength = tool.arguments.length;
	return [makeChunk(state, {
		tool_calls: [{
			index: tool.index,
			id: tool.id,
			type: 'function',
			function: {
				name: tool.name,
				arguments: missingArgs,
			},
		}],
	})];
}

function extractTextFromResponseItem(item: AnyObj): string {
	const content = Array.isArray(item.content) ? item.content : [];
	let text = '';
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			continue;
		}
		if (typeof part.text === 'string') {
			text += part.text;
		} else if (typeof part.content === 'string') {
			text += part.content;
		}
	}
	return text;
}

function makeChunk(state: V1ResponseStreamState, delta: AnyObj, finishReason: string | null = null): OpenAIChunk {
	const chunk: OpenAIChunk = {
		id: state.responseId || `resp_${state.created}`,
		model: state.model,
		object: 'chat.completion.chunk',
		created: state.created,
		delta,
	};
	if (finishReason !== null) {
		chunk.finish_reason = finishReason;
	}
	return chunk;
}

function finishReasonFromResponse(response: AnyObj, state: V1ResponseStreamState): string | null {
	if (response?.status === 'incomplete') {
		return 'length';
	}
	if (state.seenToolCall) {
		return 'tool_calls';
	}
	return 'stop';
}

function contentToPlainText(content: any): string {
	if (content === undefined || content === null) {
		return '';
	}
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content.map(contentPartToText).filter(Boolean).join('\n');
	}
	return String(content);
}

function contentPartToText(part: any): string {
	if (part === undefined || part === null) {
		return '';
	}
	if (typeof part === 'string') {
		return part;
	}
	if (typeof part !== 'object') {
		return String(part);
	}
	if (typeof part.text === 'string') {
		return part.text;
	}
	if (typeof part.content === 'string') {
		return part.content;
	}
	if (part.type === 'image_url') {
		return typeof part.image_url === 'string' ? part.image_url : part.image_url?.url || '';
	}
	return '';
}
