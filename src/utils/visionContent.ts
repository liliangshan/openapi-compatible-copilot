/**
 * Shared utilities for vision/image content handling.
 *
 * Provides unified image URL extraction and data URL parsing to ensure
 * consistent behavior across anthropicConverter.ts and v1ResponseConverter.ts.
 */

export interface ParsedDataImageUrl {
	mediaType: string;
	data: string;
}

export type DataImageParseResult =
	| { kind: 'ok'; mediaType: string; data: string }
	| { kind: 'not_data_url' }
	| { kind: 'invalid_data_url'; reason: string; mediaType?: string }
	| { kind: 'unsupported_media_type'; mediaType: string };

/**
 * Supported MIME types for vision input.
 * Used for validation in converters.
 */
export const SUPPORTED_IMAGE_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
]);

/**
 * Normalize a string value to a trimmed non-empty string, or undefined.
 * Filters out null, undefined, non-strings, empty strings, and whitespace-only strings.
 */
function normalizeUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalize MIME type to standard form.
 * - Converts to lowercase
 * - Normalizes 'image/jpg' to 'image/jpeg' (jpg is not a standard MIME type)
 *
 * @param mimeType - The MIME type string to normalize
 * @returns Normalized MIME type string
 */
export function normalizeImageMediaType(mimeType: string): string {
	const normalized = mimeType.trim().toLowerCase();
	return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

/**
 * Check if a MIME type is supported for vision input.
 *
 * @param mimeType - The MIME type string to check
 * @returns true if the type is supported, false otherwise
 */
export function isSupportedImageType(mimeType: string): boolean {
	return SUPPORTED_IMAGE_TYPES.has(normalizeImageMediaType(mimeType));
}

/**
 * Extract image URL from a content part, supporting multiple formats:
 * - { type: 'image_url', image_url: 'data:...' } (string form)
 * - { type: 'image_url', image_url: { url: 'data:...' } } (object form)
 * - { type: 'image', source: { url: '...' } } (Anthropic native form)
 * - { type: 'image_url', url: '...' } (direct url field)
 *
 * @param part - The content part object to extract URL from
 * @returns The extracted URL string (trimmed, non-empty) or undefined if not found
 */
export function getImageUrlFromPart(part: unknown): string | undefined {
	if (!part || typeof part !== 'object') {
		return undefined;
	}

	const obj = part as {
		image_url?: string | { url?: unknown };
		source?: { type?: unknown; url?: unknown; media_type?: unknown; data?: unknown };
		url?: unknown;
	};

	// Handle Anthropic native base64 form:
	// { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }
	if (obj.source?.type === 'base64' && typeof obj.source.media_type === 'string' && typeof obj.source.data === 'string') {
		const mediaType = normalizeImageMediaType(obj.source.media_type);
		const data = normalizeUrl(obj.source.data);
		if (data) {
			return `data:${mediaType};base64,${data}`;
		}
	}

	// Handle string form: { type: 'image_url', image_url: 'data:...' }
	if (typeof obj.image_url === 'string') {
		return normalizeUrl(obj.image_url);
	}

	// Handle object form: { type: 'image_url', image_url: { url: '...' } }
	if (typeof obj.image_url?.url === 'string') {
		return normalizeUrl(obj.image_url.url);
	}

	// Handle Anthropic native form: { type: 'image', source: { url: '...' } }
	if (typeof obj.source?.url === 'string') {
		return normalizeUrl(obj.source.url);
	}

	// Handle direct url field: { type: 'image_url', url: '...' }
	if (typeof obj.url === 'string') {
		return normalizeUrl(obj.url);
	}

	return undefined;
}

/**
 * Parse a data URL into its media type and base64 data components.
 *
 * Supports:
 * - Standard form: `data:image/png;base64,abc`
 * - Form with parameters: `data:image/png;charset=utf-8;base64,abc`
 * - Case-insensitive: `data:image/png;BASE64,abc` or `data:IMAGE/PNG;base64,abc`
 *
 * @param url - The data URL to parse (e.g., 'data:image/png;base64,iVBORw0...')
 * @returns An object with mediaType (normalized) and data properties, or undefined if not a valid data URL
 */
export function parseDataImageUrl(url: unknown): ParsedDataImageUrl | undefined {
	const result = parseDataImageUrlDetailed(url);
	return result.kind === 'ok'
		? { mediaType: result.mediaType, data: result.data }
		: undefined;
}

export function parseDataImageUrlDetailed(url: unknown): DataImageParseResult {
	if (typeof url !== 'string') {
		return { kind: 'not_data_url' };
	}

	const trimmed = url.trim();
	if (!trimmed.toLowerCase().startsWith('data:')) {
		return { kind: 'not_data_url' };
	}

	const commaIndex = trimmed.indexOf(',');
	if (commaIndex === -1) {
		return { kind: 'invalid_data_url', reason: 'missing comma separator' };
	}

	// Extract metadata (between 'data:' and ',') and data (after ',')
	const metadata = trimmed.slice('data:'.length, commaIndex);
	const data = trimmed.slice(commaIndex + 1);

	// Empty base64 data is invalid
	if (!data) {
		return { kind: 'invalid_data_url', reason: 'empty data' };
	}

	// Parse metadata parts (split by ';')
	const metadataParts = metadata
		.split(';')
		.map((part) => part.trim())
		.filter(Boolean);

	const mediaType = metadataParts[0];
	if (!mediaType) {
		return { kind: 'invalid_data_url', reason: 'missing media type' };
	}
	const normalizedMediaType = normalizeImageMediaType(mediaType);

	// Check for base64 encoding marker (case-insensitive)
	const isBase64 = metadataParts.some((part) => part.toLowerCase() === 'base64');
	if (!isBase64) {
		return { kind: 'invalid_data_url', reason: 'missing base64 marker', mediaType: normalizedMediaType };
	}

	if (!isSupportedImageType(normalizedMediaType)) {
		return { kind: 'unsupported_media_type', mediaType: normalizedMediaType };
	}

	return {
		kind: 'ok',
		mediaType: normalizedMediaType,
		data,
	};
}
