import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { RemoteNotificationConfig } from './types';

export const DEFAULT_REMOTE_NOTIFICATION_CONFIG: RemoteNotificationConfig = {
	enabled: false,
	websocketEnabled: false,
	websocketUrl: '',
	webhookEnabled: false,
	webhookUrl: '',
	webhookSecret: '',
	inboundMaxTextLength: 20000,
	inboundDedupeWindowMs: 300000,
	allowHistoryRequest: false,
	historyRequestRateLimitPerMinute: 6,
	historyMessageLimit: 100,
	historyMaxMessageLength: 20000,
	historyMaxResponseBytes: 1000000,
	globalCacheEnabled: true,
	websocketCacheLimit: 1000,
	webhookCacheLimit: 100,
	heartbeatIntervalMs: 30000,
	webhookTimeoutMs: 10000,
	webhookRetryCount: 2,
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	const integer = Math.floor(value);
	return Math.max(min, Math.min(max, integer));
}

function normalizeString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export function getRemoteNotificationConfig(): RemoteNotificationConfig {
	const config = vscode.workspace.getConfiguration('openapicopilot.remoteNotification');
	return {
		enabled: normalizeBoolean(config.get('enabled'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.enabled),
		websocketEnabled: normalizeBoolean(config.get('websocketEnabled'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.websocketEnabled),
		websocketUrl: normalizeString(config.get('websocketUrl')),
		webhookEnabled: normalizeBoolean(config.get('webhookEnabled'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookEnabled),
		webhookUrl: normalizeString(config.get('webhookUrl')),
		webhookSecret: normalizeString(config.get('webhookSecret')),
		inboundMaxTextLength: normalizeNumber(config.get('inboundMaxTextLength'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.inboundMaxTextLength, 1, 200000),
		inboundDedupeWindowMs: normalizeNumber(config.get('inboundDedupeWindowMs'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.inboundDedupeWindowMs, 1000, 3600000),
		allowHistoryRequest: normalizeBoolean(config.get('allowHistoryRequest'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.allowHistoryRequest),
		historyRequestRateLimitPerMinute: normalizeNumber(config.get('historyRequestRateLimitPerMinute'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyRequestRateLimitPerMinute, 1, 60),
		historyMessageLimit: normalizeNumber(config.get('historyMessageLimit'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyMessageLimit, 1, 100),
		historyMaxMessageLength: normalizeNumber(config.get('historyMaxMessageLength'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyMaxMessageLength, 100, 200000),
		historyMaxResponseBytes: normalizeNumber(config.get('historyMaxResponseBytes'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyMaxResponseBytes, 10000, 10000000),
		globalCacheEnabled: normalizeBoolean(config.get('globalCacheEnabled'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.globalCacheEnabled),
		websocketCacheLimit: normalizeNumber(config.get('websocketCacheLimit'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.websocketCacheLimit, 10, 10000),
		webhookCacheLimit: normalizeNumber(config.get('webhookCacheLimit'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookCacheLimit, 10, 1000),
		heartbeatIntervalMs: normalizeNumber(config.get('heartbeatIntervalMs'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.heartbeatIntervalMs, 5000, 300000),
		webhookTimeoutMs: normalizeNumber(config.get('webhookTimeoutMs'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookTimeoutMs, 1000, 120000),
		webhookRetryCount: normalizeNumber(config.get('webhookRetryCount'), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookRetryCount, 0, 10),
	};
}

export function maskRemoteUrl(rawUrl: string): string {
	if (!rawUrl) {
		return '';
	}
	try {
		const parsed = new URL(rawUrl);
		for (const key of Array.from(parsed.searchParams.keys())) {
			parsed.searchParams.set(key, '****');
		}
		const pathParts = parsed.pathname.split('/').filter(Boolean);
		if (pathParts.length > 0) {
			const last = pathParts[pathParts.length - 1];
			if (looksLikeToken(last)) {
				pathParts[pathParts.length - 1] = '****';
				parsed.pathname = `/${pathParts.join('/')}`;
			}
		}
		return parsed.toString();
	} catch {
		return rawUrl.replace(/([?&][^=&#]+)=([^&#]*)/g, '$1=****').replace(/\/([A-Za-z0-9_-]{24,})(?=\/|$)/g, '/****');
	}
}

function looksLikeToken(value: string): boolean {
	return value.length >= 24 && /^[A-Za-z0-9._~-]+$/.test(value);
}

export function getWorkspaceId(salt = 'default-salt'): string {
	const folders = vscode.workspace.workspaceFolders || [];
	if (folders.length === 0) {
		return 'no-workspace';
	}
	return crypto.createHash('sha256').update(`${salt}|${folders.map(folder => getTrimmedWorkspacePath(folder.uri.fsPath)).join('|')}`).digest('hex').slice(0, 16);
}

export function getTrimmedWorkspacePath(fsPath: string): string {
	const normalized = fsPath.replace(/\\/g, '/').replace(/\/+$/g, '');
	const parts = normalized.split('/').filter(part => !!part && !/^[A-Za-z]:$/.test(part));
	if (parts.length === 0) {
		return path.basename(fsPath) || fsPath;
	}
	return parts.slice(-2).join('/');
}
