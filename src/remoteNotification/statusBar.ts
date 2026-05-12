import * as vscode from 'vscode';
import { ResolvedAppLanguage } from '../configManager';
import { getRemoteNotificationTexts, RemoteNotificationTexts } from './messages';
import { RemoteNotificationStatus } from './types';

export class RemoteNotificationStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private status: RemoteNotificationStatus = 'disabled';
	private tooltip = '';
	private texts: RemoteNotificationTexts;

	constructor(command: string, language: ResolvedAppLanguage) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
		this.item.name = 'Remote Work';
		this.item.command = command;
		this.texts = getRemoteNotificationTexts(language);
		this.refresh();
	}

	updateLanguage(language: ResolvedAppLanguage): void {
		this.texts = getRemoteNotificationTexts(language);
		this.refresh();
	}

	update(status: RemoteNotificationStatus, tooltip?: string): void {
		this.status = status;
		this.tooltip = tooltip || '';
		this.refresh();
	}

	private refresh(): void {
		this.item.text = this.texts.status[this.status];
		this.item.tooltip = this.tooltip || this.texts.status[this.status];
		this.item.show();
	}

	dispose(): void {
		this.item.dispose();
	}
}
