import { ResolvedAppLanguage } from '../configManager';

export const LLS_TASK_START_PLACEHOLDER_TEXT: Record<ResolvedAppLanguage, string> = {
	'en': 'Please drag the solution planning document from Explorer into this window, or delete this text and use your own prompt.',
	'zh-cn': '请把资源管理器中的方案规划文档拖到这个窗口中或者删除这段使用自己的提示词',
	'zh-tw': '請把資源管理器中的方案規劃文件拖到這個視窗中，或者刪除這段並使用自己的提示詞',
	ko: '탐색기의 솔루션 계획 문서를 이 창으로 끌어다 놓거나, 이 문구를 삭제하고 자신의 프롬프트를 사용하세요.',
	ja: 'エクスプローラー内のソリューション計画ドキュメントをこのウィンドウにドラッグするか、この文を削除して独自のプロンプトを使用してください。',
	fr: 'Faites glisser le document de planification de solution depuis l’explorateur dans cette fenêtre, ou supprimez ce texte et utilisez votre propre prompt.',
	de: 'Ziehen Sie das Lösungsplanungsdokument aus dem Explorer in dieses Fenster, oder löschen Sie diesen Text und verwenden Sie Ihren eigenen Prompt.',
};

export const LLS_TASK_START_PROMPT: Record<ResolvedAppLanguage, string> = {
	'en': `@lls-task ${LLS_TASK_START_PLACEHOLDER_TEXT.en}`,
	'zh-cn': `@lls-task ${LLS_TASK_START_PLACEHOLDER_TEXT['zh-cn']}`,
	'zh-tw': `@lls-task ${LLS_TASK_START_PLACEHOLDER_TEXT['zh-tw']}`,
	ko: `@lls-task ${LLS_TASK_START_PLACEHOLDER_TEXT.ko}`,
	ja: `@lls-task ${LLS_TASK_START_PLACEHOLDER_TEXT.ja}`,
	fr: `@lls-task ${LLS_TASK_START_PLACEHOLDER_TEXT.fr}`,
	de: `@lls-task ${LLS_TASK_START_PLACEHOLDER_TEXT.de}`,
};