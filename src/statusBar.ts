import * as vscode from 'vscode';
import { ResolvedAppLanguage } from './configManager';
import { insertIntoChatInput } from './promptEnhancementStatusBar';

const DEFAULT_TOTAL_CONTEXT_TOKENS = 156_000;
const COMPACT_REMAINING_THRESHOLD_TOKENS = 50_000;
const COMPACT_PROMPT = '/compact';

const COMPACT_ACTION_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'click to compact',
	'zh-cn': '点此压缩',
	'zh-tw': '點此壓縮',
	ko: '클릭하여 압축',
	ja: 'クリックして圧縮',
	fr: 'cliquer pour compacter',
	de: 'zum Komprimieren klicken',
};

const COMPACT_TOOLTIP_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'Click to send /compact',
	'zh-cn': '点击发送 /compact',
	'zh-tw': '點擊傳送 /compact',
	ko: '/compact 보내려면 클릭',
	ja: 'クリックして /compact を送信',
	fr: 'Cliquez pour envoyer /compact',
	de: 'Klicken, um /compact zu senden',
};

interface ContextStatusBarState {
	messagesTokens: number;
	toolTokens: number;
	totalTokenCount: number;
	maxTokens: number;
	shouldShowCompactAction: boolean;
}

const contextStatusBarStates = new WeakMap<vscode.StatusBarItem, ContextStatusBarState>();

export async function sendCompactCommand(): Promise<void> {
	await insertIntoChatInput(COMPACT_PROMPT, true);
}

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

function renderContextStatusBar(
	statusBarItem: vscode.StatusBarItem,
	state: ContextStatusBarState,
	language: ResolvedAppLanguage
): void {
	const { messagesTokens, toolTokens, totalTokenCount, maxTokens, shouldShowCompactAction } = state;
	const progressBar = createProgressBar(totalTokenCount, maxTokens);
	const compactActionText = COMPACT_ACTION_TEXT[language] || COMPACT_ACTION_TEXT.en;
	statusBarItem.text = `$(symbol-parameter) ${progressBar}${shouldShowCompactAction ? ` (${compactActionText})` : ''}`;
	statusBarItem.tooltip = `Token Usage: ${formatTokenCount(totalTokenCount)} / ${formatTokenCount(maxTokens)}
${progressBar}

  - Messages: ${formatTokenCount(messagesTokens)}  (${Math.min((messagesTokens / maxTokens) * 100, 100).toFixed(1)}%)
  - Tools: ${formatTokenCount(toolTokens)}  (${Math.min((toolTokens / maxTokens) * 100, 100).toFixed(1)}%)

${shouldShowCompactAction ? (COMPACT_TOOLTIP_TEXT[language] || COMPACT_TOOLTIP_TEXT.en) : 'Click to Open Configuration UI'}`;
	statusBarItem.command = shouldShowCompactAction ? 'openapicopilot.compactContext' : 'openapicopilot.openConfig';
}

export function refreshContextStatusBarLanguage(statusBarItem: vscode.StatusBarItem, language: ResolvedAppLanguage): void {
	const state = contextStatusBarStates.get(statusBarItem);
	if (!state) {
		return;
	}
	renderContextStatusBar(statusBarItem, state, language);
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
	tokenCountFn: (text: string | vscode.LanguageModelChatRequestMessage) => Promise<number>,
	language: ResolvedAppLanguage = 'en'
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
	const maxTokens = model.maxInputTokens + model.maxOutputTokens || DEFAULT_TOTAL_CONTEXT_TOKENS;
	const remainingTokens = maxTokens - totalTokenCount;
	const shouldShowCompactAction = remainingTokens < COMPACT_REMAINING_THRESHOLD_TOKENS;
	const state: ContextStatusBarState = {
		messagesTokens,
		toolTokens,
		totalTokenCount,
		maxTokens,
		shouldShowCompactAction,
	};
	contextStatusBarStates.set(statusBarItem, state);
	renderContextStatusBar(statusBarItem, state, language);

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
	contextStatusBarStates.delete(statusBarItem);
	statusBarItem.text = '$(symbol-numeric) Ready';
	statusBarItem.tooltip = 'Current model token usage - Click to Open Configuration UI';
	statusBarItem.command = 'openapicopilot.openConfig';
	statusBarItem.backgroundColor = undefined;
}
