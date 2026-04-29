/**
 * OpenAI-compatible streaming chunk type.
 *
 * Represents a single chunk in an OpenAI-style server-sent event stream.
 * Used as the common output format across all protocol converters
 * (Anthropic, Responses API, etc.) so the rest of the streaming
 * pipeline stays agnostic to the underlying API.
 */

export interface OpenAIDelta {
	role?: string;
	content?: string | null;
	name?: string;
	type?: string;
	index?: number;
	thinking?: string;
	function_call?: {
		name?: string;
		arguments?: string;
	};
	// For content_block_delta (text or thinking)
	text?: string;
	// For Anthropic reasoning_content
	reasoning_content?: string;
	// For tool_calls delta
	tool_calls?: Array<{
		index?: number;
		id?: string;
		type?: string;
		function?: {
			name?: string;
			arguments?: string;
		};
	}>;
}

export interface OpenAIChunk {
	id?: string;
	model?: string;
	object?: string;
	created?: number;
	delta?: OpenAIDelta;
	finish_reason?: string | null;
	done?: boolean; // signals [DONE]
}
