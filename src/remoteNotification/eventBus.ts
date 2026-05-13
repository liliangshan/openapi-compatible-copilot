import * as vscode from 'vscode';
import { createRemoteId, RemoteNotificationEnvelope, RemoteNotificationModelEvent } from './types';

export type RemoteEventListener = (event: RemoteNotificationEnvelope) => void;

export class RemoteNotificationEventBus implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<RemoteNotificationEnvelope>();
	private seqByKey = new Map<string, number>();

	readonly event = this.emitter.event;

	emitModelEvent(event: RemoteNotificationModelEvent, workspaceId: string, instanceId: string): RemoteNotificationEnvelope {
		const eventSeq = this.nextSeq(event.sessionId, event.requestId);
		const envelope: RemoteNotificationEnvelope = {
			protocolVersion: '1.0',
			type: event.type,
			messageId: createRemoteId('msg'),
			eventId: createRemoteId('evt'),
			eventSeq,
			sessionId: event.sessionId,
			requestId: event.requestId,
			workspaceId,
			instanceId,
			timestamp: new Date().toISOString(),
			source: 'vscode-extension',
			payload: event.payload,
			workspaceFolders: [],
			activeWorkspaceFolder: '',
		};
		this.emitter.fire(envelope);
		return envelope;
	}

	createControlEnvelope(type: string, sessionId: string, workspaceId: string, instanceId: string, payload: Record<string, any>): RemoteNotificationEnvelope {
		return {
			protocolVersion: '1.0',
			type,
			messageId: createRemoteId('msg'),
			eventId: createRemoteId('evt'),
			eventSeq: this.nextSeq(sessionId, '__control__'),
			sessionId,
			requestId: '',
			workspaceId,
			instanceId,
			timestamp: new Date().toISOString(),
			source: 'vscode-extension',
			payload,
			workspaceFolders: [],
			activeWorkspaceFolder: '',
		};
	}

	private nextSeq(sessionId: string, requestId: string): number {
		const key = `${sessionId || 'unknown'}::${requestId || '__control__'}`;
		const next = (this.seqByKey.get(key) || 0) + 1;
		this.seqByKey.set(key, next);
		return next;
	}

	dispose(): void {
		this.emitter.dispose();
		this.seqByKey.clear();
	}
}
