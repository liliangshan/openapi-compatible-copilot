import * as vscode from 'vscode';
import { RemoteNotificationEnvelope } from './types';

export class RemoteNotificationCache implements vscode.Disposable {
	private readonly queue: RemoteNotificationEnvelope[] = [];
	private dropped = 0;
	private pendingResolver: (() => void) | undefined;

	constructor(private limit: number) {}

	setLimit(limit: number): void {
		this.limit = Math.max(1, limit);
		while (this.queue.length > this.limit) {
			this.queue.shift();
			this.dropped++;
		}
	}

	enqueue(event: RemoteNotificationEnvelope): void {
		if (this.queue.length >= this.limit) {
			const removableIndex = this.queue.findIndex(item => !isCriticalEvent(item.type));
			if (removableIndex >= 0) {
				this.queue.splice(removableIndex, 1);
				this.dropped++;
			} else if (!isCriticalEvent(event.type)) {
				this.dropped++;
				return;
			} else if (this.queue.length < this.limit * 2) {
				// Temporarily exceed the configured limit to preserve critical events.
			} else {
				this.dropped++;
				return;
			}
		}
		this.queue.push(event);
		this.pendingResolver?.();
		this.pendingResolver = undefined;
	}

	dequeue(): RemoteNotificationEnvelope | undefined {
		return this.queue.shift();
	}

	get length(): number {
		return this.queue.length;
	}

	get droppedCount(): number {
		return this.dropped;
	}

	async waitForItem(): Promise<void> {
		if (this.queue.length > 0) {
			return;
		}
		await new Promise<void>(resolve => {
			this.pendingResolver = resolve;
		});
	}

	dispose(): void {
		this.queue.splice(0, this.queue.length);
		this.pendingResolver?.();
		this.pendingResolver = undefined;
	}
}

function isCriticalEvent(type: string): boolean {
	return type === 'model.request_started'
		|| type === 'model.assistant_final'
		|| type === 'model.request_completed'
		|| type === 'model.request_cancelled'
		|| type === 'model.request_error'
		|| type === 'model.tool_call_completed'
		|| type === 'model.tool_result'
		|| type === 'client.connection_context';
}
