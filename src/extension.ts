import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { OpenAPIChatModelProvider } from './provider';
import { ConfigViewProvider, ConfigViewPanel } from './views/configView';
import { initLlsTaskStatusBar, initStatusBar, refreshContextStatusBarLanguage, sendCompactCommand } from './statusBar';
import { initPromptEnhancementStatusBar } from './promptEnhancementStatusBar';
import { LlsTaskService } from './llsTask/service';
import { TimelineService } from './timeline/service';
import { RemoteNotificationEventBus } from './remoteNotification/eventBus';
import { RemoteNotificationService } from './remoteNotification/service';

export function activate(context: vscode.ExtensionContext) {
	console.log('LLS OAI is now active!');

	// Create status bar item for token count display
	const statusBarItem = initStatusBar(context, 'openapicopilot.openConfig');

	// Initialize config manager
	const configManager = new ConfigManager(context, context.secrets);
	const llsTaskService = new LlsTaskService(configManager);
	const llsTaskParticipant = vscode.chat.createChatParticipant(
		'lls.task',
		async (request, _context, stream) => {
			await llsTaskService.handleChatRequest(request, stream);
		}
	);
	context.subscriptions.push(llsTaskParticipant);
	initPromptEnhancementStatusBar(context, configManager);
	initLlsTaskStatusBar(context, configManager, llsTaskService);

	// Initialize local timeline service for AI agent recovery support
	const timelineOutput = vscode.window.createOutputChannel('OpenAPI Copilot Timeline');
	const timelineService = new TimelineService(context, timelineOutput);
	context.subscriptions.push(timelineOutput, timelineService.register());

	// Initialize remote notification service
	const remoteNotificationEventBus = new RemoteNotificationEventBus();
	const remoteNotificationService = new RemoteNotificationService(context, remoteNotificationEventBus, configManager);
	remoteNotificationService.registerStatusBar('openapicopilot.remoteNotification.openSettings');
	context.subscriptions.push(remoteNotificationEventBus, remoteNotificationService);

	// Register the chat provider
	const chatProvider = new OpenAPIChatModelProvider(configManager, statusBarItem, timelineService, remoteNotificationService, llsTaskService);
	remoteNotificationService.setPromptBypassMarker((prompt: string, requestId?: string) => chatProvider.markRemoteInboundPromptBypass(prompt, requestId));
	remoteNotificationService.start();
	const providerRegistration = vscode.lm.registerLanguageModelChatProvider('openapicopilot', chatProvider);
	context.subscriptions.push(providerRegistration);

	// Register config view provider
	const configViewProvider = new ConfigViewProvider(context.extensionUri, configManager, chatProvider);
	const viewRegistration = vscode.window.registerWebviewViewProvider(
		ConfigViewProvider.viewType,
		configViewProvider
	);
	context.subscriptions.push(viewRegistration);

	// Register command: Manage providers (opens Copilot management UI)
	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.manageProviders', async () => {
			// Focus the config view
			await vscode.commands.executeCommand(`${ConfigViewProvider.viewType}.focus`);
		})
	);

	// Register command: Open configuration UI
	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.openConfig', async () => {
			// Focus the config view (same as manageProviders)
			await vscode.commands.executeCommand(`${ConfigViewProvider.viewType}.focus`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.compactContext', async () => {
			await sendCompactCommand();
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openapicopilot.language')) {
				refreshContextStatusBarLanguage(statusBarItem, configManager.getResolvedLanguage());
			}
		})
	);

	// Register command: Open Global Settings in editor tab
	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.openGlobalSettingsTab', async () => {
			await ConfigViewPanel.openPanel(context.extensionUri, configManager, chatProvider, 'global');
		})
	);

	// Register command: Open Project Settings in editor tab
	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.openProjectSettingsTab', async () => {
			await ConfigViewPanel.openPanel(context.extensionUri, configManager, chatProvider, 'project');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.remoteNotification.openSettings', async () => {
			await remoteNotificationService.openSettings();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.remoteNotification.reconnect', () => {
			remoteNotificationService.reconnect();
		})
	);
}

export function deactivate() {
	// Status bar item is disposed automatically via context.subscriptions
}
