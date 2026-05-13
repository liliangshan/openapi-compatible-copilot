import * as vscode from 'vscode';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { RemoteNotificationCache } from './cache';
import { getRemoteNotificationConfig, getTrimmedWorkspacePath, getWorkspaceId, maskRemoteUrl } from './config';
import { RemoteNotificationEventBus } from './eventBus';
import { createRemoteId, hashText, RemoteNotificationConfig, RemoteNotificationEnvelope, RemoteNotificationStats, RemoteWorkspaceFolderInfo } from './types';
import { RemoteNotificationStatusBar } from './statusBar';
import { getRemoteNotificationTexts } from './messages';
import { insertIntoChatInput } from '../promptEnhancementStatusBar';
import type { ConfigManager } from '../configManager';
import { openRemoteNotificationSettingsPanel } from './settingsPanel';

export class RemoteNotificationService implements vscode.Disposable {
	private config: RemoteNotificationConfig = getRemoteNotificationConfig();
	private readonly websocketCache = new RemoteNotificationCache(this.config.websocketCacheLimit);
	private readonly webhookCache = new RemoteNotificationCache(this.config.webhookCacheLimit);
	private readonly disposables: vscode.Disposable[] = [];
	private readonly output = vscode.window.createOutputChannel('LLS OAI Remote Work');
	private readonly instanceId: string;
	private readonly workspaceSalt: string;
	private workspaceId: string;
	private statusBar?: RemoteNotificationStatusBar;
	private running = false;
	private websocketLoopRunning = false;
	private webhookLoopRunning = false;
	private heartbeatTimer?: NodeJS.Timeout;
	private reconnectTimer?: NodeJS.Timeout;
	private websocket?: WebSocket;
	private websocketConnected = false;
	private websocketAccepted = false;
	private websocketAuthFailed = false;
	private connectionWaiters: Array<() => void> = [];
	private reconnectAttempts = 0;
	private promptBypassMarker?: (prompt: string, requestId?: string) => void;
	private inboundDedupe = new Map<string, number>();
	private webhookDedupe = new Map<string, number>();
	private historyRequestTimestamps: number[] = [];
	private historyRequestRunning = false;
	private lastSessionId = 'unknown';
	private stats: RemoteNotificationStats = {
		websocketQueued: 0,
		websocketSent: 0,
		websocketDropped: 0,
		webhookQueued: 0,
		webhookSent: 0,
		webhookDropped: 0,
		webhookFailed: 0,
	};

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly eventBus: RemoteNotificationEventBus,
		private readonly configManager?: ConfigManager
	) {
		// instanceId 必须每个 VS Code 窗口独立，否则多窗口会互相踢线。
		// 历史版本曾把它持久化到 globalState 导致 A/B 项目互相挤掉对方，
		// 改为每次窗口启动新生成，并仅在内存中保留。
		this.instanceId = createRemoteId('instance');
		this.workspaceSalt = this.context.globalState.get<string>('openapicopilot.remoteNotification.workspaceSalt') || createRemoteId('salt');
		void this.context.globalState.update('openapicopilot.remoteNotification.workspaceSalt', this.workspaceSalt);
		// 清理历史遗留的全局 instanceId，避免老数据再次被误用。
		if (this.context.globalState.get<string>('openapicopilot.remoteNotification.instanceId')) {
			void this.context.globalState.update('openapicopilot.remoteNotification.instanceId', undefined);
		}
		this.workspaceId = getWorkspaceId(this.workspaceSalt);
		this.disposables.push(this.output);
		this.disposables.push(this.eventBus.event(event => this.handleEvent(event)));
		this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openapicopilot.remoteNotification')) {
				this.reloadConfig();
			}
			if (event.affectsConfiguration('openapicopilot.language')) {
				this.refreshLanguage();
			}
		}));
	}

	registerStatusBar(command: string): void {
		this.statusBar = new RemoteNotificationStatusBar(command, this.configManager?.getResolvedLanguage() || 'en');
		this.disposables.push(this.statusBar);
		this.refreshStatus();
	}

	private refreshLanguage(): void {
		this.statusBar?.updateLanguage(this.configManager?.getResolvedLanguage() || 'en');
		this.refreshStatus();
	}

	start(): void {
		this.running = true;
		this.reloadConfig();
		this.ensureWebsocketConnection();
		this.startWebsocketLoop();
		this.startWebhookLoop();
	}

	setPromptBypassMarker(marker: (prompt: string, requestId?: string) => void): void {
		this.promptBypassMarker = marker;
	}

	getWorkspaceId(): string {
		this.workspaceId = getWorkspaceId(this.workspaceSalt);
		return this.workspaceId;
	}

	getInstanceId(): string {
		return this.instanceId;
	}

	publishModelEvent(event: Parameters<RemoteNotificationEventBus['emitModelEvent']>[0]): void {
		this.lastSessionId = event.sessionId || this.lastSessionId;
		this.eventBus.emitModelEvent(event, this.getWorkspaceId(), this.instanceId);
	}

	private reloadConfig(): void {
		this.config = getRemoteNotificationConfig();
		this.websocketAuthFailed = false;
		this.websocketCache.setLimit(this.config.websocketCacheLimit);
		this.webhookCache.setLimit(this.config.webhookCacheLimit);
		this.refreshStatus();
		if (this.config.enabled && this.config.websocketEnabled) {
			this.ensureWebsocketConnection();
			this.resetHeartbeat();
		} else {
			this.clearHeartbeat();
			this.closeWebsocket();
		}
	}

	private refreshStatus(): void {
		if (!this.statusBar) {
			return;
		}
		if (!this.config.enabled) {
			this.statusBar.update('disabled');
			return;
		}
		const wsReady = this.config.websocketEnabled && !!this.config.websocketUrl;
		const webhookReady = this.config.webhookEnabled && !!this.config.webhookUrl;
		if (!wsReady && !webhookReady) {
			this.statusBar.update('notConfigured');
			return;
		}
		if (wsReady && !this.websocketAccepted) {
			this.statusBar.update('connecting', this.buildTooltip());
			return;
		}
		this.statusBar.update(wsReady && webhookReady ? 'connected' : 'partial', this.buildTooltip());
	}

	private buildTooltip(): string {
		const text = getRemoteNotificationTexts(this.configManager?.getResolvedLanguage() || 'en');
		return [
			`${text.websocket}: ${this.config.websocketEnabled ? maskRemoteUrl(this.config.websocketUrl) || text.notConfigured : text.off}`,
			`${text.webhook}: ${this.config.webhookEnabled ? maskRemoteUrl(this.config.webhookUrl) || text.notConfigured : text.off}`,
			`${text.websocketCache}: ${this.websocketCache.length}`,
			`${text.webhookCache}: ${this.webhookCache.length}`,
			`${text.webhookFailed}: ${this.stats.webhookFailed}`,
			`${text.dropped}: ${this.websocketCache.droppedCount + this.webhookCache.droppedCount}`,
		].join('\n');
	}

	private handleEvent(event: RemoteNotificationEnvelope): void {
		if (!this.config.enabled) {
			return;
		}
		if (this.config.websocketEnabled && this.config.websocketUrl) {
			// 过滤掉 apply_patch 工具的 tool_call_delta 事件，不通过 WebSocket 上报
			if (event.type === 'model.tool_call_delta' && (event.payload as any)?.toolName === 'apply_patch') {
				return;
			}
			this.websocketCache.enqueue(event);
			this.stats.websocketQueued++;
			this.output.appendLine(`[websocket-queued] type=${event.type} requestId=${event.requestId} queue=${this.websocketCache.length}`);
		}
		if (this.config.globalCacheEnabled && this.config.webhookEnabled && this.config.webhookUrl && isWebhookCandidate(event)) {
			const webhookEnvelope = toWebhookEnvelope(event);
			const dedupeKey = String(webhookEnvelope.payload?.dedupeKey || webhookEnvelope.eventId);
			this.cleanupWebhookDedupe();
			if (this.webhookDedupe.has(dedupeKey)) {
				return;
			}
			this.webhookDedupe.set(dedupeKey, Date.now() + 3600000);
			this.webhookCache.enqueue(webhookEnvelope);
			this.stats.webhookQueued++;
		}
	}

	private cleanupWebhookDedupe(): void {
		const now = Date.now();
		for (const [key, expiresAt] of this.webhookDedupe) {
			if (expiresAt <= now || this.webhookDedupe.size > 5000) {
				this.webhookDedupe.delete(key);
			}
		}
	}

	private enqueueConnectionContext(): void {
		if (!this.config.enabled || !this.config.websocketEnabled || !this.config.websocketUrl) {
			return;
		}
		const workspaceFolders = getWorkspaceFolders();
		const envelope = this.eventBus.createControlEnvelope('client.connection_context', this.lastSessionId, this.getWorkspaceId(), this.instanceId, {
			workspaceFolders,
			activeWorkspaceFolder: workspaceFolders.find(folder => folder.isPrimary)?.path || '',
		});
		this.websocketCache.enqueue(envelope);
	}

	private resetHeartbeat(): void {
		this.clearHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			if (!this.config.enabled || !this.config.websocketEnabled || !this.config.websocketUrl) {
				return;
			}
			const heartbeat = this.eventBus.createControlEnvelope('client.heartbeat_ping', this.lastSessionId, this.getWorkspaceId(), this.instanceId, {
				nonce: createRemoteId('nonce'),
				sentAt: new Date().toISOString(),
			});
			this.websocketCache.enqueue(heartbeat);
		}, this.config.heartbeatIntervalMs);
	}

	private clearHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	private startWebsocketLoop(): void {
		if (this.websocketLoopRunning) {
			return;
		}
		this.websocketLoopRunning = true;
		void (async () => {
			while (this.running) {
				try {
					await this.websocketCache.waitForItem();
					if (!this.websocketAccepted) {
						this.ensureWebsocketConnection();
						await this.waitForWebsocketAccepted();
						continue;
					}
					let item: RemoteNotificationEnvelope | undefined;
					while ((item = this.websocketCache.dequeue())) {
						const sent = await this.sendWebsocketMessage(item);
						if (!sent) {
							this.websocketCache.enqueue(item);
							await this.delay(1000);
							break;
						}
					}
				} catch (error) {
					this.output.appendLine(`[websocket-loop-error] ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		})();
	}

	private startWebhookLoop(): void {
		if (this.webhookLoopRunning) {
			return;
		}
		this.webhookLoopRunning = true;
		void (async () => {
			while (this.running) {
				await this.webhookCache.waitForItem();
				let item: RemoteNotificationEnvelope | undefined;
				while ((item = this.webhookCache.dequeue())) {
					await this.sendWebhook(item);
				}
			}
		})();
	}

	private ensureWebsocketConnection(): void {
		if (!this.running || !this.config.enabled || !this.config.websocketEnabled || !this.config.websocketUrl) {
			return;
		}
		if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
			return;
		}
		this.websocketConnected = false;
		this.websocketAccepted = false;
		this.statusBar?.update('connecting', this.buildTooltip());
		try {
			this.websocket = new WebSocket(this.config.websocketUrl);
		} catch (error) {
			this.output.appendLine(`[websocket-connect-error] ${maskRemoteUrl(this.config.websocketUrl)} ${error instanceof Error ? error.message : String(error)}`);
			this.scheduleReconnect();
			return;
		}
		this.websocket.on('open', () => this.handleWebsocketOpen());
		this.websocket.on('message', data => void this.handleWebsocketMessage(data));
		this.websocket.on('error', error => {
			this.output.appendLine(`[websocket-error] ${maskRemoteUrl(this.config.websocketUrl)} ${error.message}`);
		});
		this.websocket.on('close', (code, reason) => this.handleWebsocketClose(code, reason.toString()));
	}

	private handleWebsocketOpen(): void {
		this.websocketConnected = true;
		this.reconnectAttempts = 0;
		this.resetHeartbeat();
		const hello = this.eventBus.createControlEnvelope('client.hello', this.lastSessionId, this.getWorkspaceId(), this.instanceId, {
			extensionName: 'LLS OAI',
			extensionVersion: vscode.extensions.getExtension('liliangshan.openapi-compatible-copilot')?.packageJSON?.version || '',
			language: vscode.env.language,
			capabilities: {
				streamEvents: true,
				toolEvents: true,
				inboundChatMessage: true,
				webhook: this.config.webhookEnabled,
				heartbeat: true,
			},
		});
		void this.sendWebsocketMessage(hello, true);
	}

	private async handleWebsocketMessage(data: WebSocket.RawData): Promise<void> {
		let message: any;
		try {
			message = JSON.parse(data.toString());
		} catch {
			return;
		}
		if (message?.type === 'server.hello_ack') {
			if (message?.payload?.accepted === false) {
				this.websocketAuthFailed = true;
				this.statusBar?.update('authFailed', this.buildTooltip());
				this.websocketAccepted = false;
				this.closeWebsocket(false);
				return;
			}
			this.websocketAccepted = true;
			this.reconnectAttempts = 0;
			this.resolveConnectionWaiters();
			this.enqueueConnectionContext();
			this.refreshStatus();
			return;
		}
		if (message?.type === 'server.heartbeat_ping') {
			const pong = this.eventBus.createControlEnvelope('client.heartbeat_pong', this.lastSessionId, this.getWorkspaceId(), this.instanceId, {
				nonce: message?.payload?.nonce || '',
				receivedAt: new Date().toISOString(),
			});
			await this.sendWebsocketMessage(pong, true);
			return;
		}
		if (message?.type === 'server.chat_message') {
			await this.handleInboundChatMessage(message);
			return;
		}
		if (message?.type === 'server.chat_history_request') {
			await this.handleChatHistoryRequest(message);
		}
	}

	private handleWebsocketClose(code?: number, reason?: string): void {
		const wasAccepted = this.websocketAccepted;
		if (!wasAccepted && (code === 1008 || (code !== undefined && code >= 4000 && code < 4100))) {
			this.websocketAuthFailed = true;
			this.output.appendLine(`[websocket-auth-failed] closeCode=${code} reason=${reason || ''}`);
		}
		this.websocketConnected = false;
		this.websocketAccepted = false;
		this.websocket = undefined;
		this.clearHeartbeat();
		this.resolveConnectionWaiters();
		if (this.websocketAuthFailed) {
			this.statusBar?.update('authFailed', this.buildTooltip());
			return;
		}
		if (this.running && this.config.enabled && this.config.websocketEnabled && wasAccepted) {
			this.scheduleReconnect();
		} else if (this.running && this.config.enabled && this.config.websocketEnabled) {
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.websocketAuthFailed || this.reconnectTimer || !this.running || !this.config.enabled || !this.config.websocketEnabled) {
			return;
		}
		this.statusBar?.update('reconnecting', this.buildTooltip());
		const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts++));
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			this.ensureWebsocketConnection();
		}, delay);
	}

	private closeWebsocket(scheduleReconnect = false): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		const socket = this.websocket;
		this.websocket = undefined;
		this.websocketConnected = false;
		this.websocketAccepted = false;
		if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
			socket.close();
		}
		this.resolveConnectionWaiters();
		if (scheduleReconnect && !this.websocketAuthFailed) {
			this.scheduleReconnect();
		}
	}

	private async waitForWebsocketAccepted(): Promise<void> {
		if (this.websocketAccepted || !this.running || this.websocketAuthFailed) {
			return;
		}
		await new Promise<void>(resolve => {
			const timer = setTimeout(() => {
				this.connectionWaiters = this.connectionWaiters.filter(waiter => waiter !== done);
				resolve();
			}, 1000);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			this.connectionWaiters.push(done);
		});
	}

	private resolveConnectionWaiters(): void {
		const waiters = this.connectionWaiters.splice(0, this.connectionWaiters.length);
		for (const waiter of waiters) {
			waiter();
		}
	}

	private async delay(ms: number): Promise<void> {
		await new Promise(resolve => setTimeout(resolve, ms));
	}

	private async sendWebsocketMessage(event: RemoteNotificationEnvelope, allowBeforeAccepted = false): Promise<boolean> {
		try {
			if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN || (!this.websocketAccepted && !allowBeforeAccepted)) {
				this.ensureWebsocketConnection();
				return false;
			}
			const serialized = JSON.stringify(event);
			await new Promise<void>((resolve, reject) => {
				this.websocket!.send(serialized, error => error ? reject(error) : resolve());
			});
			this.stats.websocketSent++;
			this.output.appendLine(`[websocket-sent] type=${event.type} requestId=${event.requestId} bytes=${Buffer.byteLength(serialized, 'utf8')}`);
			return true;
		} catch (error) {
			this.output.appendLine(`[websocket-send-error] ${error instanceof Error ? error.message : String(error)}`);
			this.closeWebsocket(true);
			return false;
		}
	}

	private async sendWebhook(event: RemoteNotificationEnvelope): Promise<void> {
		if (!this.config.webhookUrl) {
			return;
		}
		const timestamp = String(Math.floor(Date.now() / 1000));
		const webhookId = event.eventId || event.messageId;
		let attempt = 0;
		const maxAttempts = this.config.webhookRetryCount + 1;
		while (attempt < maxAttempts) {
			attempt++;
			if (attempt > 1) {
				await this.delay(Math.min(30000, 1000 * Math.pow(2, attempt - 2)));
			}
			try {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), this.config.webhookTimeoutMs);
				try {
					const workspaceFolders = getWorkspaceFolders();
					const activeWorkspaceFolder = workspaceFolders.find(f => f.isPrimary)?.path || '';
					const body = JSON.stringify({
						...event,
						workspaceFolders,
						activeWorkspaceFolder,
						payload: {
							...event.payload,
							deliveryAttempt: attempt,
						},
					});
					const response = await fetch(this.config.webhookUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Webhook-Id': webhookId,
							'Webhook-Event': event.type,
							'Webhook-Timestamp': timestamp,
							'Webhook-Signature': this.createWebhookSignature(timestamp, body),
						},
						body,
						signal: controller.signal,
					});
					if (response.ok) {
						this.stats.webhookSent++;
						return;
					}
					if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
						break;
					}
				} finally {
					clearTimeout(timer);
				}
			} catch (error) {
				this.output.appendLine(`[webhook-error] ${maskRemoteUrl(this.config.webhookUrl)} ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		this.stats.webhookFailed++;
	}

	private createWebhookSignature(timestamp: string, body: string): string {
		if (!this.config.webhookSecret) {
			return `t=${timestamp},v1=`;
		}
		const signedPayload = `${timestamp}.${body}`;
		const digest = crypto.createHmac('sha256', this.config.webhookSecret).update(signedPayload).digest('hex');
		return `t=${timestamp},v1=${digest}`;
	}

	async openSettings(): Promise<void> {
		if (this.configManager) {
			await openRemoteNotificationSettingsPanel(this.configManager);
			return;
		}
		await vscode.commands.executeCommand('workbench.action.openSettings', 'openapicopilot.remoteNotification');
	}

	reconnect(): void {
		this.websocketAuthFailed = false;
		this.reloadConfig();
		this.closeWebsocket(true);
	}

	async showStatusBarMenu(): Promise<void> {
		const text = getRemoteNotificationTexts(this.configManager?.getResolvedLanguage() || 'en');
		const selection = await vscode.window.showQuickPick([
			{
				label: text.menuOpenSettings,
				description: text.menuOpenSettingsDescription,
				action: 'settings',
			},
			{
				label: text.menuOpenOutput,
				description: text.menuOpenOutputDescription,
				action: 'output',
			},
			{
				label: text.menuReconnect,
				description: text.menuReconnectDescription,
				action: 'reconnect',
			},
			{
				label: text.menuCopyStatus,
				description: text.menuCopyStatusDescription,
				action: 'copyStatus',
			},
		], {
			placeHolder: text.menuPlaceHolder,
		});
		if (!selection) {
			return;
		}
		if (selection.action === 'settings') {
			await this.openSettings();
			return;
		}
		if (selection.action === 'output') {
			this.output.show();
			return;
		}
		if (selection.action === 'reconnect') {
			this.reconnect();
			return;
		}
		if (selection.action === 'copyStatus') {
			await vscode.env.clipboard.writeText(this.buildTooltip());
			void vscode.window.showInformationMessage(text.statusCopied);
		}
	}

	async handleInboundChatMessage(message: any): Promise<void> {
		if (!this.config.enabled) {
			return;
		}
		const text = String(message?.payload?.text || '').trim();
		if (!text) {
			return;
		}
		if (text.length > this.config.inboundMaxTextLength) {
			this.output.appendLine('[inbound-rejected] message too large');
			return;
		}
		const expireAt = typeof message?.payload?.expireAt === 'string' ? Date.parse(message.payload.expireAt) : undefined;
		if (expireAt && Number.isFinite(expireAt) && expireAt < Date.now()) {
			this.output.appendLine('[inbound-rejected] message expired');
			return;
		}
		const dedupeKey = String(message?.payload?.dedupeKey || message?.messageId || '').trim();
		if (dedupeKey) {
			this.cleanupInboundDedupe();
			if (this.inboundDedupe.has(dedupeKey)) {
				this.output.appendLine('[inbound-rejected] duplicate message');
				return;
			}
			this.inboundDedupe.set(dedupeKey, Date.now() + this.config.inboundDedupeWindowMs);
		}
		const inboundRequestId = String(message?.requestId || '').trim();
		this.promptBypassMarker?.(text, inboundRequestId);
		await insertIntoChatInput(text, true);
	}

	private cleanupInboundDedupe(): void {
		const now = Date.now();
		for (const [key, expiresAt] of this.inboundDedupe) {
			if (expiresAt <= now) {
				this.inboundDedupe.delete(key);
			}
		}
	}

	private async handleChatHistoryRequest(message: any): Promise<void> {
		const requestId = String(message?.requestId || createRemoteId('history_request'));
		const sessionId = String(message?.sessionId || this.lastSessionId || '');
		if (!this.config.allowHistoryRequest) {
			await this.sendChatHistoryError(sessionId, requestId, 'CHAT_HISTORY_REQUEST_DISABLED', '远端历史请求功能未开启', false);
			return;
		}
		if (message?.payload?.scope && message.payload.scope !== 'project') {
			await this.sendChatHistoryError(sessionId, requestId, 'INVALID_CHAT_HISTORY_REQUEST', '请求参数非法', false);
			return;
		}
		if (this.historyRequestRunning || !this.consumeHistoryRateLimit()) {
			await this.sendChatHistoryError(sessionId, requestId, 'CHAT_HISTORY_RATE_LIMITED', '历史请求频率超限', true);
			return;
		}
		this.historyRequestRunning = true;
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		try {
			if (!workspaceFolder) {
				await this.sendChatHistoryError(sessionId, requestId, 'NO_WORKSPACE', '当前没有打开工作区', false);
				return;
			}
			const projectSettings = await this.configManager?.getProjectChatHistorySettings();
			if (!projectSettings?.enabled) {
				await this.sendChatHistoryError(sessionId, requestId, 'PROJECT_CHAT_HISTORY_DISABLED', '当前项目未开启日志保存', false);
				return;
			}
			const historyDir = path.join(workspaceFolder.uri.fsPath, '.LLSOAI');
			let messages: Array<{ role: string; content: string; timestamp?: string }> = [];
			let truncated = false;
			let truncatedReason = '';
			let responseBytes = 0;
			let dirEntries: string[];
			try {
				dirEntries = await fsp.readdir(historyDir);
			} catch (error: any) {
				if (error?.code === 'ENOENT') {
					await this.sendChatHistoryResponse(sessionId, requestId, workspaceFolder.uri.fsPath, [], false, '');
					return;
				}
				throw error;
			}
			const files = (await Promise.all(dirEntries.map(async name => getChatHistoryFileInfo(name, path.join(historyDir, name)))))
				.filter((file): file is { name: string; fullPath: string; mtimeMs: number } => !!file)
				.sort((a, b) => b.mtimeMs - a.mtimeMs);

			for (const file of files) {
				const fileMessages = await readChatMessagesFromFile(file.fullPath, this.config.historyMaxMessageLength);
				for (let index = fileMessages.length - 1; index >= 0; index--) {
					const candidate = fileMessages[index];
					const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
					if (responseBytes + candidateBytes >= this.config.historyMaxResponseBytes) {
						truncated = true;
						truncatedReason = 'response_size_limit';
						break;
					}
					messages.push(candidate);
					responseBytes += candidateBytes;
					if (messages.length >= this.config.historyMessageLimit) {
						truncated = true;
						truncatedReason = 'message_limit';
						break;
					}
				}
				if (truncated) {
					break;
				}
			}
			messages = messages.reverse();
			await this.sendChatHistoryResponse(sessionId, requestId, workspaceFolder.uri.fsPath, messages, truncated, truncatedReason);
		} catch (error) {
			await this.sendChatHistoryError(sessionId, requestId, 'PROJECT_HISTORY_READ_FAILED', sanitizeHistoryError(error), false);
		} finally {
			this.historyRequestRunning = false;
		}
	}

	private consumeHistoryRateLimit(): boolean {
		const now = Date.now();
		this.historyRequestTimestamps = this.historyRequestTimestamps.filter(timestamp => now - timestamp < 60000);
		if (this.historyRequestTimestamps.length >= this.config.historyRequestRateLimitPerMinute) {
			return false;
		}
		this.historyRequestTimestamps.push(now);
		return true;
	}

	private async sendChatHistoryResponse(
		sessionId: string,
		requestId: string,
		workspacePath: string,
		messages: Array<{ role: string; content: string; timestamp?: string }>,
		truncated: boolean,
		truncatedReason: string
	): Promise<void> {
		const response = this.eventBus.createControlEnvelope('client.chat_history_response', sessionId, this.getWorkspaceId(), this.instanceId, {
			enabled: true,
			scope: 'project',
			workspaceFolder: getTrimmedWorkspacePath(workspacePath),
			messageCount: messages.length,
			limit: this.config.historyMessageLimit,
			truncated,
			truncatedReason,
			messages,
		});
		response.requestId = requestId;
		await this.sendWebsocketMessage(response, true);
	}

	private async sendChatHistoryError(sessionId: string, requestId: string, errorCode: string, errorMessage: string, retryable: boolean): Promise<void> {
		const response = this.eventBus.createControlEnvelope('client.chat_history_error', sessionId, this.getWorkspaceId(), this.instanceId, {
			enabled: false,
			scope: 'project',
			errorCode,
			errorMessage,
			retryable,
		});
		response.requestId = requestId;
		await this.sendWebsocketMessage(response, true);
	}

	dispose(): void {
		this.running = false;
		this.clearHeartbeat();
		this.closeWebsocket();
		this.websocketCache.dispose();
		this.webhookCache.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}

function isWebhookCandidate(event: RemoteNotificationEnvelope): boolean {
	if (event.type !== 'model.assistant_final') {
		return false;
	}
	const text = typeof event.payload?.text === 'string' ? event.payload.text.trim() : '';
	return !!text && event.payload?.hasToolCalls !== true;
}

function toWebhookEnvelope(event: RemoteNotificationEnvelope): RemoteNotificationEnvelope {
	const text = String(event.payload?.text || '');
	return {
		...event,
		type: 'webhook.assistant_final',
		messageId: createRemoteId('msg_webhook'),
		eventId: createRemoteId('evt_webhook'),
		eventSeq: 0,
		payload: {
			messageId: event.payload?.messageId,
			role: 'assistant',
			modelId: event.payload?.modelId || '',
			providerId: event.payload?.providerId || '',
			text,
			textLength: text.length,
			textHash: hashText(text),
			finishReason: event.payload?.finishReason || 'stop',
			completedAt: new Date().toISOString(),
			dedupeKey: `${event.requestId}:${hashText(text)}`,
			workspaceFolders: getWorkspaceFolders(),
		},
	};
}

function getWorkspaceFolders(): RemoteWorkspaceFolderInfo[] {
	const folders = vscode.workspace.workspaceFolders || [];
	return folders.map((folder, index) => ({
		name: folder.name,
		path: getTrimmedWorkspacePath(folder.uri.fsPath),
		isPrimary: index === 0,
	}));
}

const MAX_HISTORY_FILE_BYTES = 10 * 1024 * 1024;

async function getChatHistoryFileInfo(name: string, fullPath: string): Promise<{ name: string; fullPath: string; mtimeMs: number } | null> {
	try {
		if (!isChatHistoryFileName(name)) {
			return null;
		}
		const lstat = await fsp.lstat(fullPath);
		if (lstat.isSymbolicLink() || !lstat.isFile() || lstat.size > MAX_HISTORY_FILE_BYTES) {
			return null;
		}
		return { name, fullPath, mtimeMs: lstat.mtimeMs };
	} catch {
		return null;
	}
}

function isChatHistoryFileName(name: string): boolean {
	return name.endsWith('.json')
		&& (/^chat_.*\.json$/i.test(name) || /^chat-session-.*\.json$/i.test(name) || /^\d{4}-\d{2}-\d{2}\.json$/i.test(name));
}

async function readChatMessagesFromFile(fullPath: string, maxMessageLength: number): Promise<Array<{ role: string; content: string; timestamp?: string }>> {
	try {
		const raw = await fsp.readFile(fullPath, 'utf8');
		const parsed = JSON.parse(raw);
		const sourceMessages = extractMessageArray(parsed);
		return sourceMessages
			.map(message => normalizeHistoryMessage(message, maxMessageLength))
			.filter((message): message is { role: string; content: string; timestamp?: string } => !!message);
	} catch {
		return [];
	}
}

function extractMessageArray(value: any): any[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (value && typeof value === 'object') {
		if (Array.isArray(value.messages)) {
			return value.messages;
		}
		if (Array.isArray(value.conversation)) {
			return value.conversation;
		}
		if (Array.isArray(value.records)) {
			return value.records;
		}
	}
	return [];
}

function sanitizeHistoryError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\/[^\s:]+/g, '[path]').replace(/[A-Za-z]:\\[^\s:]+/g, '[path]');
}

function normalizeHistoryMessage(value: any, maxMessageLength: number): { role: string; content: string; timestamp?: string } | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	if (value.role === undefined || value.content === undefined) {
		return null;
	}
	const role = String(value.role);
	let content: string;
	if (typeof value.content === 'string') {
		content = value.content;
	} else {
		try {
			content = JSON.stringify(value.content);
		} catch {
			return null;
		}
	}
	if (!content) {
		return null;
	}
	if (role.toLowerCase() === 'user') {
		content = extractUserRequestContent(content);
	}
	if (content.length > maxMessageLength) {
		content = content.slice(0, maxMessageLength);
	}
	const timestamp = typeof value.timestamp === 'string' ? value.timestamp : typeof value.createdAt === 'string' ? value.createdAt : undefined;
	return { role, content, timestamp };
}

function extractUserRequestContent(content: string): string {
	const matches = Array.from(content.matchAll(/<userRequest>([\s\S]*?)<\/userRequest>/g));
	if (matches.length === 0) {
		return content;
	}
	return matches.map(match => match[1].trim()).filter(Boolean).join('\n\n') || content;
}
