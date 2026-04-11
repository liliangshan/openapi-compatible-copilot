import * as vscode from 'vscode';

/**
 * Format number to thousands (K, M, B) format
 */
export function formatTokenCount(value: number): string {
	if (value >= 1_000_000_000) {
		return (value / 1_000_000_000).toFixed(1) + 'B';
	} else if (value >= 1_000_000) {
		return (value / 1_000_000).toFixed(1) + 'M';
	} else if (value >= 1_000) {
		return (value / 1_000).toFixed(1) + 'K';
	}
	return value.toLocaleString();
}

/**
 * Create a visual progress bar showing token usage
 */
export function createProgressBar(usedTokens: number, maxTokens: number): string {
	const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
	const usagePercentage = Math.min((usedTokens / maxTokens) * 100, 100);
	const blockIndex = Math.min(Math.floor((usagePercentage / 100) * blocks.length), blocks.length - 1);
	return `${blocks[blockIndex]} ${usagePercentage.toFixed(1)}%`;
}

/**
 * Initialize the status bar item for token count display
 */
export function initStatusBar(context: vscode.ExtensionContext, command: string): vscode.StatusBarItem {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.name = 'Token Count';
	statusBarItem.text = '$(symbol-numeric) Ready';
	statusBarItem.tooltip = 'Current model token usage - Click to Open Configuration UI';
	statusBarItem.command = command;
	context.subscriptions.push(statusBarItem);
	statusBarItem.show();
	return statusBarItem;
}

/**
 * Update the status bar with token usage information
 */
export async function updateContextStatusBar(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
	model: vscode.LanguageModelChatInformation,
	statusBarItem: vscode.StatusBarItem,
	tokenCountFn: (text: string | vscode.LanguageModelChatRequestMessage) => Promise<number>
): Promise<void> {
	// Calculate tokens for all messages
	let messagesTokens = 0;
	for (const message of messages) {
		messagesTokens += await tokenCountFn(message);
	}

	// Calculate tool definition tokens (estimate)
	let toolTokens = 0;
	if (tools && tools.length > 0) {
		const baseToolTokens = 16;
		const baseTokensPerTool = 8;
		toolTokens = baseToolTokens + (tools.length * baseTokensPerTool);
		for (const tool of tools) {
			toolTokens += await tokenCountFn(JSON.stringify(tool));
		}
	}

	// Total tokens
	const totalTokenCount = messagesTokens + toolTokens;
	const maxTokens = model.maxInputTokens + model.maxOutputTokens;

	// Create visual progress bar
	const progressBar = createProgressBar(totalTokenCount, maxTokens);
	statusBarItem.text = `$(symbol-parameter) ${progressBar}`;
	statusBarItem.tooltip = `Token Usage: ${formatTokenCount(totalTokenCount)} / ${formatTokenCount(maxTokens)}
${progressBar}

  - Messages: ${formatTokenCount(messagesTokens)}  (${Math.min((messagesTokens / maxTokens) * 100, 100).toFixed(1)}%)
  - Tools: ${formatTokenCount(toolTokens)}  (${Math.min((toolTokens / maxTokens) * 100, 100).toFixed(1)}%)

Click to Open Configuration UI`;

	// Color coding based on token usage
	const usagePercentage = (totalTokenCount / maxTokens) * 100;
	if (usagePercentage >= 90) {
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
	} else if (usagePercentage >= 70) {
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	} else {
		statusBarItem.backgroundColor = undefined;
	}
}

/**
 * Reset status bar to default state
 */
export function resetStatusBar(statusBarItem: vscode.StatusBarItem): void {
	statusBarItem.text = '$(symbol-numeric) Ready';
	statusBarItem.tooltip = 'Current model token usage - Click to Open Configuration UI';
	statusBarItem.backgroundColor = undefined;
}
