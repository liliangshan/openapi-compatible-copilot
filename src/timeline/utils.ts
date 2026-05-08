import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { TimelineEol } from './types';

export function sha256(buffer: Buffer): string {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function shortHash(hash: string): string {
	return hash.slice(0, 8);
}

export function makeSafeTimestamp(date = new Date()): string {
	return date.toISOString().replace(/:/g, '-').replace('.', '-');
}

export function countLines(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	return text.split(/\r\n|\r|\n/).length;
}

export function detectEol(text: string): TimelineEol {
	const crlf = (text.match(/\r\n/g) ?? []).length;
	const withoutCrlf = text.replace(/\r\n/g, '');
	const lf = (withoutCrlf.match(/\n/g) ?? []).length;
	const cr = (withoutCrlf.match(/\r/g) ?? []).length;
	const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
	if (kinds === 0) {
		return 'none';
	}
	if (kinds > 1) {
		return 'mixed';
	}
	if (crlf > 0) {
		return 'crlf';
	}
	return lf > 0 ? 'lf' : 'cr';
}

export function hasTrailingNewline(text: string): boolean {
	return /(?:\r\n|\r|\n)$/.test(text);
}

export function decodeUtf8Text(buffer: Buffer): string | undefined {
	if (buffer.includes(0)) {
		return undefined;
	}
	const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	if (/\uFFFD/.test(text)) {
		return undefined;
	}
	return text;
}

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function atomicWriteFile(filePath: string, content: string | Buffer, mode?: number): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(tmpPath, content, mode === undefined ? undefined : { mode });
	await fs.rename(tmpPath, filePath);
}

export function makeTimelineError(code: string, message: string, retryable = false): Error {
	const error = new Error(message) as Error & { code?: string; retryable?: boolean };
	error.code = code;
	error.retryable = retryable;
	return error;
}
