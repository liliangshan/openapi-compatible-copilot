import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { OpenAPIChatModelProvider } from './provider';
import { ConfigViewProvider } from './views/configView';
import { initStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext) {
	console.log('LLS OAI is now active!');

	// Create status bar item for token count display
	const statusBarItem = initStatusBar(context, 'openapicopilot.openConfig');

	// Initialize config manager
	const configManager = new ConfigManager(context, context.secrets);

	// Register the chat provider
	const chatProvider = new OpenAPIChatModelProvider(configManager, statusBarItem);
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
}

export function deactivate() {
	// Status bar item is disposed automatically via context.subscriptions
}
