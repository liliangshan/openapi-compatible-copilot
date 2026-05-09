import * as vscode from 'vscode';
import { ConfigManager, ResolvedAppLanguage } from './configManager';
import { convertOpenAIRequestToAnthropic } from './utils/anthropicConverter';
import { convertChatCompletionsToResponsesAPI } from './utils/v1ResponseConverter';

const PROMPT_ENHANCEMENT_STATUS_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'Prompt Enhancement',
	'zh-cn': '提示词优化',
	'zh-tw': '提示詞最佳化',
	ko: '프롬프트 향상',
	ja: 'プロンプト強化',
	fr: 'Amélioration des prompts',
	de: 'Prompt-Verbesserung',
};

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

export const OPTIMIZED_PROMPT_PREFIX: Record<ResolvedAppLanguage, string> = {
	'en': '[Optimized Prompt]',
	'zh-cn': '[已优化提示词]',
	'zh-tw': '[已最佳化提示詞]',
	ko: '[최적화된 프롬프트]',
	ja: '[最適化済みプロンプト]',
	fr: '[Prompt optimisé]',
	de: '[Optimierter Prompt]',
};

export function initPromptEnhancementStatusBar(context: vscode.ExtensionContext, configManager: ConfigManager): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
	item.name = 'Prompt Enhancement';
	item.command = 'openapicopilot.promptEnhancement.openInput';

	const refresh = () => {
		const language = configManager.getResolvedLanguage();
		const settings = configManager.getPromptEnhancementConfig();
		item.text = PROMPT_ENHANCEMENT_STATUS_TEXT[language];
		item.tooltip = PROMPT_ENHANCEMENT_STATUS_TOOLTIP[language];
		if (settings.enabled) {
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
			let optimizedPrompt = prompt;
			try {
				optimizedPrompt = await optimizePrompt(configManager, prompt, language);
			} catch (error) {
				console.error('Prompt enhancement failed:', error);
				void vscode.window.showWarningMessage(text.failed);
			} finally {
				void panel.webview.postMessage({ command: 'idle' });
			}

			await insertIntoChatInput(`${OPTIMIZED_PROMPT_PREFIX[language]}\n${optimizedPrompt}`, autoSend);
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

export async function optimizePrompt(
	configManager: ConfigManager,
	rawPrompt: string,
	language: ResolvedAppLanguage,
	overrideModel?: { providerId?: string; modelId?: string }
): Promise<string> {
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

	const requestBody = {
		model: model.modelId,
		messages: [
			{ role: 'system', content: buildPromptEnhancementSystemPrompt(language) },
			{ role: 'user', content: rawPrompt },
		],
		stream: false,
		temperature: model.temperature,
		top_p: model.topP,
		max_tokens: Math.min(model.maxTokens || 4096, 4096),
	};

	const responseJson = await requestPromptEnhancementModel(provider.baseUrl, provider.apiType, apiKey, requestBody);
	const text = extractPromptEnhancementText(responseJson, provider.apiType).trim();
	return text || rawPrompt;
}

function buildPromptEnhancementSystemPrompt(language: ResolvedAppLanguage): string {
	const outputLanguage = PROMPT_ENHANCEMENT_STATUS_TEXT[language];
	return `You are an expert prompt optimization specialist.
Your task is to optimize the user's prompt so that it becomes clearer, more complete, more specific, and easier for another AI model to execute accurately.

Optimization requirements:
1. Preserve the user's original intent and do not change the goal.
2. Improve the prompt structure, wording, constraints, context, and expected output format.
3. Add reasonable missing details only when they help the model understand the task better.
4. Do not answer or solve the user's prompt yourself.
5. Do not explain your changes.
6. Output only the optimized prompt text.
7. Write the optimized prompt in the same language as the user's original prompt. If the language is unclear, use ${outputLanguage}.`;
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

function extractPromptEnhancementText(response: any, apiType: string): string {
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
