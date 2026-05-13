import * as crypto from 'crypto';

export type RemoteNotificationChannel = 'websocket' | 'webhook';

export type RemoteNotificationStatus =
	| 'disabled'
	| 'notConfigured'
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'authFailed'
	| 'error'
	| 'partial';

export interface RemoteNotificationConfig {
	enabled: boolean;
	websocketEnabled: boolean;
	websocketUrl: string;
	webhookEnabled: boolean;
	webhookUrl: string;
	webhookSecret: string;
	inboundMaxTextLength: number;
	inboundDedupeWindowMs: number;
	allowHistoryRequest: boolean;
	historyRequestRateLimitPerMinute: number;
	historyMessageLimit: number;
	historyMaxMessageLength: number;
	historyMaxResponseBytes: number;
	globalCacheEnabled: boolean;
	websocketCacheLimit: number;
	webhookCacheLimit: number;
	heartbeatIntervalMs: number;
	webhookTimeoutMs: number;
	webhookRetryCount: number;
}

export interface RemoteWorkspaceFolderInfo {
	name: string;
	path: string;
	isPrimary: boolean;
}

export interface RemoteNotificationEnvelope<TPayload = any> {
	protocolVersion: '1.0';
	type: string;
	messageId: string;
	eventId: string;
	eventSeq: number;
	sessionId: string;
	requestId: string;
	workspaceId: string;
	instanceId: string;
	timestamp: string;
	source: 'vscode-extension';
	payload: TPayload;
	workspaceFolders: RemoteWorkspaceFolderInfo[];
	activeWorkspaceFolder: string;
}

export interface RemoteNotificationModelEvent {
	type:
		| 'model.request_started'
		| 'model.text_delta'
		| 'model.reasoning_delta'
		| 'model.tool_call_started'
		| 'model.tool_call_delta'
		| 'model.tool_call_completed'
		| 'model.tool_result'
		| 'model.assistant_final'
		| 'model.request_completed'
		| 'model.request_cancelled'
		| 'model.request_error';
	sessionId: string;
	requestId: string;
	payload: Record<string, any>;
	webhookCandidate?: boolean;
}

export interface RemoteNotificationStats {
	websocketQueued: number;
	websocketSent: number;
	websocketDropped: number;
	webhookQueued: number;
	webhookSent: number;
	webhookDropped: number;
	webhookFailed: number;
}

export function createRemoteId(prefix: string): string {
	return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

export function hashText(text: string): string {
	return crypto.createHash('sha256').update(text).digest('hex');
}
