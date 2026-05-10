import * as vscode from 'vscode';
import { ConfigManager, ResolvedAppLanguage } from './configManager';
import { convertOpenAIRequestToAnthropic } from './utils/anthropicConverter';
import { convertChatCompletionsToResponsesAPI } from './utils/v1ResponseConverter';
import { buildPromptEnhancementContextInput, readPromptEnhancementContextCache } from './promptContextCache';
import { OPTIMIZED_PROMPT_PREFIX } from './promptEnhancementMessages';

const PROMPT_ENHANCEMENT_STATUS_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'Prompt Enhancement',
	'zh-cn': '提示词优化',
	'zh-tw': '提示詞最佳化',
	ko: '프롬프트 향상',
	ja: 'プロンプト強化',
	fr: 'Amélioration des prompts',
	de: 'Prompt-Verbesserung',
};

/**
 * Result from prompt enhancement model.
 * status: true if optimization is needed and performed, false if prompt is already good.
 * prompt: the optimized prompt text (only meaningful when status is true).
 */
export interface PromptEnhancementResult {
	status: boolean;
	prompt: string;
}

const PROMPT_ENHANCEMENT_STATUS_TOOLTIP: Record<ResolvedAppLanguage, string> = {
	'en': 'Automatically optimize prompts with a model before requests',
	'zh-cn': '在请求之前使用模型对提示词进行自动优化',
	'zh-tw': '在請求之前使用模型對提示詞進行自動最佳化',
	ko: '요청 전에 모델을 사용하여 프롬프트를 자동으로 최적화합니다',
	ja: 'リクエスト前にモデルを使用してプロンプトを自動的に最適化します',
	fr: 'Optimise automatiquement les prompts avec un modèle avant les requêtes',
	de: 'Optimiert Prompts vor Anfragen automatisch mit einem Modell',
};

const PROMPT_ENHANCEMENT_DIALOG_TEXT: Record<ResolvedAppLanguage, {
	title: string;
	description: string;
	placeholder: string;
	submit: string;
	cancel: string;
	empty: string;
	missingModel: string;
	optimizing: string;
	failed: string;
	success: string;
	autoSend: string;
}> = {
	'en': {
		title: 'Prompt Enhancement',
		description: 'Enter the prompt to optimize before sending the request.',
		placeholder: 'Enter your prompt here...',
		submit: 'Submit',
		cancel: 'Cancel',
		empty: 'Please enter a prompt to optimize.',
		missingModel: 'Please select a prompt enhancement provider and model first.',
		optimizing: 'Optimizing prompt...',
		failed: 'Failed to optimize prompt. The original prompt will be inserted.',
		success: 'Optimized prompt has been inserted into the chat input. Please click Send in the chat window at the bottom right.',
		autoSend: 'Auto send',
	},
	'zh-cn': {
		title: '提示词优化',
		description: '请输入需要在请求之前优化的提示词。',
		placeholder: '在这里输入提示词...',
		submit: '提交',
		cancel: '取消',
		empty: '请输入需要优化的提示词。',
		missingModel: '请先选择提示词优化提供商和模型。',
		optimizing: '正在优化提示词...',
		failed: '提示词优化失败，将插入原始提示词。',
		success: '优化后的提示词已插入聊天输入框，请在右下角聊天窗口点击发送。',
		autoSend: '自动发送',
	},
	'zh-tw': {
		title: '提示詞最佳化',
		description: '請輸入需要在請求之前最佳化的提示詞。',
		placeholder: '在這裡輸入提示詞...',
		submit: '提交',
		cancel: '取消',
		empty: '請輸入需要最佳化的提示詞。',
		missingModel: '請先選擇提示詞最佳化提供商和模型。',
		optimizing: '正在最佳化提示詞...',
		failed: '提示詞最佳化失敗，將插入原始提示詞。',
		success: '最佳化後的提示詞已插入聊天輸入框，請在右下角聊天視窗點擊送出。',
		autoSend: '自動送出',
	},
	ko: {
		title: '프롬프트 향상',
		description: '요청 전에 최적화할 프롬프트를 입력하세요.',
		placeholder: '여기에 프롬프트를 입력하세요...',
		submit: '제출',
		cancel: '취소',
		empty: '최적화할 프롬프트를 입력하세요.',
		missingModel: '먼저 프롬프트 향상 공급자와 모델을 선택하세요.',
		optimizing: '프롬프트 최적화 중...',
		failed: '프롬프트 최적화에 실패했습니다. 원본 프롬프트를 삽입합니다.',
		success: '최적화된 프롬프트가 채팅 입력창에 삽입되었습니다. 오른쪽 아래 채팅 창에서 보내기를 클릭하세요.',
		autoSend: '자동 전송',
	},
	ja: {
		title: 'プロンプト強化',
		description: 'リクエスト前に最適化するプロンプトを入力してください。',
		placeholder: 'ここにプロンプトを入力...',
		submit: '送信',
		cancel: 'キャンセル',
		empty: '最適化するプロンプトを入力してください。',
		missingModel: '先にプロンプト強化プロバイダーとモデルを選択してください。',
		optimizing: 'プロンプトを最適化中...',
		failed: 'プロンプトの最適化に失敗しました。元のプロンプトを挿入します。',
		success: '最適化済みプロンプトをチャット入力欄に挿入しました。右下のチャットウィンドウで送信をクリックしてください。',
		autoSend: '自動送信',
	},
	fr: {
		title: 'Amélioration des prompts',
		description: 'Saisissez le prompt à optimiser avant la requête.',
		placeholder: 'Saisissez votre prompt ici...',
		submit: 'Envoyer',
		cancel: 'Annuler',
		empty: 'Veuillez saisir un prompt à optimiser.',
		missingModel: 'Veuillez d’abord sélectionner un fournisseur et un modèle d’amélioration des prompts.',
		optimizing: 'Optimisation du prompt...',
		failed: 'Échec de l’optimisation du prompt. Le prompt original sera inséré.',
		success: 'Le prompt optimisé a été inséré dans la zone de chat. Cliquez sur Envoyer dans la fenêtre de chat en bas à droite.',
		autoSend: 'Envoi automatique',
	},
	de: {
		title: 'Prompt-Verbesserung',
		description: 'Geben Sie den Prompt ein, der vor der Anfrage optimiert werden soll.',
		placeholder: 'Prompt hier eingeben...',
		submit: 'Senden',
		cancel: 'Abbrechen',
		empty: 'Bitte geben Sie einen zu optimierenden Prompt ein.',
		missingModel: 'Bitte wählen Sie zuerst einen Prompt-Verbesserungsanbieter und ein Modell aus.',
		optimizing: 'Prompt wird optimiert...',
		failed: 'Prompt-Optimierung fehlgeschlagen. Der ursprüngliche Prompt wird eingefügt.',
		success: 'Der optimierte Prompt wurde in das Chat-Eingabefeld eingefügt. Klicken Sie im Chatfenster unten rechts auf Senden.',
		autoSend: 'Automatisch senden',
	},
};

export function initPromptEnhancementStatusBar(context: vscode.ExtensionContext, configManager: ConfigManager): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
	item.name = 'Prompt Enhancement';
	item.command = 'openapicopilot.promptEnhancement.openInput';

	const refresh = () => {
		const language = configManager.getResolvedLanguage();
		const settings = configManager.getEffectivePromptEnhancementConfig();
		item.text = PROMPT_ENHANCEMENT_STATUS_TEXT[language];
		item.tooltip = PROMPT_ENHANCEMENT_STATUS_TOOLTIP[language];

		// Show status bar if a prompt enhancement model is selected (providerId and modelId are both set)
		// Note: 'enabled' only controls auto prompt enhancement, not the status bar visibility
		const hasSelectedModel = !!settings.providerId?.trim() && !!settings.modelId?.trim();

		if (hasSelectedModel) {
			item.show();
		} else {
			item.hide();
		}
	};

	context.subscriptions.push(
		item,
		vscode.commands.registerCommand('openapicopilot.promptEnhancement.openInput', async () => {
			await openPromptEnhancementInputDialog(context, configManager);
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (
				event.affectsConfiguration('openapicopilot.language') ||
				event.affectsConfiguration('openapicopilot.promptEnhancement')
			) {
				refresh();
			}
		})
	);

	refresh();
	return item;
}

async function openPromptEnhancementInputDialog(context: vscode.ExtensionContext, configManager: ConfigManager): Promise<void> {
	const language = configManager.getResolvedLanguage();
	const text = PROMPT_ENHANCEMENT_DIALOG_TEXT[language];
	const panel = vscode.window.createWebviewPanel(
		'openapicopilot.promptEnhancementInput',
		text.title,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: false,
		}
	);

	panel.webview.html = getPromptEnhancementInputHtml(panel.webview, context.extensionUri, text);

	panel.webview.onDidReceiveMessage(async message => {
		if (message?.command === 'cancel') {
			panel.dispose();
			return;
		}

		if (message?.command === 'submit') {
			const prompt = String(message.prompt || '').trim();
			const autoSend = !!message.autoSend;
			if (!prompt) {
				void panel.webview.postMessage({ command: 'error', message: text.empty });
				void panel.webview.postMessage({ command: 'idle' });
				return;
			}
			const config = configManager.getEffectivePromptEnhancementConfig();
			if (!config.providerId || !config.modelId) {
				void panel.webview.postMessage({ command: 'error', message: text.missingModel });
				void panel.webview.postMessage({ command: 'idle' });
				return;
			}

			void panel.webview.postMessage({ command: 'busy', message: text.optimizing });
			const language = configManager.getResolvedLanguage();
			let finalPrompt = prompt;
			try {
				const result = await optimizePrompt(configManager, prompt, language);
				finalPrompt = result.prompt;
			} catch (error) {
				console.error('Prompt enhancement failed:', error);
				void vscode.window.showWarningMessage(text.failed);
			} finally {
				void panel.webview.postMessage({ command: 'idle' });
			}

			await insertIntoChatInput(`${OPTIMIZED_PROMPT_PREFIX[language]}\n${finalPrompt}`, autoSend);
			void panel.webview.postMessage({ command: 'success', message: text.success });
		}
	}, undefined, context.subscriptions);
}

export async function insertIntoChatInput(prompt: string, autoSend: boolean): Promise<void> {
	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: prompt,
			isPartialQuery: !autoSend,
		});
	} catch {
		await vscode.env.clipboard.writeText(prompt);
	}
}

const MIN_PROMPT_ENHANCEMENT_GRAPHEMES = 3;

function countGraphemes(text: string): number {
	// Intl.Segmenter is available in Node.js 16+ and modern browsers
	// TypeScript doesn't have built-in types for it, so we use any cast
	const intl = Intl as any;
	if (intl && typeof intl.Segmenter === 'function') {
		const segmenter = new intl.Segmenter(undefined, { granularity: 'grapheme' });
		return Array.from(segmenter.segment(text)).length;
	}
	return Array.from(text).length;
}

function shouldSkipPromptEnhancement(rawPrompt: string): boolean {
	const trimmed = rawPrompt.trim();
	if (!trimmed) return true;
	return countGraphemes(trimmed) < MIN_PROMPT_ENHANCEMENT_GRAPHEMES;
}

export async function optimizePrompt(
	configManager: ConfigManager,
	rawPrompt: string,
	language: ResolvedAppLanguage,
	overrideModel?: { providerId?: string; modelId?: string },
	options?: { sessionId?: string; includeContext?: boolean }
): Promise<PromptEnhancementResult> {
	if (shouldSkipPromptEnhancement(rawPrompt)) {
		return { status: false, prompt: rawPrompt };
	}
	const effectiveConfig = configManager.getEffectivePromptEnhancementConfig();
	const config = {
		...effectiveConfig,
		providerId: overrideModel?.providerId || effectiveConfig.providerId,
		modelId: overrideModel?.modelId || effectiveConfig.modelId,
	};
	const providers = await configManager.getProvidersWithSecrets();
	const provider = providers.find(item => item.id === config.providerId);
	const model = provider?.models.find(item => item.modelId === config.modelId);
	if (!provider || !model) {
		throw new Error('Prompt enhancement provider or model not found.');
	}
	const apiKey = provider.apiKey?.trim() || '';
	if (provider.apiType === 'anthropic' && !apiKey) {
		throw new Error('Prompt enhancement provider requires an API key.');
	}

	const cachedMessages = options?.includeContext === false
		? []
		: await readPromptEnhancementContextCache(options?.sessionId);
	const promptInput = cachedMessages.length > 0
		? buildPromptEnhancementContextInput(rawPrompt, cachedMessages)
		: rawPrompt;

	const requestBody = {
		model: model.modelId,
		messages: [
			{ role: 'system', content: buildPromptEnhancementSystemPrompt(language) },
			{ role: 'user', content: promptInput },
		],
		stream: false,
		temperature: model.temperature,
		top_p: model.topP,
		max_tokens: Math.min(model.maxTokens || 4096, 4096),
	};

	const responseJson = await requestPromptEnhancementModel(provider.baseUrl, provider.apiType, apiKey, requestBody);
	const result = parsePromptEnhancementResult(responseJson, provider.apiType);
	if (!result.status) {
		// No optimization needed, return original prompt with status=false
		return { status: false, prompt: rawPrompt };
	}
	return {
		status: true,
		prompt: result.prompt.trim() || rawPrompt,
	};
}

function buildPromptEnhancementSystemPrompt(language: ResolvedAppLanguage): string {
	const outputLanguage = PROMPT_ENHANCEMENT_STATUS_TEXT[language];
	return `You are an expert prompt optimization specialist with the ability to determine if a user's input needs prompt optimization.

Your task is to analyze the user's input and decide whether optimization is necessary.

Output format: You MUST output a valid JSON object with the following structure:
{
  "status": true or false,
  "prompt": "the optimized prompt text (only needed when status is true)"
}

Do not output any explanations, comments, Markdown, or extra text outside the JSON object.

Decision criteria for status:

Default behavior: optimize normal user requests.

In a coding assistant workflow, many valid prompts are action-oriented, such as implementing features, fixing bugs, explaining errors, updating configuration, writing tests, refactoring code, or designing a solution. These are NOT operational commands merely because they contain verbs like create, update, build, run, install, configure, add, remove, or delete.

Set "status" to true for ordinary questions, explanations, coding tasks, debugging requests, design requests, refactoring requests, documentation requests, testing requests, and analysis requests when rewriting can make the prompt clearer, more structured, more contextual, or more actionable.

Set "status" to false only when the user's input does NOT need prompt optimization.

This includes, but is not limited to, the following cases:

1. The input is already clear and specific about what it asks.
2. The input contains sufficient context and constraints for the task.
3. The input has a well-defined expected output format.
4. The input does not contradict itself or contain logical errors.
5. The input is appropriately concise for the task complexity.
6. The input is understandable and workable, even if it is not perfectly written.
7. The input is a direct operational command that should be executed exactly as written.
8. The input is a very short continuation or confirmation such as "continue", "yes", "ok", "1", "继续", "是", or "确认".
9. The input is context compression related content, such as system-generated context summaries, compressed historical messages, conversation context blocks, or auto-generated summary text. These are internal system content and should NOT be optimized.

IMPORTANT: CRITICAL - Operational Commands MUST NOT Be Optimized

Only direct execution commands MUST NOT be optimized. A direct execution command is a command or instruction whose main purpose is to make the assistant run an operation exactly as requested, rather than improve or reason about a development task.

The following types of inputs are direct operational commands and MUST NOT be optimized. For these inputs, ALWAYS set "status" to false:

**A. Shell Commands (English)**:
- git commands: git commit -m "fix: bug", git push origin main, git pull, git checkout main, git status, git merge, git rebase, git stash, git fetch, git clone, git branch, git diff, git log, git show
- docker commands: docker ps, docker build ., docker compose up, docker run, docker stop, docker rm, docker images, docker exec
- npm/yarn/pnpm commands: npm install, npm run build, npm start, npm test, npm dev, yarn add, yarn build, pnpm install, pnpm dev
- file system commands: ls -la, cd src, mkdir test, rm -rf dist, cp a.txt b.txt, mv old new, cat file.txt, grep "text" file.txt, chmod +x script.sh
- network commands: curl https://example.com, wget https://example.com/file.zip, ssh user@host, scp file user@host:/path
- system commands: ps aux, kill -9 1234, export NODE_ENV=production, sudo apt install nginx

**B. Intent-Based Operational Commands (Any Language)**:
These are natural language descriptions of immediate operations that should be executed directly, not prompts to improve:

English patterns:
- "commit this to the repository"
- "push to remote"
- "create a PR"
- "submit my changes"
- "deploy this"
- "run the build"
- "execute the script"
- "check git status"
- "make a pull request"
- "open a merge request"
- "install dependencies"
- "restart the service"
- "delete this branch"

Chinese patterns:
- "commit to repository" or "commit to remote repository" or "commit code"
- "push to remote" or "push to repository" or "push to main branch"
- "create PR" or "create pull request" or "initiate PR"
- "create branch" or "switch branch" or "delete branch"
- "deploy code" or "release version"
- "run script" or "execute command"
- "check status" or "view logs"
- "stop service" or "restart service"
- "commit changes" or "submit changes"
- "pull code" or "pull updates"
- "merge branch" or "merge code"
- "publish version" or "publish to npm"
- "build project" or "compile code"
- "install dependencies" or "update dependencies"
- "clean cache" or "clear build artifacts"
- "sync code" or "update code"
- "create release" or "initiate release"
- "commit to git" or "git commit"

Other language patterns:
- French: "soumettre au depot", "creer une pull request", "pousser vers le distant"
- German: "in das Repository einchecken", "einen PR erstellen", "zum Remote pushen"
- Japanese: "commit to repository", "create PR", "push to remote"
- Korean: "commit to repository", "PR create", "push to remote"
- Spanish: "commit to repository", "create a PR", "send to remote"
- Portuguese: "commit to repository", "create a PR", "send to remote"
- Russian: "commit to repository", "create PR", "send to remote"

**C. Command Keywords (Regardless of Language)**:
Command keywords are only signals. They do NOT automatically mean "status": false.

Treat the input as operational only when the whole input is asking to directly execute an operation, such as committing, pushing, deploying, running a shell command, installing dependencies, restarting a service, or deleting a branch.

Do NOT set "status" to false merely because the input contains words like git, docker, npm, build, run, script, create, setup, configure, config, settings, install, update, add, remove, or delete.

For example, these SHOULD be considered normal prompts and may be optimized:
- "explain why npm install failed"
- "help me write an npm package publish script"
- "build failed, help me analyze it"
- "create a login page"
- "update the configuration to support custom timeout"
- "add tests for this function"
- "remove the duplicate code"
- "configure the project to support linting"
- "help me design a deployment plan"

**D. General Patterns for Operational Intents**:
If the user's input is a direct operation to execute immediately and exactly, it is likely an operational command and should NOT be optimized.

If the user's input is a development task to be completed by reasoning, editing, explaining, designing, debugging, or implementing, it is a normal prompt and SHOULD be optimized when improvement would help.

Examples of operational intents:
- "help me commit" - operational
- "commit code to repository" - operational
- "push to github" - operational
- "create pull request" - operational
- "release version 1.0" - operational
- "run npm install" - operational
- "execute this shell command" - operational

Examples of prompts that SHOULD be optimized:
- "I want to understand how git works" - genuine question, optimize OK
- "explain the difference between docker and containers" - genuine question, optimize OK
- "help me write an npm package publish script" - task request, optimize OK
- "create a login page" - development task, optimize OK
- "fix this bug" - development task, optimize OK
- "update config to support timeout" - development task, optimize OK
- "build failed, help me diagnose it" - debugging task, optimize OK
- "refactor this function" - coding task, optimize OK

Set "status" to true only when the user's input is a PROMPT that genuinely needs improvement.

Set "status" to true when the prompt:
1. Is vague, ambiguous, or incomplete.
2. Lacks sufficient context or constraints.
3. Has an unclear or missing expected output format.
4. Contains contradictions or logical errors.
5. Could benefit significantly from better structure or organization.
6. Is overly verbose without improving clarity.
7. Asks a genuine question or requests an explanation.
8. Requests coding, debugging, analysis, design, documentation, testing, implementation, or refactoring work and would benefit from clearer constraints or expected output.

IMPORTANT RULES:
- If the input is a direct operational command to be executed exactly as written, ALWAYS set "status" to false.
- If the input is a normal development task, question, analysis request, debugging request, or coding request, do NOT reject optimization merely because it contains command-related keywords.
- Only set "status" to false for operational commands, very short confirmations, or prompts that are already sufficiently clear and complete.
- If the input is context compression related content, such as system-generated context summaries, compressed historical messages, conversation context blocks, or auto-generated summary text, ALWAYS set "status" to false. These are internal system content and should NOT be optimized.
- When "status" is false, you MUST still output the "prompt" field with the original input: {"status": false, "prompt": "the original input"}

When "status" is true:
1. Preserve the user's original intent and do not change the goal.
2. Improve the prompt's structure, wording, constraints, context, and expected output format.
3. Make the optimized prompt clear, actionable, and concise.
4. Do not add unnecessary requirements that were not implied by the original prompt.
5. Do not change the language of the original prompt unless doing so is necessary for clarity.`;
}

async function requestPromptEnhancementModel(baseUrl: string, apiType: string, apiKey: string, requestBody: any): Promise<any> {
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

function parsePromptEnhancementResult(response: any, apiType: string): PromptEnhancementResult {
	let rawText: string;
	if (apiType === 'anthropic') {
		rawText = (response.content || [])
			.map((part: any) => part?.type === 'text' ? part.text : '')
			.join('');
	} else if (apiType === 'v1-response') {
		if (typeof response.output_text === 'string') {
			rawText = response.output_text;
		} else {
			rawText = (response.output || [])
				.flatMap((item: any) => item?.content || [])
				.map((part: any) => part?.text || part?.value || '')
				.join('');
		}
	} else {
		rawText = response.choices?.[0]?.message?.content || '';
	}

	// Try to parse as JSON
	try {
		// Extract JSON object from the text (handle potential markdown code blocks)
		const jsonMatch = rawText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (typeof parsed.status === 'boolean' && (parsed.status === false || typeof parsed.prompt === 'string')) {
				return {
					status: parsed.status,
					prompt: parsed.prompt || '',
				};
			}
		}
	} catch {
		// Failed to parse JSON, fall through
	}

	// If JSON parsing fails, treat as no optimization needed (status=false)
	// This is safer than blocking the request with an empty/garbage prompt.
	return {
		status: false,
		prompt: '',
	};
}

function getPromptEnhancementInputHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	text: {
		title: string;
		description: string;
		placeholder: string;
		submit: string;
		cancel: string;
		missingModel?: string;
		optimizing?: string;
		failed?: string;
		success?: string;
		autoSend?: string;
	}
): string {
	const nonce = getNonce();
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(text.title)}</title>
	<style>
		body { padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
		.container { max-width: 920px; margin: 0 auto; }
		.card { padding: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editorWidget-background); box-shadow: 0 2px 10px rgba(0, 0, 0, .12); }
		h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
		.description { color: var(--vscode-descriptionForeground); margin-bottom: 16px; line-height: 1.5; }
		textarea { width: 100%; box-sizing: border-box; min-height: 260px; resize: vertical; padding: 12px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.55; outline: none; }
		textarea:focus { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
		.actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 16px; }
		.auto-send { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 8px; color: var(--vscode-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; user-select: none; }
		.auto-send input { margin: 0; }
		.message { min-height: 20px; margin-top: 10px; line-height: 1.45; }
		.error { color: var(--vscode-errorForeground); }
		.busy { color: var(--vscode-descriptionForeground); }
		.success { color: var(--vscode-terminal-ansiGreen); }
		button { min-width: 86px; padding: 7px 16px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; font-weight: 500; }
		button:disabled, input:disabled { opacity: .55; cursor: not-allowed; }
		button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
		button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
		button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
		button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
	</style>
</head>
<body>
	<div class="container">
		<div class="card">
			<h2>${escapeHtml(text.title)}</h2>
			<div class="description">${escapeHtml(text.description)}</div>
			<textarea id="prompt" placeholder="${escapeHtml(text.placeholder)}" autofocus></textarea>
			<div class="message error" id="error"></div>
			<div class="message busy" id="busy"></div>
			<div class="message success" id="success"></div>
			<div class="actions">
				<button class="secondary" id="cancel">${escapeHtml(text.cancel)}</button>
				<label class="auto-send"><input type="checkbox" id="autoSend" />${escapeHtml(text.autoSend || 'Auto send')}</label>
				<button class="primary" id="submit">${escapeHtml(text.submit)}</button>
			</div>
		</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const prompt = document.getElementById('prompt');
		const error = document.getElementById('error');
		const busy = document.getElementById('busy');
		const success = document.getElementById('success');
		const submit = document.getElementById('submit');
		const cancel = document.getElementById('cancel');
		const autoSend = document.getElementById('autoSend');
		cancel.addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
		submit.addEventListener('click', () => {
			error.textContent = '';
			busy.textContent = '';
			success.textContent = '';
			submit.disabled = true;
			cancel.disabled = true;
			autoSend.disabled = true;
			vscode.postMessage({ command: 'submit', prompt: prompt.value, autoSend: autoSend.checked });
		});
		window.addEventListener('message', event => {
			const message = event.data || {};
			if (message.command === 'error') {
				error.textContent = message.message || '';
				busy.textContent = '';
				success.textContent = '';
			}
			if (message.command === 'busy') {
				busy.textContent = message.message || '';
				error.textContent = '';
				success.textContent = '';
				submit.disabled = true;
				cancel.disabled = true;
				autoSend.disabled = true;
			}
			if (message.command === 'success') {
				success.textContent = message.message || '';
				error.textContent = '';
				busy.textContent = '';
			}
			if (message.command === 'idle') {
				submit.disabled = false;
				cancel.disabled = false;
				autoSend.disabled = false;
			}
		});
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
