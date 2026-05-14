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

function normalizePartialBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function normalizePartialNumber(value: unknown, min: number, max: number): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}
	const integer = Math.floor(value);
	return Math.max(min, Math.min(max, integer));
}

function normalizePartialString(value: unknown): string | undefined {
	return typeof value === 'string' ? value.trim() : undefined;
}

function hasOwnValue(value: unknown, key: string): boolean {
	return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

function getWorkspaceInspectValue<T>(inspect: { workspaceValue?: T; workspaceFolderValue?: T } | undefined): T | undefined {
	return inspect?.workspaceFolderValue ?? inspect?.workspaceValue;
}

function getGlobalInspectValue<T>(inspect: { globalValue?: T } | undefined): T | undefined {
	return inspect?.globalValue;
}

export type RemoteNotificationProjectConfig = Partial<RemoteNotificationConfig>;

function getRemoteNotificationWorkspaceConfig(): RemoteNotificationConfig {
	const config = vscode.workspace.getConfiguration('openapicopilot.remoteNotification');
	return {
		enabled: normalizeBoolean(getGlobalInspectValue(config.inspect<boolean>('enabled')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.enabled),
		websocketEnabled: normalizeBoolean(getGlobalInspectValue(config.inspect<boolean>('websocketEnabled')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.websocketEnabled),
		websocketUrl: normalizeString(getGlobalInspectValue(config.inspect<string>('websocketUrl'))),
		webhookEnabled: normalizeBoolean(getGlobalInspectValue(config.inspect<boolean>('webhookEnabled')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookEnabled),
		webhookUrl: normalizeString(getGlobalInspectValue(config.inspect<string>('webhookUrl'))),
		webhookSecret: normalizeString(getGlobalInspectValue(config.inspect<string>('webhookSecret'))),
		inboundMaxTextLength: normalizeNumber(getGlobalInspectValue(config.inspect<number>('inboundMaxTextLength')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.inboundMaxTextLength, 1, 200000),
		inboundDedupeWindowMs: normalizeNumber(getGlobalInspectValue(config.inspect<number>('inboundDedupeWindowMs')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.inboundDedupeWindowMs, 1000, 3600000),
		allowHistoryRequest: normalizeBoolean(getGlobalInspectValue(config.inspect<boolean>('allowHistoryRequest')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.allowHistoryRequest),
		historyRequestRateLimitPerMinute: normalizeNumber(getGlobalInspectValue(config.inspect<number>('historyRequestRateLimitPerMinute')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyRequestRateLimitPerMinute, 1, 60),
		historyMessageLimit: normalizeNumber(getGlobalInspectValue(config.inspect<number>('historyMessageLimit')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyMessageLimit, 1, 100),
		historyMaxMessageLength: normalizeNumber(getGlobalInspectValue(config.inspect<number>('historyMaxMessageLength')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyMaxMessageLength, 100, 200000),
		historyMaxResponseBytes: normalizeNumber(getGlobalInspectValue(config.inspect<number>('historyMaxResponseBytes')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.historyMaxResponseBytes, 10000, 10000000),
		globalCacheEnabled: normalizeBoolean(getGlobalInspectValue(config.inspect<boolean>('globalCacheEnabled')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.globalCacheEnabled),
		websocketCacheLimit: normalizeNumber(getGlobalInspectValue(config.inspect<number>('websocketCacheLimit')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.websocketCacheLimit, 10, 10000),
		webhookCacheLimit: normalizeNumber(getGlobalInspectValue(config.inspect<number>('webhookCacheLimit')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookCacheLimit, 10, 1000),
		heartbeatIntervalMs: normalizeNumber(getGlobalInspectValue(config.inspect<number>('heartbeatIntervalMs')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.heartbeatIntervalMs, 5000, 300000),
		webhookTimeoutMs: normalizeNumber(getGlobalInspectValue(config.inspect<number>('webhookTimeoutMs')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookTimeoutMs, 1000, 120000),
		webhookRetryCount: normalizeNumber(getGlobalInspectValue(config.inspect<number>('webhookRetryCount')), DEFAULT_REMOTE_NOTIFICATION_CONFIG.webhookRetryCount, 0, 10),
	};
}

export function getRemoteNotificationConfig(): RemoteNotificationConfig {
	const globalConfig = getRemoteNotificationWorkspaceConfig();
	return {
		...globalConfig,
		...getRemoteNotificationWorkspaceOverrideConfig(),
	};
}

export function getRemoteNotificationGlobalConfig(): RemoteNotificationConfig {
	return getRemoteNotificationWorkspaceConfig();
}

export function normalizeRemoteNotificationProjectConfig(value: unknown): RemoteNotificationProjectConfig {
	const result: RemoteNotificationProjectConfig = {};
	if (!value || typeof value !== 'object') {
		return result;
	}
	if (hasOwnValue(value, 'enabled')) { result.enabled = normalizePartialBoolean((value as any).enabled); }
	if (hasOwnValue(value, 'websocketEnabled')) { result.websocketEnabled = normalizePartialBoolean((value as any).websocketEnabled); }
	if (hasOwnValue(value, 'websocketUrl')) { result.websocketUrl = normalizePartialString((value as any).websocketUrl); }
	if (hasOwnValue(value, 'webhookEnabled')) { result.webhookEnabled = normalizePartialBoolean((value as any).webhookEnabled); }
	if (hasOwnValue(value, 'webhookUrl')) { result.webhookUrl = normalizePartialString((value as any).webhookUrl); }
	if (hasOwnValue(value, 'webhookSecret')) { result.webhookSecret = normalizePartialString((value as any).webhookSecret); }
	if (hasOwnValue(value, 'inboundMaxTextLength')) { result.inboundMaxTextLength = normalizePartialNumber((value as any).inboundMaxTextLength, 1, 200000); }
	if (hasOwnValue(value, 'inboundDedupeWindowMs')) { result.inboundDedupeWindowMs = normalizePartialNumber((value as any).inboundDedupeWindowMs, 1000, 3600000); }
	if (hasOwnValue(value, 'allowHistoryRequest')) { result.allowHistoryRequest = normalizePartialBoolean((value as any).allowHistoryRequest); }
	if (hasOwnValue(value, 'historyRequestRateLimitPerMinute')) { result.historyRequestRateLimitPerMinute = normalizePartialNumber((value as any).historyRequestRateLimitPerMinute, 1, 60); }
	if (hasOwnValue(value, 'historyMessageLimit')) { result.historyMessageLimit = normalizePartialNumber((value as any).historyMessageLimit, 1, 100); }
	if (hasOwnValue(value, 'historyMaxMessageLength')) { result.historyMaxMessageLength = normalizePartialNumber((value as any).historyMaxMessageLength, 100, 200000); }
	if (hasOwnValue(value, 'historyMaxResponseBytes')) { result.historyMaxResponseBytes = normalizePartialNumber((value as any).historyMaxResponseBytes, 10000, 10000000); }
	if (hasOwnValue(value, 'globalCacheEnabled')) { result.globalCacheEnabled = normalizePartialBoolean((value as any).globalCacheEnabled); }
	if (hasOwnValue(value, 'websocketCacheLimit')) { result.websocketCacheLimit = normalizePartialNumber((value as any).websocketCacheLimit, 10, 10000); }
	if (hasOwnValue(value, 'webhookCacheLimit')) { result.webhookCacheLimit = normalizePartialNumber((value as any).webhookCacheLimit, 10, 1000); }
	if (hasOwnValue(value, 'heartbeatIntervalMs')) { result.heartbeatIntervalMs = normalizePartialNumber((value as any).heartbeatIntervalMs, 5000, 300000); }
	if (hasOwnValue(value, 'webhookTimeoutMs')) { result.webhookTimeoutMs = normalizePartialNumber((value as any).webhookTimeoutMs, 1000, 120000); }
	if (hasOwnValue(value, 'webhookRetryCount')) { result.webhookRetryCount = normalizePartialNumber((value as any).webhookRetryCount, 0, 10); }
	return Object.fromEntries(Object.entries(result).filter(([, item]) => item !== undefined)) as RemoteNotificationProjectConfig;
}

export function getRemoteNotificationWorkspaceOverrideConfig(): RemoteNotificationProjectConfig {
	const config = vscode.workspace.getConfiguration('openapicopilot.remoteNotification');
	return normalizeRemoteNotificationProjectConfig({
		enabled: getWorkspaceInspectValue(config.inspect<boolean>('enabled')),
		websocketEnabled: getWorkspaceInspectValue(config.inspect<boolean>('websocketEnabled')),
		websocketUrl: getWorkspaceInspectValue(config.inspect<string>('websocketUrl')),
		webhookEnabled: getWorkspaceInspectValue(config.inspect<boolean>('webhookEnabled')),
		webhookUrl: getWorkspaceInspectValue(config.inspect<string>('webhookUrl')),
		webhookSecret: getWorkspaceInspectValue(config.inspect<string>('webhookSecret')),
		allowHistoryRequest: getWorkspaceInspectValue(config.inspect<boolean>('allowHistoryRequest')),
	});
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
