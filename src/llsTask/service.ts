import * as vscode from 'vscode';
import { ConfigManager, ResolvedAppLanguage } from '../configManager';
import { insertIntoChatInput } from '../promptEnhancementStatusBar';
import { convertOpenAIRequestToAnthropic } from '../utils/anthropicConverter';
import { convertChatCompletionsToResponsesAPI } from '../utils/v1ResponseConverter';

export interface LlsTaskWorkflowItem {
	id: string;
	title: string;
	description?: string;
	status: LlsTaskWorkflowStatus;
}

export type LlsTaskWorkflowStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface LlsTaskWorkflow {
	title: string;
	summary?: string;
	tasks: LlsTaskWorkflowItem[];
}

export interface LlsTaskStatusSnapshot {
	workflow?: LlsTaskWorkflow;
	updatedAt?: number;
	planningDocumentPath?: string;
}

export interface LlsTaskWorkflowStatusUpdate {
	taskId: string;
	status: LlsTaskWorkflowStatus;
}

export interface LlsTaskAutoContinueOptions {
	isMainModelRunning: () => boolean;
}

type ChatReferenceLike = vscode.ChatPromptReference & {
	value?: unknown;
};

const DOCUMENT_EXTENSIONS = new Set([
	'.md',
	'.markdown',
	'.mdx',
	'.txt',
	'.rst',
	'.adoc',
]);

const AUTO_CONTINUE_DELAY_MS = 15_000;

const MESSAGES: Record<ResolvedAppLanguage, {
	missingDocument: string;
	missingModel: string;
	providerNotFound: string;
	analyzing: string;
	failed: string;
	completed: string;
}> = {
	'en': {
		missingDocument: 'Error: No planning document was provided. Please drag the solution planning document from Explorer into this @lls-task window.',
		missingModel: 'Error: @lls-task workflow model is not configured. Please select a task workflow provider and model in Global Settings.',
		providerNotFound: 'Error: @lls-task provider or model was not found. Please check Global Settings.',
		analyzing: 'Analyzing the planning document and generating task workflow JSON...',
		failed: 'Failed to generate task workflow.',
		completed: 'Task workflow generated and updated to the status bar.',
	},
	'zh-cn': {
		missingDocument: '错误：没有提供方案规划文档。请把资源管理器中的方案规划文档拖到这个 @lls-task 窗口中。',
		missingModel: '错误：尚未配置 @lls-task 任务流模型。请先在全局设置中选择任务流提供商和模型。',
		providerNotFound: '错误：未找到 @lls-task 提供商或模型，请检查全局设置。',
		analyzing: '正在分析方案规划文档并生成任务流 JSON...',
		failed: '生成任务流失败。',
		completed: '任务流已生成，并已更新到状态栏。',
	},
	'zh-tw': {
		missingDocument: '錯誤：沒有提供方案規劃文件。請把資源管理器中的方案規劃文件拖到這個 @lls-task 視窗中。',
		missingModel: '錯誤：尚未設定 @lls-task 任務流程模型。請先在全域設定中選擇任務流程提供商和模型。',
		providerNotFound: '錯誤：找不到 @lls-task 提供商或模型，請檢查全域設定。',
		analyzing: '正在分析方案規劃文件並生成任務流程 JSON...',
		failed: '生成任務流程失敗。',
		completed: '任務流程已生成，並已更新到狀態列。',
	},
	ko: {
		missingDocument: '오류: 계획 문서가 제공되지 않았습니다. 탐색기의 솔루션 계획 문서를 이 @lls-task 창으로 끌어다 놓으세요.',
		missingModel: '오류: @lls-task 작업 흐름 모델이 설정되지 않았습니다. 전역 설정에서 공급자와 모델을 선택하세요.',
		providerNotFound: '오류: @lls-task 공급자 또는 모델을 찾을 수 없습니다. 전역 설정을 확인하세요.',
		analyzing: '계획 문서를 분석하고 작업 흐름 JSON을 생성하는 중...',
		failed: '작업 흐름 생성에 실패했습니다.',
		completed: '작업 흐름이 생성되어 상태 표시줄에 업데이트되었습니다.',
	},
	ja: {
		missingDocument: 'エラー: 計画ドキュメントが提供されていません。エクスプローラー内のソリューション計画ドキュメントをこの @lls-task ウィンドウにドラッグしてください。',
		missingModel: 'エラー: @lls-task タスクフローモデルが設定されていません。グローバル設定でプロバイダーとモデルを選択してください。',
		providerNotFound: 'エラー: @lls-task プロバイダーまたはモデルが見つかりません。グローバル設定を確認してください。',
		analyzing: '計画ドキュメントを分析し、タスクフロー JSON を生成しています...',
		failed: 'タスクフローの生成に失敗しました。',
		completed: 'タスクフローを生成し、ステータスバーに更新しました。',
	},
	fr: {
		missingDocument: 'Erreur : aucun document de planification fourni. Faites glisser le document de planification de solution depuis l’explorateur dans cette fenêtre @lls-task.',
		missingModel: 'Erreur : le modèle de flux de tâches @lls-task n’est pas configuré. Sélectionnez un fournisseur et un modèle dans les paramètres globaux.',
		providerNotFound: 'Erreur : fournisseur ou modèle @lls-task introuvable. Vérifiez les paramètres globaux.',
		analyzing: 'Analyse du document de planification et génération du JSON de flux de tâches...',
		failed: 'Échec de génération du flux de tâches.',
		completed: 'Flux de tâches généré et mis à jour dans la barre d’état.',
	},
	de: {
		missingDocument: 'Fehler: Es wurde kein Planungsdokument bereitgestellt. Ziehen Sie das Lösungsplanungsdokument aus dem Explorer in dieses @lls-task-Fenster.',
		missingModel: 'Fehler: Das @lls-task-Aufgabenflussmodell ist nicht konfiguriert. Wählen Sie Anbieter und Modell in den globalen Einstellungen aus.',
		providerNotFound: 'Fehler: @lls-task-Anbieter oder Modell wurde nicht gefunden. Bitte prüfen Sie die globalen Einstellungen.',
		analyzing: 'Planungsdokument wird analysiert und Aufgabenfluss-JSON generiert...',
		failed: 'Aufgabenfluss konnte nicht generiert werden.',
		completed: 'Aufgabenfluss wurde generiert und in der Statusleiste aktualisiert.',
	},
};

export class LlsTaskService {
	private workflow?: LlsTaskWorkflow;
	private updatedAt?: number;
	private planningDocumentPath?: string;
	private autoContinueTimer?: NodeJS.Timeout;
	private autoContinueInProgress = false;
	private readonly didChangeEmitter = new vscode.EventEmitter<LlsTaskStatusSnapshot>();
	readonly onDidChange = this.didChangeEmitter.event;

	constructor(private readonly configManager: ConfigManager) {}

	getSnapshot(): LlsTaskStatusSnapshot {
		return {
			workflow: this.workflow,
			updatedAt: this.updatedAt,
			planningDocumentPath: this.planningDocumentPath,
		};
	}

	getProgress(): { completed: number; total: number; inProgress: number; blocked: number } {
		const tasks = this.workflow?.tasks || [];
		return {
			completed: tasks.filter(task => task.status === 'completed').length,
			total: tasks.length,
			inProgress: tasks.filter(task => task.status === 'in_progress').length,
			blocked: tasks.filter(task => task.status === 'blocked').length,
		};
	}

	clearAutoContinueTimer(): void {
		if (this.autoContinueTimer) {
			clearTimeout(this.autoContinueTimer);
			this.autoContinueTimer = undefined;
		}
	}

	scheduleAutoContinue(options: LlsTaskAutoContinueOptions): void {
		this.clearAutoContinueTimer();
		if (!this.workflow || this.isWorkflowCompleted()) {
			return;
		}

		this.autoContinueTimer = setTimeout(() => {
			this.autoContinueTimer = undefined;
			void this.tryAutoContinue(options);
		}, AUTO_CONTINUE_DELAY_MS);
	}

	isWorkflowCompleted(): boolean {
		const tasks = this.workflow?.tasks || [];
		return tasks.length > 0 && tasks.every(task => task.status === 'completed');
	}

	buildMainModelPrompt(language: ResolvedAppLanguage): string | undefined {
		if (!this.workflow) {
			return undefined;
		}
		const label = LLS_TASK_STATUS_TEXT[language] || LLS_TASK_STATUS_TEXT.en;
		const progress = this.getProgress();
		return [
			'Active @lls-task workflow is available for the current workspace.',
			'',
			`Workflow label: ${label}`,
			`Progress: ${progress.completed}/${progress.total}`,
			...(this.planningDocumentPath ? [`Planning document path: ${this.planningDocumentPath}`] : []),
			'',
			'Workflow JSON:',
			JSON.stringify(this.workflow, null, 2),
			'',
			'Workflow usage rules:',
			'1. Use this workflow as execution guidance when the user request is related to the current work.',
			'2. You may NOT modify task titles, descriptions, order, summary, or content.',
			'3. You may only update task status by calling update_lls_task_workflow.',
			'4. Call update_lls_task_workflow when actual progress changes: set a task to in_progress when starting it, completed only after it is done and verified, blocked when progress cannot continue.',
			'5. Do not call update_lls_task_workflow unless the status actually changed.',
			'6. Call update_lls_task_workflow in a separate tool-call round; do not mix it with file editing, terminal, or other ordinary tools in the same assistant message.',
		].join('\n');
	}

	updateTaskStatuses(updates: LlsTaskWorkflowStatusUpdate[]): {
		ok: boolean;
		workflow?: LlsTaskWorkflow;
		updatedAt?: number;
		progress?: ReturnType<LlsTaskService['getProgress']>;
		error?: { code: string; message: string; retryable: boolean };
	} {
		if (!this.workflow) {
			return { ok: false, error: { code: 'NO_WORKFLOW', message: 'No @lls-task workflow is currently available.', retryable: false } };
		}
		if (!Array.isArray(updates) || updates.length === 0) {
			return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'updates must be a non-empty array.', retryable: false } };
		}

		const validStatuses: LlsTaskWorkflowStatus[] = ['pending', 'in_progress', 'completed', 'blocked'];
		const taskById = new Map(this.workflow.tasks.map(task => [task.id, task]));
		for (const update of updates) {
			const taskId = String(update?.taskId || '').trim();
			if (!taskId) {
				return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'taskId is required.', retryable: false } };
			}
			if (!validStatuses.includes(update.status)) {
				return { ok: false, error: { code: 'INVALID_STATUS', message: `Invalid task status: ${String(update.status)}`, retryable: false } };
			}
			if (!taskById.has(taskId)) {
				return { ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task id not found: ${taskId}`, retryable: false } };
			}
		}

		for (const update of updates) {
			const task = taskById.get(String(update.taskId).trim());
			if (task) {
				task.status = update.status;
			}
		}

		this.updatedAt = Date.now();
		this.didChangeEmitter.fire(this.getSnapshot());
		if (this.isWorkflowCompleted()) {
			this.clearAutoContinueTimer();
		}
		return {
			ok: true,
			workflow: this.workflow,
			updatedAt: this.updatedAt,
			progress: this.getProgress(),
		};
	}

	async handleChatRequest(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): Promise<void> {
		const language = this.configManager.getResolvedLanguage();
		const text = MESSAGES[language] || MESSAGES.en;
		const document = await this.extractPlanningDocument(request);
		if (!document) {
			stream.markdown(text.missingDocument);
			return;
		}

		const taskConfig = this.configManager.getLlsTaskConfig();
		if (!taskConfig.providerId?.trim() || !taskConfig.modelId?.trim()) {
			stream.markdown(text.missingModel);
			return;
		}

		stream.markdown(text.analyzing);
		try {
			const workflow = await this.generateWorkflow(document, taskConfig.providerId, taskConfig.modelId, language);
			this.workflow = workflow;
			this.planningDocumentPath = document.fileName;
			this.updatedAt = Date.now();
			this.didChangeEmitter.fire(this.getSnapshot());
			stream.markdown(`\n\n${text.completed}`);
			await this.sendContinuePromptToChat(language);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			stream.markdown(`\n\n${text.failed}\n\n${message}`);
		}
	}

	async showProgress(): Promise<void> {
		const language = this.configManager.getResolvedLanguage();
		const workflow = this.workflow;
		if (!workflow) {
			await vscode.commands.executeCommand('openapicopilot.openGlobalSettingsTab');
			return;
		}

		const completed = workflow.tasks.filter(task => task.status === 'completed').length;
		const total = workflow.tasks.length;
		const selected = await vscode.window.showQuickPick(
			workflow.tasks.map((task, index) => ({
				label: `${this.statusIcon(task.status)} ${index + 1}. ${task.title}`,
				description: task.status,
				detail: task.description,
			})),
			{
				title: workflow.title,
				placeHolder: `${LLS_TASK_STATUS_TEXT[language] || LLS_TASK_STATUS_TEXT.en}: ${completed}/${total}`,
			}
		);
		void selected;
	}

	private async extractPlanningDocument(request: vscode.ChatRequest): Promise<{ fileName: string; content: string } | undefined> {
		const references = (request.references || []) as ChatReferenceLike[];
		for (const reference of references) {
			const uri = this.tryGetUri(reference.value) || this.tryGetUri(reference);
			if (!uri || uri.scheme !== 'file') {
				continue;
			}
			if (!this.isSupportedDocument(uri)) {
				continue;
			}
			const bytes = await vscode.workspace.fs.readFile(uri);
			return {
				fileName: vscode.workspace.asRelativePath(uri, false),
				content: Buffer.from(bytes).toString('utf8'),
			};
		}
		return undefined;
	}

	private tryGetUri(value: unknown): vscode.Uri | undefined {
		if (value instanceof vscode.Uri) {
			return value;
		}
		if (value && typeof value === 'object') {
			const candidate = value as { uri?: unknown };
			if (candidate.uri instanceof vscode.Uri) {
				return candidate.uri;
			}
		}
		return undefined;
	}

	private isSupportedDocument(uri: vscode.Uri): boolean {
		const path = uri.path.toLowerCase();
		return Array.from(DOCUMENT_EXTENSIONS).some(ext => path.endsWith(ext));
	}

	private async generateWorkflow(document: { fileName: string; content: string }, providerId: string, modelId: string, language: ResolvedAppLanguage): Promise<LlsTaskWorkflow> {
		const providers = await this.configManager.getProvidersWithSecrets();
		const provider = providers.find(item => item.id === providerId);
		const model = provider?.models.find(item => item.modelId === modelId);
		if (!provider || !model) {
			throw new Error((MESSAGES[language] || MESSAGES.en).providerNotFound);
		}

		const apiKey = provider.apiKey?.trim() || '';
		if (provider.apiType === 'anthropic' && !apiKey) {
			throw new Error((MESSAGES[language] || MESSAGES.en).providerNotFound);
		}

		const requestBody = {
			model: model.modelId,
			messages: [
				{ role: 'system', content: this.buildSystemPrompt(language) },
				{ role: 'user', content: `File: ${document.fileName}\n\n${document.content}` },
			],
			stream: false,
			temperature: model.temperature,
			top_p: model.topP,
			max_tokens: Math.min(model.maxTokens || 4096, 8192),
		};

		const response = await this.requestModel(provider.baseUrl, provider.apiType, apiKey, requestBody);
		return this.parseWorkflowResponse(response, provider.apiType);
	}

	private buildSystemPrompt(language: ResolvedAppLanguage): string {
		const outputLanguage = LLS_TASK_STATUS_TEXT[language] || LLS_TASK_STATUS_TEXT.en;
		return `You are the @lls-task workflow planner.
Analyze the provided solution planning document and convert it into a task workflow configuration.

Output language for titles and descriptions: ${outputLanguage}.

You MUST output only a valid JSON object. Do not output Markdown or explanations.
The JSON schema is:
{
  "title": "workflow title",
  "summary": "short summary",
  "tasks": [
    {
      "id": "1",
      "title": "task title",
      "description": "task description",
      "status": "pending"
    }
  ]
}

Rules:
- If the document is not a solution/planning document, still extract a practical workflow from its actionable content.
- tasks must be a non-empty array.
- status must be one of: pending, in_progress, completed.
- Use pending for new tasks unless the document explicitly marks progress.`;
	}

	private async requestModel(baseUrl: string, apiType: string, apiKey: string, requestBody: any): Promise<any> {
		const isAnthropic = apiType === 'anthropic';
		const isV1Response = apiType === 'v1-response';
		const normalizedBase = baseUrl.replace(/\/+$/, '');
		const endpoint = isAnthropic ? '/messages' : isV1Response ? '/responses' : '/chat/completions';
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (isAnthropic) {
			headers['x-api-key'] = apiKey;
			headers['anthropic-version'] = '2023-06-01';
		} else if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}
		const finalBody = isAnthropic
			? convertOpenAIRequestToAnthropic(requestBody)
			: isV1Response
				? convertChatCompletionsToResponsesAPI(requestBody)
				: requestBody;
		const response = await fetch(`${normalizedBase}${endpoint}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(finalBody),
		});
		if (!response.ok) {
			throw new Error(await response.text());
		}
		return response.json();
	}

	private parseWorkflowResponse(response: any, apiType: string): LlsTaskWorkflow {
		const rawText = this.extractResponseText(response, apiType);
		const jsonMatch = rawText.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error('Model did not return a JSON object.');
		}
		const parsed = JSON.parse(jsonMatch[0]);
		const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
		const normalizedTasks: LlsTaskWorkflowItem[] = tasks
			.map((task: any, index: number) => ({
				id: String(task?.id || index + 1),
				title: String(task?.title || `Task ${index + 1}`),
				description: typeof task?.description === 'string' ? task.description : undefined,
				status: this.normalizeStatus(task?.status),
			}))
			.filter((task: LlsTaskWorkflowItem) => !!task.title.trim());

		if (normalizedTasks.length === 0) {
			throw new Error('Model returned an empty task list.');
		}

		return {
			title: String(parsed.title || 'LLS Task Workflow'),
			summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
			tasks: normalizedTasks,
		};
	}

	private extractResponseText(response: any, apiType: string): string {
		if (apiType === 'anthropic') {
			return (response.content || [])
				.map((part: any) => part?.type === 'text' ? part.text : '')
				.join('');
		}
		if (apiType === 'v1-response') {
			if (typeof response.output_text === 'string') {
				return response.output_text;
			}
			return (response.output || [])
				.flatMap((item: any) => item?.content || [])
				.map((part: any) => part?.text || part?.value || '')
				.join('');
		}
		return response.choices?.[0]?.message?.content || '';
	}

	private normalizeStatus(status: unknown): LlsTaskWorkflowItem['status'] {
		return status === 'in_progress' || status === 'completed' || status === 'blocked' ? status : 'pending';
	}

	private statusIcon(status: LlsTaskWorkflowItem['status']): string {
		if (status === 'completed') {
			return '$(check)';
		}
		if (status === 'in_progress') {
			return '$(sync~spin)';
		}
		if (status === 'blocked') {
			return '$(warning)';
		}
		return '$(circle-outline)';
	}

	private async tryAutoContinue(options: LlsTaskAutoContinueOptions): Promise<void> {
		if (!this.workflow || this.isWorkflowCompleted()) {
			return;
		}
		if (options.isMainModelRunning()) {
			this.scheduleAutoContinue(options);
			return;
		}
		if (this.autoContinueInProgress) {
			return;
		}

		this.autoContinueInProgress = true;
		try {
			await this.sendContinuePromptToChat(this.configManager.getResolvedLanguage());
		} catch (error) {
			console.error('[LLS Task] Failed to auto-continue workflow:', error);
		} finally {
			this.autoContinueInProgress = false;
		}
	}

	private async sendContinuePromptToChat(language: ResolvedAppLanguage): Promise<void> {
		await insertIntoChatInput(this.buildAutoContinuePrompt(language), true);
	}

	private buildAutoContinuePrompt(language: ResolvedAppLanguage): string {
		const text: Record<ResolvedAppLanguage, string> = {
			'en': 'The current @lls-task workflow is not completed yet. Continue executing the remaining tasks based on the injected workflow context, and call update_lls_task_workflow whenever task status changes.',
			'zh-cn': '当前 @lls-task 任务流尚未完成。请继续根据已注入的任务流上下文执行剩余任务，并在任务状态变化时调用 update_lls_task_workflow 更新进度。',
			'zh-tw': '目前 @lls-task 任務流程尚未完成。請繼續根據已注入的任務流程上下文執行剩餘任務，並在任務狀態變化時呼叫 update_lls_task_workflow 更新進度。',
			ko: '현재 @lls-task 작업 흐름이 아직 완료되지 않았습니다. 주입된 작업 흐름 컨텍스트를 기반으로 남은 작업을 계속 실행하고, 작업 상태가 변경될 때 update_lls_task_workflow를 호출해 진행 상황을 업데이트하세요.',
			ja: '現在の @lls-task タスクフローはまだ完了していません。注入済みのタスクフローコンテキストに基づいて残りのタスクを続行し、タスク状態が変わったら update_lls_task_workflow を呼び出して進捗を更新してください。',
			fr: 'Le flux de tâches @lls-task actuel n’est pas encore terminé. Continuez à exécuter les tâches restantes à partir du contexte de flux injecté et appelez update_lls_task_workflow lorsque l’état d’une tâche change.',
			de: 'Der aktuelle @lls-task-Aufgabenfluss ist noch nicht abgeschlossen. Führen Sie die verbleibenden Aufgaben anhand des eingefügten Workflow-Kontexts weiter aus und rufen Sie update_lls_task_workflow auf, wenn sich ein Aufgabenstatus ändert.',
		};
		const pathLabel: Record<ResolvedAppLanguage, string> = {
			'en': 'Planning document path',
			'zh-cn': '方案文件路径',
			'zh-tw': '方案文件路徑',
			ko: '계획 문서 경로',
			ja: '計画ドキュメントのパス',
			fr: 'Chemin du document de planification',
			de: 'Pfad des Planungsdokuments',
		};
		const suffix = this.planningDocumentPath ? `\n\n${pathLabel[language] || pathLabel.en}: ${this.planningDocumentPath}` : '';
		return `${text[language] || text.en}${suffix}`;
	}
}

const LLS_TASK_STATUS_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'LLS Task',
	'zh-cn': '任务流',
	'zh-tw': '任務流程',
	ko: '작업 흐름',
	ja: 'タスクフロー',
	fr: 'Flux de tâches',
	de: 'Aufgabenfluss',
};
