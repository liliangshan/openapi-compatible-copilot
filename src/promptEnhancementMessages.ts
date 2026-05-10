import type { ResolvedAppLanguage } from './configManager.js';

export const OPTIMIZED_PROMPT_PREFIX: Record<ResolvedAppLanguage, string> = {
	'en': '[Optimized Prompt]',
	'zh-cn': '[已优化提示词]',
	'zh-tw': '[已最佳化提示詞]',
	ko: '[최적화된 프롬프트]',
	ja: '[最適化済みプロンプト]',
	fr: '[Prompt optimisé]',
	de: '[Optimierter Prompt]',
};

export const AUTO_PROMPT_ENHANCEMENT_DONE_MESSAGE: Record<ResolvedAppLanguage, string> = {
	en: 'Prompt optimized. Please submit again, or edit it before submitting.',
	'zh-cn': '提示词已优化，请再次提交，或者修改后提交。',
	'zh-tw': '提示詞已最佳化，請再次提交，或修改後再提交。',
	ko: '프롬프트가 최적화되었습니다. 다시 제출하거나 수정한 후 제출하세요.',
	ja: 'プロンプトを最適化しました。再度送信するか、編集してから送信してください。',
	fr: 'Le prompt a été optimisé. Veuillez le soumettre à nouveau, ou le modifier avant de le soumettre.',
	de: 'Der Prompt wurde optimiert. Bitte erneut senden oder vor dem Senden bearbeiten.',
};

export const AUTO_PROMPT_ENHANCEMENT_DONE_PREFIX: Record<ResolvedAppLanguage, string> = {
	en: 'Prompt optimized',
	'zh-cn': '提示词已优化',
	'zh-tw': '提示詞已最佳化',
	ko: '프롬프트가 최적화되었습니다',
	ja: 'プロンプトを最適化しました',
	fr: 'Le prompt a été optimisé',
	de: 'Der Prompt wurde optimiert',
};
