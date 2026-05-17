import * as vscode from 'vscode';
import { ConfigManager, ResolvedAppLanguage } from './configManager';
import { LlsTaskService } from './llsTask/service';
import { insertIntoChatInput } from './promptEnhancementStatusBar';

const DEFAULT_TOTAL_CONTEXT_TOKENS = 156_000;
const COMPACT_REMAINING_THRESHOLD_TOKENS = 50_000;
const COMPACT_PROMPT = '/compact';
const LLS_TASK_START_PROMPT: Record<ResolvedAppLanguage, string> = {
	'en': '@lls-task Please drag the solution planning document from Explorer into this window.',
	'zh-cn': '@lls-task 请把资源管理器中的方案规划文档拖到这个窗口中',
	'zh-tw': '@lls-task 請把資源管理器中的方案規劃文件拖到這個視窗中',
	ko: '@lls-task 탐색기의 솔루션 계획 문서를 이 창으로 끌어다 놓으세요.',
	ja: '@lls-task エクスプローラー内のソリューション計画ドキュメントをこのウィンドウにドラッグしてください。',
	fr: '@lls-task Veuillez faire glisser le document de planification de solution depuis l’explorateur dans cette fenêtre.',
	de: '@lls-task Bitte ziehen Sie das Lösungsplanungsdokument aus dem Explorer in dieses Fenster.',
};

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

const LLS_TASK_STATUS_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'LLS Task',
	'zh-cn': '任务流',
	'zh-tw': '任務流程',
	ko: '작업 흐름',
	ja: 'タスクフロー',
	fr: 'Flux de tâches',
	de: 'Aufgabenfluss',
};

const LLS_TASK_MISSING_MODEL_TOOLTIP: Record<ResolvedAppLanguage, string> = {
	'en': 'Please configure the @lls-task workflow model first.',
	'zh-cn': '请先设置 @lls-task 任务流模型。',
	'zh-tw': '請先設定 @lls-task 任務流程模型。',
	ko: '@lls-task 작업 흐름 모델을 먼저 설정하세요.',
	ja: '@lls-task タスクフローモデルを先に設定してください。',
	fr: 'Veuillez d’abord configurer le modèle de flux de tâches @lls-task.',
	de: 'Bitte konfigurieren Sie zuerst das @lls-task-Aufgabenflussmodell.',
};

const LLS_TASK_NO_WORKFLOW_TOOLTIP: Record<ResolvedAppLanguage, string> = {
	'en': 'Click here, then drag the solution planning Markdown document into the chat window to execute the task workflow.',
	'zh-cn': '请点击这，然后拖入方案规划 md 文档执行任务流。',
	'zh-tw': '請點擊這裡，然後拖入方案規劃 md 文件以執行任務流程。',
	ko: '여기를 클릭한 다음, 솔루션 계획 Markdown 문서를 채팅 창으로 끌어다 놓아 작업 흐름을 실행하세요.',
	ja: 'ここをクリックしてから、ソリューション計画 Markdown ドキュメントをチャットウィンドウにドラッグしてタスクフローを実行してください。',
	fr: 'Cliquez ici, puis faites glisser le document Markdown de planification de solution dans la fenêtre de chat pour exécuter le flux de tâches.',
	de: 'Klicken Sie hier und ziehen Sie dann das Markdown-Planungsdokument in das Chatfenster, um den Aufgabenfluss auszuführen.',
};

const LLS_TASK_NEW_WORKFLOW_TOOLTIP: Record<ResolvedAppLanguage, string> = {
	'en': 'Click here, then drag the solution planning Markdown document into the chat window to execute a new task workflow.',
	'zh-cn': '点击这，然后拖入方案规划 md 文档执行新的任务流。',
	'zh-tw': '點擊這裡，然後拖入方案規劃 md 文件以執行新的任務流程。',
	ko: '여기를 클릭한 다음, 솔루션 계획 Markdown 문서를 채팅 창으로 끌어다 놓아 새 작업 흐름을 실행하세요.',
	ja: 'ここをクリックしてから、ソリューション計画 Markdown ドキュメントをチャットウィンドウにドラッグして新しいタスクフローを実行してください。',
	fr: 'Cliquez ici, puis faites glisser le document Markdown de planification de solution dans la fenêtre de chat pour exécuter un nouveau flux de tâches.',
	de: 'Klicken Sie hier und ziehen Sie dann das Markdown-Planungsdokument in das Chatfenster, um einen neuen Aufgabenfluss auszuführen.',
};

const LLS_TASK_PROGRESS_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'Progress',
	'zh-cn': '进度',
	'zh-tw': '進度',
	ko: '진행률',
	ja: '進捗',
	fr: 'Progression',
	de: 'Fortschritt',
};

const LLS_TASK_STATUS_LABELS: Record<ResolvedAppLanguage, Record<string, string>> = {
	'en': { pending: 'pending', in_progress: 'in progress', completed: 'completed', blocked: 'blocked' },
	'zh-cn': { pending: '待处理', in_progress: '进行中', completed: '已完成', blocked: '已阻塞' },
	'zh-tw': { pending: '待處理', in_progress: '進行中', completed: '已完成', blocked: '已阻塞' },
	ko: { pending: '대기 중', in_progress: '진행 중', completed: '완료됨', blocked: '차단됨' },
	ja: { pending: '未着手', in_progress: '進行中', completed: '完了', blocked: 'ブロック' },
	fr: { pending: 'en attente', in_progress: 'en cours', completed: 'terminé', blocked: 'bloqué' },
	de: { pending: 'ausstehend', in_progress: 'in Bearbeitung', completed: 'abgeschlossen', blocked: 'blockiert' },
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

export function initLlsTaskStatusBar(context: vscode.ExtensionContext, configManager: ConfigManager, taskService: LlsTaskService): vscode.StatusBarItem {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
	statusBarItem.name = 'LLS Task Workflow';
	statusBarItem.command = 'openapicopilot.llsTask.openMenu';
	context.subscriptions.push(statusBarItem);
	statusBarItem.show();

	const refresh = () => {
		const language = configManager.getResolvedLanguage();
		const snapshot = taskService.getSnapshot();
		const workflow = snapshot.workflow;
		const label = LLS_TASK_STATUS_TEXT[language] || LLS_TASK_STATUS_TEXT.en;
		const taskConfig = configManager.getLlsTaskConfig();
		const hasTaskModel = !!taskConfig.providerId?.trim() && !!taskConfig.modelId?.trim();
		if (workflow) {
			const completed = workflow.tasks.filter(task => task.status === 'completed').length;
			const total = workflow.tasks.length;
			statusBarItem.text = `$(checklist) ${label} ${completed}/${total}`;
			statusBarItem.tooltip = buildLlsTaskWorkflowTooltip(workflow, language, taskService.isWorkflowCompleted());
			return;
		}
		statusBarItem.text = `$(checklist) ${label}`;
		statusBarItem.tooltip = hasTaskModel
			? (LLS_TASK_NO_WORKFLOW_TOOLTIP[language] || LLS_TASK_NO_WORKFLOW_TOOLTIP.en)
			: (LLS_TASK_MISSING_MODEL_TOOLTIP[language] || LLS_TASK_MISSING_MODEL_TOOLTIP.en);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('openapicopilot.llsTask.openMenu', async () => {
			const snapshot = taskService.getSnapshot();
			if (snapshot.workflow && !taskService.isWorkflowCompleted()) {
				await taskService.showProgress();
				return;
			}

			const taskConfig = configManager.getLlsTaskConfig();
			if (!taskConfig.providerId?.trim() || !taskConfig.modelId?.trim()) {
				await vscode.commands.executeCommand('openapicopilot.openGlobalSettingsTab');
				return;
			}

			const language = configManager.getResolvedLanguage();
			await insertIntoChatInput(LLS_TASK_START_PROMPT[language] || LLS_TASK_START_PROMPT.en, false);
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openapicopilot.language')) {
				refresh();
			}
		}),
		taskService.onDidChange(() => refresh())
	);

	refresh();

	return statusBarItem;
}

function buildLlsTaskWorkflowTooltip(
	workflow: NonNullable<ReturnType<LlsTaskService['getSnapshot']>['workflow']>,
	language: ResolvedAppLanguage,
	isCompleted: boolean
): string {
	const completed = workflow.tasks.filter(task => task.status === 'completed').length;
	const total = workflow.tasks.length;
	const progressText = LLS_TASK_PROGRESS_TEXT[language] || LLS_TASK_PROGRESS_TEXT.en;
	const statusLabels = LLS_TASK_STATUS_LABELS[language] || LLS_TASK_STATUS_LABELS.en;
	const lines = [
		workflow.title,
		`${progressText}: ${completed}/${total}`,
		'',
		...workflow.tasks.map((task, index) => `${index + 1}. ${statusIcon(task.status)} ${task.title} (${statusLabels[task.status] || task.status})`),
	];
	if (isCompleted) {
		lines.push('', LLS_TASK_NEW_WORKFLOW_TOOLTIP[language] || LLS_TASK_NEW_WORKFLOW_TOOLTIP.en);
	}
	return lines.join('\n');
}

function statusIcon(status: string): string {
	if (status === 'completed') {
		return '✓';
	}
	if (status === 'in_progress') {
		return '↻';
	}
	if (status === 'blocked') {
		return '⚠';
	}
	return '○';
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
