import * as vscode from 'vscode';
import { ConfigManager, ResolvedAppLanguage } from '../configManager';
import { getRemoteNotificationConfig } from './config';

const SERVICE_URL_LANG: Record<ResolvedAppLanguage, string> = {
	en: 'en',
	'zh-cn': 'zh-cn',
	'zh-tw': 'zh-tw',
	ko: 'ko',
	ja: 'ja',
	fr: 'fr',
	de: 'de',
};

const TEXT: Record<ResolvedAppLanguage, Record<string, string>> = {
	en: {
		title: 'Remote Work Settings', save: 'Save', connect: 'Connect', enabled: 'Enable Remote Work', websocket: 'WebSocket', websocketEnabled: 'Enable WebSocket', websocketUrl: 'WebSocket URL', webhook: 'Webhook', webhookEnabled: 'Enable Webhook', webhookUrl: 'Webhook URL', webhookSecret: 'Webhook Secret', history: 'Chat History Request', allowHistoryRequest: 'Allow remote history requests', saved: 'Remote work settings saved.',
		usage: 'Usage', usageSelfHosted: 'Self-hosted deployment', usageSelfHostedDesc: 'Repository:', usageHosted: 'Use our service', usageHostedMainland: 'Mainland China:', usageHostedOverseas: 'Overseas:', usageHostedNotice: 'We do not store or back up any of your data.',
		webhookUsage: 'Webhook Usage Example', webhookUsageDesc: 'Example of sending a model event to your webhook endpoint:', webhookUrlExample: 'POST URL Example', webhookUrlExampleDesc: 'Append your token as a query parameter:', webhookHeader: 'Header Examples', webhookBody: 'Body Example', webhookBodyDesc: 'Webhook receives a JSON payload with the following structure:', webhookEncrypt: 'Signature Encryption', webhookEncryptDesc: 'HMAC-SHA256 signature for request verification:', webhookEventTypes: 'Event Types', webhookEventTypesDesc: 'Possible values for the Webhook-Event header:', webhookBodyExampleTitle: 'Example Body (model.text_delta)'
	},
	'zh-cn': {
		title: '远程办公设置', save: '保存', connect: '连接', enabled: '启用远程办公', websocket: '网络套接字', websocketEnabled: '启用网络套接字', websocketUrl: '网络套接字地址', webhook: '回调', webhookEnabled: '启用回调', webhookUrl: '回调地址', webhookSecret: '回调密钥', history: '聊天记录请求', allowHistoryRequest: '允许远端请求历史记录', saved: '远程办公设置已保存。',
		usage: '使用方式', usageSelfHosted: '私有化部署', usageSelfHostedDesc: '仓库地址：', usageHosted: '使用我们的服务', usageHostedMainland: '中国大陆：', usageHostedOverseas: '海外：', usageHostedNotice: '我们不存储和备份您的任何数据。',
		webhookUsage: 'Webhook 使用示例', webhookUsageDesc: '向您的 webhook 端点发送模型事件的示例：', webhookUrlExample: 'POST URL 示例', webhookUrlExampleDesc: '将 token 作为查询参数附加到 URL 中：', webhookHeader: 'Header 头示例', webhookBody: 'Body 体示例', webhookBodyDesc: 'Webhook 接收一个 JSON 负载，结构如下：', webhookEncrypt: '签名加密方式', webhookEncryptDesc: '使用 HMAC-SHA256 进行签名校验：', webhookEventTypes: '事件类型', webhookEventTypesDesc: 'Webhook-Event 头可能的值：', webhookBodyExampleTitle: 'Body 示例（model.text_delta）'
	},
	'zh-tw': {
		title: '遠端辦公設定', save: '儲存', connect: '連線', enabled: '啟用遠端辦公', websocket: '網路通訊端', websocketEnabled: '啟用網路通訊端', websocketUrl: '網路通訊端位址', webhook: '回呼', webhookEnabled: '啟用回呼', webhookUrl: '回呼位址', webhookSecret: '回呼密鑰', history: '聊天紀錄請求', allowHistoryRequest: '允許遠端請求歷史紀錄', saved: '遠端辦公設定已儲存。',
		usage: '使用方式', usageSelfHosted: '私有化部署', usageSelfHostedDesc: '倉庫位址：', usageHosted: '使用我們的服務', usageHostedMainland: '中國大陸：', usageHostedOverseas: '海外：', usageHostedNotice: '我們不儲存和備份您的任何資料。'
	},
	ko: {
		title: '원격 근무 설정', save: '저장', connect: '연결', enabled: '원격 근무 사용', websocket: '웹소켓', websocketEnabled: '웹소켓 사용', websocketUrl: '웹소켓 주소', webhook: 'Webhook', webhookEnabled: 'Webhook 사용', webhookUrl: 'Webhook 주소', webhookSecret: 'Webhook Secret', history: '채팅 기록 요청', allowHistoryRequest: '원격 기록 요청 허용', saved: '원격 근무 설정이 저장되었습니다.',
		usage: '사용 방법', usageSelfHosted: '자체 호스팅 배포', usageSelfHostedDesc: '저장소:', usageHosted: '당사 서비스 이용', usageHostedMainland: '중국 본토:', usageHostedOverseas: '해외:', usageHostedNotice: '당사는 귀하의 데이터를 저장하거나 백업하지 않습니다.'
	},
	ja: {
		title: 'リモートワーク設定', save: '保存', connect: '接続', enabled: 'リモートワークを有効化', websocket: 'WebSocket', websocketEnabled: 'WebSocket を有効化', websocketUrl: 'WebSocket URL', webhook: 'Webhook', webhookEnabled: 'Webhook を有効化', webhookUrl: 'Webhook URL', webhookSecret: 'Webhook Secret', history: 'チャット履歴リクエスト', allowHistoryRequest: 'リモート履歴リクエストを許可', saved: 'リモートワーク設定を保存しました。',
		usage: '使用方法', usageSelfHosted: 'セルフホスティング', usageSelfHostedDesc: 'リポジトリ:', usageHosted: '当社サービスの利用', usageHostedMainland: '中国本土:', usageHostedOverseas: '海外:', usageHostedNotice: '当社はお客様のデータを保存またはバックアップしません。'
	},
	fr: {
		title: 'Paramètres du travail à distance', save: 'Enregistrer', connect: 'Connecter', enabled: 'Activer le travail à distance', websocket: 'WebSocket', websocketEnabled: 'Activer WebSocket', websocketUrl: 'URL WebSocket', webhook: 'Webhook', webhookEnabled: 'Activer Webhook', webhookUrl: 'URL Webhook', webhookSecret: 'Secret Webhook', history: 'Demande d’historique de chat', allowHistoryRequest: 'Autoriser les demandes d’historique distantes', saved: 'Paramètres du travail à distance enregistrés.',
		usage: 'Utilisation', usageSelfHosted: 'Déploiement auto-hébergé', usageSelfHostedDesc: 'Dépôt :', usageHosted: 'Utiliser notre service', usageHostedMainland: 'Chine continentale :', usageHostedOverseas: 'International :', usageHostedNotice: 'Nous ne stockons ni ne sauvegardons aucune de vos données.'
	},
	de: {
		title: 'Remote-Arbeit-Einstellungen', save: 'Speichern', connect: 'Verbinden', enabled: 'Remote-Arbeit aktivieren', websocket: 'WebSocket', websocketEnabled: 'WebSocket aktivieren', websocketUrl: 'WebSocket-URL', webhook: 'Webhook', webhookEnabled: 'Webhook aktivieren', webhookUrl: 'Webhook-URL', webhookSecret: 'Webhook Secret', history: 'Chatverlaufsanfrage', allowHistoryRequest: 'Remote-Verlaufsanfragen erlauben', saved: 'Remote-Arbeit-Einstellungen gespeichert.',
		usage: 'Verwendung', usageSelfHosted: 'Selbst gehostete Bereitstellung', usageSelfHostedDesc: 'Repository:', usageHosted: 'Unseren Dienst verwenden', usageHostedMainland: 'Festlandchina:', usageHostedOverseas: 'International:', usageHostedNotice: 'Wir speichern und sichern keine Ihrer Daten.'
	},
};

export async function openRemoteNotificationSettingsPanel(configManager: ConfigManager): Promise<void> {
	const language = configManager.getResolvedLanguage();
	const text = TEXT[language] || TEXT.en;
	const panel = vscode.window.createWebviewPanel('openapicopilot.remoteNotificationSettings', text.title, vscode.ViewColumn.Active, {
		enableScripts: true,
		retainContextWhenHidden: false,
	});
	panel.webview.html = getHtml(text, getRemoteNotificationConfig(), language);
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.command !== 'save' && message?.command !== 'connect') {
			return;
		}
		const cfg = vscode.workspace.getConfiguration('openapicopilot.remoteNotification');
		const data = message.data || {};
		await cfg.update('enabled', !!data.enabled, vscode.ConfigurationTarget.Global);
		await cfg.update('websocketEnabled', !!data.websocketEnabled, vscode.ConfigurationTarget.Global);
		await cfg.update('websocketUrl', String(data.websocketUrl || ''), vscode.ConfigurationTarget.Global);
		if (message.command === 'save') {
			await cfg.update('webhookEnabled', !!data.webhookEnabled, vscode.ConfigurationTarget.Global);
		}
		await cfg.update('webhookUrl', String(data.webhookUrl || ''), vscode.ConfigurationTarget.Global);
		await cfg.update('webhookSecret', String(data.webhookSecret || ''), vscode.ConfigurationTarget.Global);
		await cfg.update('allowHistoryRequest', !!data.allowHistoryRequest, vscode.ConfigurationTarget.Global);
		if (message.command === 'connect') {
			await vscode.commands.executeCommand('openapicopilot.remoteNotification.reconnect');
			return;
		}
		void vscode.window.showInformationMessage(text.saved);
		panel.dispose();
	});
}

function getHtml(text: Record<string, string>, config: ReturnType<typeof getRemoteNotificationConfig>, language: ResolvedAppLanguage): string {
	const state = JSON.stringify(config).replace(/</g, '\\u003c');
	const langParam = encodeURIComponent(SERVICE_URL_LANG[language] || 'en');
	const selfHostedRepoUrl = 'https://github.com/liliangshan/llsoai-websocket';
	const selfHostedWebhookRepoUrl = 'https://github.com/liliangshan/llsoai-webhook.git';
	const hostedMainlandUrl = `https://oai.hlwidc.com/?lang=${langParam}`;
	const hostedOverseasUrl = `https://oai.zhineng.dev/?lang=${langParam}`;
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:760px}
h1{font-size:22px}
fieldset{border:1px solid var(--vscode-panel-border);margin:16px 0;padding:16px;border-radius:6px}
legend{padding:0 8px;font-weight:bold}
label{display:block;margin:10px 0}
input[type=text],input[type=password]{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:6px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:8px 14px;cursor:pointer;margin-right:8px}
.hint{opacity:.75;font-size:12px}
.row{display:flex;gap:8px;align-items:end}.row label{flex:1}
a{color:var(--vscode-textLink-foreground);text-decoration:none}
a:hover{text-decoration:underline}
.usage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:4px}
.usage-card{position:relative;border:1px solid var(--vscode-panel-border);border-radius:8px;padding:16px 16px 14px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));transition:border-color .15s ease,transform .15s ease}
.usage-card:hover{border-color:var(--vscode-focusBorder)}
.usage-card-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.usage-icon{width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;color:var(--vscode-button-foreground);background:var(--vscode-button-background);flex-shrink:0}
.usage-icon.alt{background:var(--vscode-textLink-foreground)}
.usage-title{font-size:14px;font-weight:600;line-height:1.2}
.usage-link-row{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-top:8px;border-radius:6px;background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.08));border:1px solid transparent;font-size:12px}
.usage-link-row:hover{border-color:var(--vscode-panel-border)}
.usage-link-tag{flex-shrink:0;font-size:11px;padding:2px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-weight:500}
.usage-link-row a{flex:1;word-break:break-all;font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.usage-notice{display:flex;align-items:flex-start;gap:8px;margin-top:12px;padding:8px 12px;border-radius:6px;font-size:12px;background:var(--vscode-inputValidation-infoBackground,rgba(100,150,250,.08));border:1px solid var(--vscode-inputValidation-infoBorder,var(--vscode-panel-border));color:var(--vscode-inputValidation-infoForeground,var(--vscode-foreground))}
.usage-notice::before{content:"🔒";flex-shrink:0}
.webhook-example{margin-top:12px;padding:12px;border-radius:6px;background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.08));border:1px solid var(--vscode-panel-border)}
.webhook-example-title{font-size:13px;font-weight:600;margin-bottom:8px}
.webhook-example-desc{font-size:12px;opacity:.8;margin-bottom:10px}
.code-block{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));padding:8px 10px;border-radius:4px;margin:6px 0;white-space:pre-wrap;word-break:break-all;border:1px solid var(--vscode-panel-border)}
.code-block.url{color:var(--vscode-textLink-foreground)}
</style>
</head>
<body>
<h1>${escapeHtml(text.title)}</h1>
<fieldset><legend>${escapeHtml(text.usage)}</legend>
<div class="usage-grid">
<div class="usage-card">
<div class="usage-card-head">
<span class="usage-icon">⚙</span>
<div class="usage-title">${escapeHtml(text.usageSelfHosted)}</div>
</div>
<div class="hint">${escapeHtml(text.usageSelfHostedDesc)}</div>
<div class="usage-link-row">
<span class="usage-link-tag">GitHub</span>
<a href="${escapeHtml(selfHostedRepoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(selfHostedRepoUrl)}</a>
</div>
<div class="usage-link-row">
<span class="usage-link-tag">webhook</span>
<a href="${escapeHtml(selfHostedWebhookRepoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(selfHostedWebhookRepoUrl)}</a>
</div>
</div>
<div class="usage-card">
<div class="usage-card-head">
<span class="usage-icon alt">☁</span>
<div class="usage-title">${escapeHtml(text.usageHosted)}</div>
</div>
<div class="usage-link-row">
<span class="usage-link-tag">${escapeHtml(text.usageHostedMainland.replace(/[：:]\s*$/,''))}</span>
<a href="${escapeHtml(hostedMainlandUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostedMainlandUrl)}</a>
</div>
<div class="usage-link-row">
<span class="usage-link-tag">${escapeHtml(text.usageHostedOverseas.replace(/[：:]\s*$/,''))}</span>
<a href="${escapeHtml(hostedOverseasUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostedOverseasUrl)}</a>
</div>
<div class="usage-notice">${escapeHtml(text.usageHostedNotice)}</div>
</div>
</div>
</fieldset>
<label><input id="enabled" type="checkbox"> ${escapeHtml(text.enabled)}</label>
<fieldset><legend>${escapeHtml(text.websocket)}</legend>
<label><input id="websocketEnabled" type="checkbox"> ${escapeHtml(text.websocketEnabled)}</label>
<div class="row"><label>${escapeHtml(text.websocketUrl)}<input id="websocketUrl" type="text" placeholder="wss://example.com/ws?token=..." /></label><button id="connect">${escapeHtml(text.connect)}</button></div>
</fieldset>
<fieldset><legend>${escapeHtml(text.webhook)}</legend>
<label><input id="webhookEnabled" type="checkbox"> ${escapeHtml(text.webhookEnabled)}</label>
<label>${escapeHtml(text.webhookUrl)}<input id="webhookUrl" type="text" placeholder="https://example.com/webhook" /></label>
<label>${escapeHtml(text.webhookSecret)}<input id="webhookSecret" type="password" placeholder="shared secret" /></label>
<div class="webhook-example">
<div class="webhook-example-title">${escapeHtml(text.webhookUsage)}</div>
<div class="webhook-example-desc">${escapeHtml(text.webhookUsageDesc)}</div>
<div class="webhook-example-title" style="margin-top:12px">${escapeHtml(text.webhookUrlExample)}</div>
<div class="webhook-example-desc">${escapeHtml(text.webhookUrlExampleDesc)}</div>
<div class="code-block url">POST https://your-domain.com/callback?token=YOUR_TOKEN</div>
<div class="webhook-example-title" style="margin-top:12px">${escapeHtml(text.webhookHeader)}</div>
<div class="code-block">Content-Type: application/json
Webhook-Id: wh_abc123
Webhook-Event: model.text_delta
Webhook-Timestamp: 1715600000
Webhook-Signature: t=1715600000,v1=8f4e...</div>
<div class="webhook-example-title" style="margin-top:12px">${escapeHtml(text.webhookEncrypt)}</div>
<div class="webhook-example-desc">${escapeHtml(text.webhookEncryptDesc)}</div>
<div class="code-block">// signedPayload = timestamp + "." + body
// signature = "t=" + timestamp + ",v1=" + HMAC-SHA256(webhookSecret, signedPayload)</div>
<div class="webhook-example-title" style="margin-top:12px">${escapeHtml(text.webhookEventTypes)}</div>
<div class="webhook-example-desc">${escapeHtml(text.webhookEventTypesDesc)}</div>
<div class="code-block">model.request_started, model.text_delta, model.reasoning_delta,
model.tool_call_started, model.tool_call_delta, model.tool_call_completed,
model.tool_result, model.assistant_final, model.request_completed,
model.request_cancelled, model.request_error</div>
<div class="webhook-example-title" style="margin-top:12px">${escapeHtml(text.webhookBodyExampleTitle)}</div>
<div class="webhook-example-desc">${escapeHtml(text.webhookBodyDesc)}</div>
<div class="code-block">{
  "protocolVersion": "1.0",
  "type": "model.text_delta",
  "messageId": "msg_xxx",
  "requestId": "req-12345",
  "sessionId": "sess_xxx",
  "workspaceId": "ws_xxx",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "source": "vscode-extension",
  "payload": {
    "content": "模型输出的文本片段"
  },
  "workspaceFolders": [...],
  "activeWorkspaceFolder": "/path/to/workspace"
}</div>
</div>
</fieldset>
<fieldset><legend>${escapeHtml(text.history)}</legend>
<label><input id="allowHistoryRequest" type="checkbox"> ${escapeHtml(text.allowHistoryRequest)}</label>
</fieldset>
<button id="save">${escapeHtml(text.save)}</button>
<script>
const vscode = acquireVsCodeApi();
const state = ${state};
for (const key of ['enabled','websocketEnabled','webhookEnabled','allowHistoryRequest']) document.getElementById(key).checked = !!state[key];
for (const key of ['websocketUrl','webhookUrl','webhookSecret']) document.getElementById(key).value = state[key] || '';
document.getElementById('save').addEventListener('click', () => {
  const data = {};
	for (const key of ['enabled','websocketEnabled','webhookEnabled','allowHistoryRequest']) data[key] = document.getElementById(key).checked;
	for (const key of ['websocketUrl','webhookUrl','webhookSecret']) data[key] = document.getElementById(key).value;
  vscode.postMessage({ command: 'save', data });
});
document.getElementById('connect').addEventListener('click', () => {
	const data = {};
	for (const key of ['enabled','websocketEnabled','webhookEnabled','allowHistoryRequest']) data[key] = document.getElementById(key).checked;
	data.enabled = true;
	data.websocketEnabled = true;
	for (const key of ['websocketUrl','webhookUrl','webhookSecret']) data[key] = document.getElementById(key).value;
	vscode.postMessage({ command: 'connect', data });
});
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch] || ch));
}
