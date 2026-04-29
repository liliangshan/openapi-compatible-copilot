/**
 * Conversion utilities between OpenAI-compatible chat format and Anthropic Messages API.
 *
 * The provider always assembles request bodies in OpenAI format. When the configured
 * provider is of type "anthropic", these helpers translate the request before sending
 * and translate the response back into OpenAI-compatible chunks/objects so the rest
 * of the streaming pipeline does not need to change.
 *
 * Logic ported from chat.go (convertToAnthropicMessages / convertToolsToAnthropic /
 * convertToolChoiceToAnthropic / convertAnthropicEventToOpenAI / convertAnthropicToOpenAI).
 */

import type { OpenAIChunk } from './openaiChunk';

type AnyObj = Record<string, any>;

/**
 * Convert an OpenAI-style request body to an Anthropic Messages API request body.
 *
 * Input shape (built by provider.ts):
 *   {
 *     model, messages, stream, temperature?, top_p?, tools?, max_tokens?
 *   }
 *
 * Output shape (Anthropic /v1/messages):
 *   {
 *     model, messages, system?, stream, max_tokens, temperature?, top_p?, tools?, tool_choice?
 *   }
 */
export function convertOpenAIRequestToAnthropic(req: AnyObj): AnyObj {
	const { messages, systemPrompt } = convertMessagesToAnthropic(req.messages || []);

	const body: AnyObj = {
		model: req.model,
		messages,
		stream: !!req.stream,
		// Anthropic requires max_tokens >= 1; default to 4096 when not provided
		max_tokens: typeof req.max_tokens === 'number' && req.max_tokens > 0 ? req.max_tokens : 4096,
	};

	if (systemPrompt) {
		body.system = systemPrompt;
	}
	if (typeof req.temperature === 'number') {
		body.temperature = req.temperature;
	}
	if (typeof req.top_p === 'number') {
		body.top_p = req.top_p;
	}
	if (Array.isArray(req.tools) && req.tools.length > 0) {
		body.tools = convertToolsToAnthropic(req.tools);
	}
	if (req.tool_choice !== undefined && req.tool_choice !== null) {
		const toolChoice = convertToolChoiceToAnthropic(req.tool_choice);
		if (toolChoice !== undefined) {
			body.tool_choice = toolChoice;
		}
	}

	return body;
}

/**
 * Convert an OpenAI-style request body to an Anthropic Responses API request body.
 *
 * Input shape (chat completions format, built by provider.ts):
 *   {
 *     model, messages, stream, temperature?, top_p?, max_tokens?
 *   }
 *
 * Output shape (Anthropic /v1/responses):
 *   {
 *     model, input, instructions?, stream, max_tokens?, temperature?, top_p?
 *   }
 *
 * Note: The Responses API uses "input" instead of "messages" and "instructions"
 * instead of "system". This function handles the conversion.
 */
/**
 * Convert OpenAI messages array to Anthropic messages + system prompt.
 */
export function convertMessagesToAnthropic(messages: AnyObj[]): { messages: AnyObj[]; systemPrompt: string } {
	let systemPrompt = '';
	const anthropic: AnyObj[] = [];

	for (const msg of messages) {
		const role: string = msg.role;

		// system/developer messages are extracted into a top-level "system" field
		if (role === 'system' || role === 'developer') {
			const text = stringifyContent(msg.content);
			if (text) {
				if (systemPrompt) systemPrompt += '\n';
				systemPrompt += text;
			}
			continue;
		}

		// tool result messages become user messages with a tool_result content block
		if (role === 'tool') {
			const toolResult: AnyObj = { type: 'tool_result' };
			if (msg.tool_call_id) toolResult.tool_use_id = msg.tool_call_id;
			toolResult.content = typeof msg.content === 'string' ? msg.content : msg.content;
			anthropic.push({ role: 'user', content: [toolResult] });
			continue;
		}

		if (role !== 'user' && role !== 'assistant') {
			continue;
		}

		// user / assistant
		let contentBlocks = convertContentBlocks(msg.content);
		let hasToolUse = false;

		// Filter out empty text blocks for all messages (Anthropic / Bedrock disallow them)
		contentBlocks = contentBlocks.filter((b: AnyObj) => {
			if (!b || typeof b !== 'object') return false;
			if (b.type === 'text') return typeof b.text === 'string' && b.text.length > 0;
			return true;
		});

		const out: AnyObj = { role, content: contentBlocks };

		// assistant tool_calls -> tool_use blocks appended to content
		if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
			hasToolUse = true;

			const toolUses: AnyObj[] = [];
			for (const tc of msg.tool_calls) {
				const toolUse: AnyObj = { type: 'tool_use' };
				if (tc.id) toolUse.id = tc.id;
				const fn = tc.function || {};
				if (fn.name) toolUse.name = fn.name;
				let input: AnyObj = {};
				if (fn.arguments !== undefined) {
					if (typeof fn.arguments === 'string') {
						try {
							input = JSON.parse(fn.arguments);
						} catch {
							input = {};
						}
					} else if (typeof fn.arguments === 'object' && fn.arguments !== null) {
						input = fn.arguments;
					}
				}
				toolUse.input = input;
				toolUses.push(toolUse);
			}
			out.content = [...contentBlocks, ...toolUses];
		}

		if ((!Array.isArray(out.content) || out.content.length === 0) && !hasToolUse) {
			continue;
		}

		anthropic.push(out);
	}

	return { messages: mergeConsecutiveRoles(anthropic), systemPrompt };
}

/**
 * Convert an OpenAI message content (string | array) to Anthropic content blocks.
 */
function convertContentBlocks(content: any): AnyObj[] {
	if (content === null || content === undefined || content === '') {
		return [];
	}
	if (typeof content === 'string') {
		return [{ type: 'text', text: content }];
	}
	if (Array.isArray(content)) {
		const blocks: AnyObj[] = [];
		for (const part of content) {
			if (!part || typeof part !== 'object') continue;
			if (part.type === 'text' && typeof part.text === 'string') {
				blocks.push({ type: 'text', text: part.text });
			} else if (part.type === 'image_url' && part.image_url?.url) {
				const url: string = part.image_url.url;
				const m = url.match(/^data:([^;]+);base64,(.*)$/);
				if (m) {
					blocks.push({
						type: 'image',
						source: { type: 'base64', media_type: m[1], data: m[2] },
					});
				} else {
					blocks.push({ type: 'image', source: { type: 'url', url } });
				}
			} else {
				// Pass through unknown blocks unchanged
				blocks.push(part);
			}
		}
		return blocks;
	}
	if (typeof content === 'object') {
		return [content];
	}
	return [{ type: 'text', text: String(content) }];
}

function stringifyContent(content: any): string {
	if (content === null || content === undefined) return '';
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((p: any) => (p && typeof p === 'object' && typeof p.text === 'string' ? p.text : ''))
			.join('');
	}
	return String(content);
}

/**
 * Anthropic disallows two consecutive messages with the same role; merge their content arrays.
 */
function mergeConsecutiveRoles(messages: AnyObj[]): AnyObj[] {
	if (messages.length === 0) return messages;
	const result: AnyObj[] = [messages[0]];
	for (let i = 1; i < messages.length; i++) {
		const last = result[result.length - 1];
		const cur = messages[i];
		if (last.role === cur.role) {
			const lc = Array.isArray(last.content) ? last.content : [];
			const cc = Array.isArray(cur.content) ? cur.content : [];
			last.content = [...lc, ...cc];
		} else {
			result.push(cur);
		}
	}
	return result;
}

/**
 * Convert OpenAI tools array to Anthropic tools format.
 * OpenAI:    { type: 'function', function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema }
 *
 * Note: Anthropic API (non-Bedrock) does NOT use a "type" field on tool definitions.
 * The "type: 'custom'" is Bedrock-specific and should be omitted for direct Anthropic API calls.
 */
export function convertToolsToAnthropic(tools: AnyObj[]): AnyObj[] {
	const out: AnyObj[] = [];
	for (const tool of tools) {
		if (!tool || typeof tool !== 'object') continue;

		// Already Anthropic-style (has name + input_schema, without "function" wrapper)?
		if (typeof tool.name === 'string' && tool.input_schema !== undefined) {
			// Strip any Bedrock-specific "type" field for direct Anthropic API
			const { type, ...rest } = tool;
			out.push(rest);
			continue;
		}

		if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
			const fn = tool.function;
			const anthropicTool: AnyObj = {
				name: fn.name,
				description: fn.description || '',
			};
			if (fn.parameters && Object.keys(fn.parameters).length > 0) {
				anthropicTool.input_schema = fn.parameters;
			} else {
				anthropicTool.input_schema = { type: 'object', properties: {} };
			}
			out.push(anthropicTool);
		}
	}
	return out;
}

/**
 * Convert OpenAI tool_choice to Anthropic format.
 *   "auto"     -> { type: 'auto' }
 *   "required" -> { type: 'any' }
 *   "none"     -> undefined (omit; Anthropic has no direct none equivalent)
 *   { type:'function', function:{name} } -> { type:'tool', name }
 */
export function convertToolChoiceToAnthropic(toolChoice: any): any {
	if (typeof toolChoice === 'string') {
		if (toolChoice === 'auto') {
			return { type: 'auto' };
		}
		if (toolChoice === 'required') {
			return { type: 'any' };
		}
		if (toolChoice === 'none') {
			return undefined;
		}
		return toolChoice;
	}
	if (toolChoice && typeof toolChoice === 'object') {
		if (toolChoice.type === 'function' && toolChoice.function?.name) {
			return { type: 'tool', name: toolChoice.function.name };
		}
	}
	return toolChoice;
}

/* ------------------------------------------------------------------ */
/* Streaming: Anthropic SSE -> OpenAI-style chunks                     */
/* ------------------------------------------------------------------ */

/**
 * State carried across Anthropic stream events to produce OpenAI-style chunks.
 */
export interface AnthropicStreamState {
	modelId: string;
	convertThink: boolean;
	inThinking: boolean;
	thinkingSent: boolean;
	toolCallIndex: number;
	/** Maps Anthropic content_block index -> { type, toolCallIndex?, toolId?, toolName? } */
	blocks: Map<number, { type: string; toolCallIndex?: number; toolId?: string; toolName?: string }>;
}

export function createAnthropicStreamState(modelId: string, convertThink: boolean): AnthropicStreamState {
	return {
		modelId,
		convertThink,
		inThinking: false,
		thinkingSent: false,
		toolCallIndex: 0,
		blocks: new Map(),
	};
}

function generateChunkId(): string {
	const ts = Date.now().toString(16);
	const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
	return `chatcmpl-${ts}${rand}`;
}



/**
 * Convert one parsed Anthropic SSE event into zero or more OpenAI-style chunks.
 */
export function convertAnthropicEventToOpenAIChunks(
	eventType: string,
	event: AnyObj,
	state: AnthropicStreamState
): OpenAIChunk[] {
	switch (eventType) {
		case 'message_start':
			state.toolCallIndex = 0;
			return [{ delta: { role: 'assistant' } }];

		case 'content_block_start': {
			const idx = typeof event.index === 'number' ? event.index : -1;
			const block = event.content_block || {};
			const type: string = block.type || '';
			if (type === 'text') {
				if (idx >= 0) state.blocks.set(idx, { type: 'text' });
				return [{ delta: { content: '' } }];
			}
			if (type === 'thinking' && state.convertThink) {
				state.inThinking = true;
				state.thinkingSent = false;
				if (idx >= 0) state.blocks.set(idx, { type: 'thinking' });
				return [];
			}
			if (type === 'tool_use') {
				const tcIndex = state.toolCallIndex++;
				const toolId = typeof block.id === 'string' ? block.id : `call_${Date.now()}_${tcIndex}`;
				const toolName = typeof block.name === 'string' ? block.name : '';
				if (idx >= 0) state.blocks.set(idx, { type: 'tool_use', toolCallIndex: tcIndex, toolId, toolName });
				return [{
					delta: {
						role: 'assistant',
						content: null,
						tool_calls: [{
							index: tcIndex,
							id: toolId,
							type: 'function',
							function: { name: toolName, arguments: '' },
						}],
					},
				}];
			}
			return [];
		}

		case 'content_block_delta': {
			const idx = typeof event.index === 'number' ? event.index : -1;
			const delta = event.delta || {};
			const dType: string = delta.type || '';
			if (dType === 'text_delta') {
				const text: string = delta.text || '';
				if (text) return [{ delta: { content: text } }];
				return [];
			}
			if (dType === 'thinking_delta' && state.convertThink) {
				const text: string = delta.thinking || '';
				if (!text) return [];
				if (!state.thinkingSent) {
					state.thinkingSent = true;
					return [{ delta: { role: 'assistant', reasoning_content: text } }];
				}
				return [{ delta: { reasoning_content: text } }];
			}
			if (dType === 'input_json_delta') {
				const partial: string = delta.partial_json || '';
				const idx = typeof event.index === 'number' ? event.index : -1;
				const blockInfo = idx >= 0 ? state.blocks.get(idx) : undefined;
				const tcIndex = blockInfo?.toolCallIndex ?? Math.max(0, state.toolCallIndex - 1);
				return [{
					delta: {
						tool_calls: [{
							index: tcIndex,
							function: { arguments: partial },
						}],
					},
				}];
			}
			if (dType === 'signature_delta' && state.convertThink) {
				state.inThinking = false;
			}
			return [];
		}

		case 'content_block_stop':
			if (state.inThinking && state.convertThink) {
				state.inThinking = false;
			}
			// Check if this is a tool_use block that needs to be completed
			const idx = typeof event.index === 'number' ? event.index : -1;
			if (idx >= 0) {
				const blockInfo = state.blocks.get(idx);
				if (blockInfo?.type === 'tool_use' && blockInfo.toolCallIndex !== undefined) {
					// Emit an empty tool_calls delta to signal completion
					return [{
						delta: {
							tool_calls: [{
								index: blockInfo.toolCallIndex,
								function: { arguments: '' },
							}],
						},
					}];
				}
			}
			return [];

		case 'message_delta': {
			const delta = event.delta || {};
			const sr: string = delta.stop_reason || '';
			let finish: string;
			switch (sr) {
				case 'end_turn': finish = 'stop'; break;
				case 'max_tokens': finish = 'length'; break;
				case 'tool_use': finish = 'tool_calls'; break;
				default: finish = sr || 'stop';
			}
			return [{ delta: {}, finish_reason: finish }];
		}

		case 'message_stop':
			return [{ done: true }];

		case 'error': {
			const errInfo = event.error || {};
			const msg: string = errInfo.message || 'unknown error';
			return [
				{ delta: { content: `[Error: ${msg}]` }, finish_reason: 'stop' },
				{ done: true },
			];
		}
	}
	return [];
}

/* ------------------------------------------------------------------ */
/* v1-response: Responses API SSE events -> OpenAI-style chunks          */
/* ------------------------------------------------------------------ */

/**
 * State object for tracking v1-response streaming.
 */
/* ------------------------------------------------------------------ */
/* Non-streaming: Anthropic JSON response -> OpenAI-style response     */
/* ------------------------------------------------------------------ */

/**
 * Convert a non-streaming Anthropic response body into an OpenAI-compatible
 * chat completion object.
 */
export function convertAnthropicResponseToOpenAI(resp: AnyObj, modelId: string): AnyObj {
	let content = '';
	let reasoning = '';
	const toolCalls: AnyObj[] = [];
	let tcIndex = 0;

	if (Array.isArray(resp.content)) {
		for (const block of resp.content) {
			if (!block || typeof block !== 'object') continue;
			if (block.type === 'text' && typeof block.text === 'string') {
				content += block.text;
			} else if (block.type === 'thinking' && typeof block.thinking === 'string') {
				reasoning += block.thinking;
			} else if (block.type === 'tool_use') {
				let argsStr = '{}';
				try {
					argsStr = JSON.stringify(block.input ?? {});
				} catch {
					argsStr = '{}';
				}
				toolCalls.push({
					index: tcIndex++,
					id: block.id,
					type: 'function',
					function: { name: block.name, arguments: argsStr },
				});
			}
		}
	}

	const stop = resp.stop_reason as string | undefined;
	let finish = 'stop';
	if (stop === 'max_tokens') finish = 'length';
	else if (stop === 'tool_use') finish = 'tool_calls';

	const message: AnyObj = { role: 'assistant', content };
	if (reasoning) message.reasoning_content = reasoning;
	if (toolCalls.length > 0) message.tool_calls = toolCalls;

	const usage = resp.usage && typeof resp.usage === 'object' ? resp.usage : null;
	const out: AnyObj = {
		id: generateChunkId(),
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model: modelId,
		choices: [{ index: 0, message, finish_reason: finish }],
	};
	if (usage) {
		out.usage = {
			prompt_tokens: usage.input_tokens ?? 0,
			completion_tokens: usage.output_tokens ?? 0,
			total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
		};
	}
	return out;
}
