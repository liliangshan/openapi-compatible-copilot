// LLS OAI Configuration View Script
(function () {
	const vscode = acquireVsCodeApi();

	// State
	let providers = [];
	let editingProviderId = null;
	let editingModelProviderId = null;
	let editingModelIndex = -1;
	let editingModelData = null;
	let newlyAddedProviderId = null;
	const expandedProviders = new Set();
	const loadingProviders = new Set(); // Track providers that are fetching models
	let isInitialLoad = true; // Track whether this is the first providersLoaded
	let expertModeSettings = { enabled: false, providerId: '', modelId: '' };
	let expertSelectableProviders = [];
	let configuredLanguage = 'auto';
	function resolveLanguage(language) {
		const normalized = (language || '').toLowerCase();
		if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo') || normalized.startsWith('zh-hant')) { return 'zh-tw'; }
		if (normalized.startsWith('zh')) { return 'zh-cn'; }
		if (normalized.startsWith('ko')) { return 'ko'; }
		if (normalized.startsWith('ja')) { return 'ja'; }
		if (normalized.startsWith('fr')) { return 'fr'; }
		if (normalized.startsWith('de')) { return 'de'; }
		return 'en';
	}
	let currentLanguage = resolveLanguage(window.VSCODE_LOCALE);

	const translations = {
		'en': {
			importConfiguration: 'Import Configuration',
			exportConfiguration: 'Export Configuration',
			import: 'Import',
			export: 'Export',
			subtitle: 'OpenAPI Compatible Copilot',
			languageLabel: 'Language',
			languageAuto: 'Auto (VS Code)',
			languageEnglish: 'English',
			languageChinese: '简体中文',
			languageTraditionalChinese: '繁體中文',
			languageKorean: '한국어',
			languageJapanese: '日本語',
			languageFrench: 'Français',
			languageGerman: 'Deutsch',
			globalSettings: 'Global Settings',
			projectSettings: 'Project Settings',
			settingsHint: 'System Prompt, Chat History, Expert Mode, Import/Export Copilot Records, Enhanced TODO Settings',
			providers: 'Providers',
			noProviders: 'No providers configured yet',
			addFirstProvider: 'Add Your First Provider',
			enabled: 'Enabled',
			disabled: 'Disabled',
			apiType: 'API Type',
			baseUrl: 'Base URL',
			apiKey: 'API Key',
			configured: '**** Configured',
			notSet: '⚠️ Not Set',
			autoFetchModels: 'Auto Fetch Models',
			autoFetchModelsTitle: 'Automatically fetch models from API when settings open',
			models: 'Models',
			fetchingModels: 'Fetching models...',
			noModels: '⚠️ No models (check API Key)',
			edit: 'Edit',
			delete: 'Delete',
			fetchModels: 'Fetch Models',
			loading: 'Loading...',
			addModel: '+ Add Model',
			showInChatSelector: 'Show in Chat Selector',
			addProvider: 'Add Provider',
			editProvider: 'Edit Provider',
			providerName: 'Provider Name',
			providerNamePlaceholder: 'e.g., MyOpenAI, LocalLLM',
			providerNameHelp: 'A unique name to identify this provider in Copilot',
			apiTypeHelp: 'The API protocol used by this provider',
			baseUrlPlaceholder: 'https://api.openai.com/v1',
			baseUrlHelp: 'The API endpoint',
			apiKeyPlaceholder: 'sk-...',
			apiKeyHelp: 'Leave empty to keep existing key (when editing)',
			cancel: 'Cancel',
			save: 'Save',
			saveProvider: 'Save Provider',
			editModel: 'Edit Model',
			modelId: 'Model ID',
			modelIdPlaceholder: 'e.g., gpt-4o',
			displayName: 'Display Name',
			displayNamePlaceholder: 'e.g., GPT-4o',
			contextLength: 'Context Length',
			maxTokens: 'Max Tokens',
			visionSupport: 'Vision Support',
			toolCalling: 'Tool Calling',
			transformThinkTags: 'Transform Think Tags (<|im_start|>/♩)',
			temperature: 'Temperature',
			topP: 'Top P',
			samplingMode: 'Sampling Mode',
			samplingBoth: 'Both (temperature + top_p)',
			samplingTemperature: 'Temperature only',
			samplingTopP: 'Top P only',
			samplingNone: 'None (do not pass)',
			samplingHelp: 'Some models (e.g. Claude) only accept one sampling parameter at a time',
			saveModel: 'Save Model',
			chatHistorySettings: 'Chat History Settings',
			autoSaveChatHistory: 'Auto Save Chat History',
			chatHistoryHelp: 'Automatically save chat conversations to local files',
			savePath: 'Save Path',
			savePathPlaceholder: 'Path to save chat history',
			defaultSavePathHelp: 'Default: Windows: %APPDATA%/LLSOAI, macOS/Linux: ~/.LLSOAI',
			editSystemPrompt: 'Edit System Prompt',
			globalSystemPrompt: 'Global System Prompt',
			globalSystemPromptPlaceholder: 'Enter global system prompt here...',
			globalSystemPromptHelp: 'Applied to all workspaces. Stored in global settings.',
			projectSystemPrompt: 'Project System Prompt',
			projectWorkspaceSystemPrompt: 'Project (Workspace) System Prompt',
			projectSystemPromptPlaceholder: 'Enter project-specific system prompt here...',
			projectSystemPromptHelp: 'Applied only to current workspace. Stored in workspace settings.',
			chatHistory: 'Chat History',
			expertMode: 'Expert Mode',
			enableExpertMode: 'Enable Expert Mode',
			expertModeHelp: 'When enabled, the main model can delegate difficult tasks to a selected expert model.',
			expertProvider: 'Expert Provider',
			expertModel: 'Expert Model',
			expertSelectProvider: 'Select provider',
			expertSelectModel: 'Select model',
			expertProjectDescription: 'Configure how this project uses the LLSOAI expert model.',
			expertGlobalStatus: 'Global {state}',
			expertUseGlobal: 'Use global',
			expertFollowGlobalState: 'Follow global state: {state}',
			expertForceEnabledDesc: 'Force expert mode on for this project.',
			expertForceDisabledDesc: 'Force expert mode off for this project.',
			expertUseGlobalProvider: 'Use global expert provider ({value})',
			expertUseGlobalModel: 'Use global expert model ({value})',
			expertModelOverrideHelp: 'Select both provider and model to override the global expert model. Leave either empty to keep using the global expert model.',
			enhancedTodo: 'Enhanced TODO',
			enableEnhancedTodo: 'Enable Enhanced TODO',
			enhancedTodoHelp: 'If enabled, will automatically save TODO items to project directory. When creating new TODO, will check for incomplete TODOs.',
			copilotRecords: 'Copilot Records',
			copilotRecordsHelp: 'Import/export chat records from VS Code Copilot',
			importRecords: 'Import Records',
			exportRecords: 'Export Records',
			saveAll: 'Save All',
			errorExtensionNotInitialized: 'Error: Extension not initialized',
			modelIdRequired: 'Model ID is required',
			enterProviderName: 'Please enter a provider name',
			enterBaseUrl: 'Please enter a base URL',
			enterApiKey: 'Please enter an API key for new providers',
			chatHistoryEnabled: 'Enabled',
			chatHistoryDisabled: 'Disabled',
			adLabel: 'AD'
		},
		'zh-cn': {
			importConfiguration: '导入配置',
			exportConfiguration: '导出配置',
			import: '导入',
			export: '导出',
			subtitle: 'OpenAPI 兼容 Copilot',
			languageLabel: '语言',
			languageAuto: '自动（跟随 VS Code）',
			languageEnglish: 'English',
			languageChinese: '简体中文',
			languageTraditionalChinese: '繁體中文',
			languageKorean: '한국어',
			languageJapanese: '日本語',
			languageFrench: 'Français',
			languageGerman: 'Deutsch',
			globalSettings: '全局设置',
			projectSettings: '项目设置',
			settingsHint: '系统提示词、聊天历史、专家模式、导入/导出 Copilot 记录、增强 TODO 设置',
			providers: '提供商',
			noProviders: '还没有配置提供商',
			addFirstProvider: '添加第一个提供商',
			enabled: '已启用',
			disabled: '已禁用',
			apiType: 'API 类型',
			baseUrl: 'Base URL',
			apiKey: 'API Key',
			configured: '**** 已配置',
			notSet: '⚠️ 未设置',
			autoFetchModels: '自动获取模型',
			autoFetchModelsTitle: '打开设置时自动从 API 获取模型',
			models: '模型',
			fetchingModels: '正在获取模型...',
			noModels: '⚠️ 无模型（请检查 API Key）',
			edit: '编辑',
			delete: '删除',
			fetchModels: '获取模型',
			loading: '加载中...',
			addModel: '+ 添加模型',
			showInChatSelector: '显示在聊天选择器中',
			addProvider: '添加提供商',
			editProvider: '编辑提供商',
			providerName: '提供商名称',
			providerNamePlaceholder: '例如：MyOpenAI、LocalLLM',
			providerNameHelp: '用于在 Copilot 中识别此提供商的唯一名称',
			apiTypeHelp: '此提供商使用的 API 协议',
			baseUrlPlaceholder: 'https://api.openai.com/v1',
			baseUrlHelp: 'API 端点地址',
			apiKeyPlaceholder: 'sk-...',
			apiKeyHelp: '编辑时留空表示保留现有密钥',
			cancel: '取消',
			save: '保存',
			saveProvider: '保存提供商',
			editModel: '编辑模型',
			modelId: '模型 ID',
			modelIdPlaceholder: '例如：gpt-4o',
			displayName: '显示名称',
			displayNamePlaceholder: '例如：GPT-4o',
			contextLength: '上下文长度',
			maxTokens: '最大 Token 数',
			visionSupport: '视觉支持',
			toolCalling: '工具调用',
			transformThinkTags: '转换 Think 标签（<|im_start|>/♩）',
			temperature: 'Temperature',
			topP: 'Top P',
			samplingMode: '采样模式',
			samplingBoth: '同时传递 temperature + top_p',
			samplingTemperature: '仅传递 Temperature',
			samplingTopP: '仅传递 Top P',
			samplingNone: '不传递采样参数',
			samplingHelp: '部分模型（例如 Claude）一次只接受一个采样参数',
			saveModel: '保存模型',
			chatHistorySettings: '聊天历史设置',
			autoSaveChatHistory: '自动保存聊天历史',
			chatHistoryHelp: '自动将聊天对话保存到本地文件',
			savePath: '保存路径',
			savePathPlaceholder: '聊天历史保存路径',
			defaultSavePathHelp: '默认：Windows: %APPDATA%/LLSOAI，macOS/Linux: ~/.LLSOAI',
			editSystemPrompt: '编辑系统提示词',
			globalSystemPrompt: '全局系统提示词',
			globalSystemPromptPlaceholder: '在此输入全局系统提示词...',
			globalSystemPromptHelp: '应用于所有工作区，保存在全局设置中。',
			projectSystemPrompt: '项目系统提示词',
			projectWorkspaceSystemPrompt: '项目（工作区）系统提示词',
			projectSystemPromptPlaceholder: '在此输入项目专属系统提示词...',
			projectSystemPromptHelp: '仅应用于当前工作区，保存在工作区设置中。',
			chatHistory: '聊天历史',
			expertMode: '专家模式',
			enableExpertMode: '启用专家模式',
			expertModeHelp: '启用后，主模型可以将复杂任务委托给所选专家模型。',
			expertProvider: '专家提供商',
			expertModel: '专家模型',
			expertSelectProvider: '选择提供商',
			expertSelectModel: '选择模型',
			expertProjectDescription: '配置当前项目如何使用 LLSOAI 专家模型。',
			expertGlobalStatus: '全局{state}',
			expertUseGlobal: '使用全局',
			expertFollowGlobalState: '跟随全局状态：{state}',
			expertForceEnabledDesc: '强制当前项目开启专家模式。',
			expertForceDisabledDesc: '强制当前项目关闭专家模式。',
			expertUseGlobalProvider: '使用全局专家提供商（{value}）',
			expertUseGlobalModel: '使用全局专家模型（{value}）',
			expertModelOverrideHelp: '同时选择提供商和模型即可覆盖全局专家模型；任意一项留空则继续使用全局专家模型。',
			enhancedTodo: '增强 TODO',
			enableEnhancedTodo: '启用增强 TODO',
			enhancedTodoHelp: '启用后会自动将 TODO 保存到项目目录；创建新 TODO 时会检查是否存在未完成 TODO。',
			copilotRecords: 'Copilot 记录',
			copilotRecordsHelp: '导入/导出 VS Code Copilot 聊天记录',
			importRecords: '导入记录',
			exportRecords: '导出记录',
			saveAll: '全部保存',
			errorExtensionNotInitialized: '错误：扩展未初始化',
			modelIdRequired: '模型 ID 不能为空',
			enterProviderName: '请输入提供商名称',
			enterBaseUrl: '请输入 Base URL',
			enterApiKey: '请为新提供商输入 API Key',
			chatHistoryEnabled: '已启用',
			chatHistoryDisabled: '已禁用',
			adLabel: '广告'
		}
	};

	translations['zh-tw'] = {
		...translations['zh-cn'],
		importConfiguration: '匯入設定', exportConfiguration: '匯出設定', import: '匯入', export: '匯出', subtitle: 'OpenAPI 相容 Copilot', languageAuto: '自動（跟隨 VS Code）', globalSettings: '全域設定', projectSettings: '專案設定', settingsHint: '系統提示詞、聊天歷史、專家模式、匯入/匯出 Copilot 記錄、增強 TODO 設定', providers: '提供商', noProviders: '尚未設定提供商', addFirstProvider: '新增第一個提供商', enabled: '已啟用', disabled: '已停用', apiType: 'API 類型', configured: '**** 已設定', notSet: '⚠️ 未設定', autoFetchModels: '自動取得模型', autoFetchModelsTitle: '開啟設定時自動從 API 取得模型', models: '模型', fetchingModels: '正在取得模型...', noModels: '⚠️ 無模型（請檢查 API Key）', edit: '編輯', delete: '刪除', fetchModels: '取得模型', loading: '載入中...', addModel: '+ 新增模型', showInChatSelector: '顯示在聊天選擇器中', addProvider: '新增提供商', editProvider: '編輯提供商', providerName: '提供商名稱', providerNamePlaceholder: '例如：MyOpenAI、LocalLLM', providerNameHelp: '用於在 Copilot 中識別此提供商的唯一名稱', apiTypeHelp: '此提供商使用的 API 協定', baseUrlHelp: 'API 端點位址', apiKeyHelp: '編輯時留空表示保留現有金鑰', cancel: '取消', save: '儲存', saveProvider: '儲存提供商', editModel: '編輯模型', modelId: '模型 ID', modelIdPlaceholder: '例如：gpt-4o', displayName: '顯示名稱', displayNamePlaceholder: '例如：GPT-4o', contextLength: '上下文長度', maxTokens: '最大 Token 數', visionSupport: '視覺支援', toolCalling: '工具呼叫', transformThinkTags: '轉換 Think 標籤（<|im_start|>/♩）', samplingMode: '取樣模式', samplingBoth: '同時傳遞 temperature + top_p', samplingTemperature: '僅傳遞 Temperature', samplingTopP: '僅傳遞 Top P', samplingNone: '不傳遞取樣參數', samplingHelp: '部分模型（例如 Claude）一次只接受一個取樣參數', saveModel: '儲存模型', chatHistorySettings: '聊天歷史設定', autoSaveChatHistory: '自動儲存聊天歷史', chatHistoryHelp: '自動將聊天對話儲存到本機檔案', savePath: '儲存路徑', savePathPlaceholder: '聊天歷史儲存路徑', defaultSavePathHelp: '預設：Windows: %APPDATA%/LLSOAI，macOS/Linux: ~/.LLSOAI', editSystemPrompt: '編輯系統提示詞', globalSystemPrompt: '全域系統提示詞', globalSystemPromptPlaceholder: '在此輸入全域系統提示詞...', globalSystemPromptHelp: '套用於所有工作區，儲存在全域設定中。', projectSystemPrompt: '專案系統提示詞', projectWorkspaceSystemPrompt: '專案（工作區）系統提示詞', projectSystemPromptPlaceholder: '在此輸入專案專屬系統提示詞...', projectSystemPromptHelp: '僅套用於目前工作區，儲存在工作區設定中。', chatHistory: '聊天歷史', expertMode: '專家模式', enableExpertMode: '啟用專家模式', expertModeHelp: '啟用後，主模型可以將複雜任務委派給所選專家模型。', expertProvider: '專家提供商', expertModel: '專家模型', expertSelectProvider: '選擇提供商', expertSelectModel: '選擇模型', expertProjectDescription: '設定目前專案如何使用 LLSOAI 專家模型。', expertGlobalStatus: '全域{state}', expertUseGlobal: '使用全域', expertFollowGlobalState: '跟隨全域狀態：{state}', expertForceEnabledDesc: '強制目前專案開啟專家模式。', expertForceDisabledDesc: '強制目前專案關閉專家模式。', expertUseGlobalProvider: '使用全域專家提供商（{value}）', expertUseGlobalModel: '使用全域專家模型（{value}）', expertModelOverrideHelp: '同時選擇提供商和模型即可覆蓋全域專家模型；任一項留空則繼續使用全域專家模型。', enhancedTodo: '增強 TODO', enableEnhancedTodo: '啟用增強 TODO', enhancedTodoHelp: '啟用後會自動將 TODO 儲存到專案目錄；建立新 TODO 時會檢查是否存在未完成 TODO。', copilotRecords: 'Copilot 記錄', copilotRecordsHelp: '匯入/匯出 VS Code Copilot 聊天記錄', importRecords: '匯入記錄', exportRecords: '匯出記錄', saveAll: '全部儲存', errorExtensionNotInitialized: '錯誤：擴充功能未初始化', modelIdRequired: '模型 ID 不能為空', enterProviderName: '請輸入提供商名稱', enterBaseUrl: '請輸入 Base URL', enterApiKey: '請為新提供商輸入 API Key', chatHistoryEnabled: '已啟用', chatHistoryDisabled: '已停用', adLabel: '廣告'
	};

	translations.ko = {
		...translations.en,
		importConfiguration: '구성 가져오기', exportConfiguration: '구성 내보내기', import: '가져오기', export: '내보내기', subtitle: 'OpenAPI 호환 Copilot', languageLabel: '언어', languageAuto: '자동(VS Code 따름)', globalSettings: '전역 설정', projectSettings: '프로젝트 설정', settingsHint: '시스템 프롬프트, 채팅 기록, 전문가 모드, Copilot 기록 가져오기/내보내기, 향상된 TODO 설정', providers: '공급자', noProviders: '아직 구성된 공급자가 없습니다', addFirstProvider: '첫 공급자 추가', enabled: '활성화됨', disabled: '비활성화됨', apiType: 'API 유형', configured: '**** 구성됨', notSet: '⚠️ 설정되지 않음', autoFetchModels: '모델 자동 가져오기', autoFetchModelsTitle: '설정을 열 때 API에서 모델을 자동으로 가져오기', models: '모델', fetchingModels: '모델 가져오는 중...', noModels: '⚠️ 모델 없음(API Key 확인)', edit: '편집', delete: '삭제', fetchModels: '모델 가져오기', loading: '로딩 중...', addModel: '+ 모델 추가', showInChatSelector: '채팅 선택기에 표시', addProvider: '공급자 추가', editProvider: '공급자 편집', providerName: '공급자 이름', providerNameHelp: 'Copilot에서 이 공급자를 식별하는 고유한 이름', apiTypeHelp: '이 공급자가 사용하는 API 프로토콜', baseUrlHelp: 'API 엔드포인트', apiKeyHelp: '편집 시 비워 두면 기존 키 유지', cancel: '취소', save: '저장', saveProvider: '공급자 저장', editModel: '모델 편집', modelId: '모델 ID', displayName: '표시 이름', contextLength: '컨텍스트 길이', maxTokens: '최대 토큰 수', visionSupport: '비전 지원', toolCalling: '도구 호출', transformThinkTags: 'Think 태그 변환(<|im_start|>/♩)', samplingMode: '샘플링 모드', samplingBoth: '둘 다 전달(temperature + top_p)', samplingTemperature: 'Temperature만 전달', samplingTopP: 'Top P만 전달', samplingNone: '전달하지 않음', samplingHelp: '일부 모델(예: Claude)은 한 번에 하나의 샘플링 매개변수만 허용합니다', saveModel: '모델 저장', chatHistorySettings: '채팅 기록 설정', autoSaveChatHistory: '채팅 기록 자동 저장', chatHistoryHelp: '채팅 대화를 로컬 파일에 자동 저장', savePath: '저장 경로', savePathPlaceholder: '채팅 기록 저장 경로', defaultSavePathHelp: '기본값: Windows: %APPDATA%/LLSOAI, macOS/Linux: ~/.LLSOAI', editSystemPrompt: '시스템 프롬프트 편집', globalSystemPrompt: '전역 시스템 프롬프트', globalSystemPromptPlaceholder: '전역 시스템 프롬프트를 입력하세요...', globalSystemPromptHelp: '모든 작업 영역에 적용되며 전역 설정에 저장됩니다.', projectSystemPrompt: '프로젝트 시스템 프롬프트', projectWorkspaceSystemPrompt: '프로젝트(작업 영역) 시스템 프롬프트', projectSystemPromptPlaceholder: '프로젝트 전용 시스템 프롬프트를 입력하세요...', projectSystemPromptHelp: '현재 작업 영역에만 적용되며 작업 영역 설정에 저장됩니다.', chatHistory: '채팅 기록', expertMode: '전문가 모드', enableExpertMode: '전문가 모드 활성화', expertModeHelp: '활성화하면 기본 모델이 어려운 작업을 선택한 전문가 모델에 위임할 수 있습니다.', expertProvider: '전문가 공급자', expertModel: '전문가 모델', expertSelectProvider: '공급자 선택', expertSelectModel: '모델 선택', expertProjectDescription: '이 프로젝트에서 LLSOAI 전문가 모델을 사용하는 방식을 구성합니다.', expertGlobalStatus: '전역 {state}', expertUseGlobal: '전역 사용', expertFollowGlobalState: '전역 상태 따르기: {state}', expertForceEnabledDesc: '이 프로젝트에서 전문가 모드를 강제로 켭니다.', expertForceDisabledDesc: '이 프로젝트에서 전문가 모드를 강제로 끕니다.', expertUseGlobalProvider: '전역 전문가 공급자 사용({value})', expertUseGlobalModel: '전역 전문가 모델 사용({value})', expertModelOverrideHelp: '공급자와 모델을 모두 선택하면 전역 전문가 모델을 재정의합니다. 둘 중 하나를 비워 두면 전역 전문가 모델을 계속 사용합니다.', enhancedTodo: '향상된 TODO', enableEnhancedTodo: '향상된 TODO 활성화', enhancedTodoHelp: '활성화하면 TODO 항목을 프로젝트 디렉터리에 자동 저장하고 새 TODO 생성 시 미완료 TODO를 확인합니다.', copilotRecords: 'Copilot 기록', copilotRecordsHelp: 'VS Code Copilot 채팅 기록 가져오기/내보내기', importRecords: '기록 가져오기', exportRecords: '기록 내보내기', saveAll: '모두 저장', errorExtensionNotInitialized: '오류: 확장이 초기화되지 않았습니다', modelIdRequired: '모델 ID는 필수입니다', enterProviderName: '공급자 이름을 입력하세요', enterBaseUrl: 'Base URL을 입력하세요', enterApiKey: '새 공급자의 API Key를 입력하세요', chatHistoryEnabled: '활성화됨', chatHistoryDisabled: '비활성화됨', adLabel: '광고'
	};
	translations.ja = {
		...translations.en,
		importConfiguration: '設定をインポート', exportConfiguration: '設定をエクスポート', import: 'インポート', export: 'エクスポート', subtitle: 'OpenAPI 互換 Copilot', languageLabel: '言語', languageAuto: '自動（VS Code に従う）', globalSettings: 'グローバル設定', projectSettings: 'プロジェクト設定', settingsHint: 'システムプロンプト、チャット履歴、エキスパートモード、Copilot 記録のインポート/エクスポート、拡張 TODO 設定', providers: 'プロバイダー', noProviders: 'プロバイダーはまだ設定されていません', addFirstProvider: '最初のプロバイダーを追加', enabled: '有効', disabled: '無効', apiType: 'API タイプ', configured: '**** 設定済み', notSet: '⚠️ 未設定', autoFetchModels: 'モデルを自動取得', autoFetchModelsTitle: '設定を開いたときに API からモデルを自動取得', models: 'モデル', fetchingModels: 'モデルを取得中...', noModels: '⚠️ モデルなし（API Key を確認）', edit: '編集', delete: '削除', fetchModels: 'モデルを取得', loading: '読み込み中...', addModel: '+ モデルを追加', showInChatSelector: 'チャット選択に表示', addProvider: 'プロバイダーを追加', editProvider: 'プロバイダーを編集', providerName: 'プロバイダー名', providerNameHelp: 'Copilot でこのプロバイダーを識別する一意の名前', apiTypeHelp: 'このプロバイダーが使用する API プロトコル', baseUrlHelp: 'API エンドポイント', apiKeyHelp: '編集中は空のままにすると既存キーを保持します', cancel: 'キャンセル', save: '保存', saveProvider: 'プロバイダーを保存', editModel: 'モデルを編集', modelId: 'モデル ID', displayName: '表示名', contextLength: 'コンテキスト長', maxTokens: '最大トークン数', visionSupport: 'ビジョン対応', toolCalling: 'ツール呼び出し', transformThinkTags: 'Think タグを変換（<|im_start|>/♩）', samplingMode: 'サンプリングモード', samplingBoth: '両方を渡す（temperature + top_p）', samplingTemperature: 'Temperature のみ', samplingTopP: 'Top P のみ', samplingNone: '渡さない', samplingHelp: '一部のモデル（例: Claude）は一度に 1 つのサンプリングパラメーターのみ受け付けます', saveModel: 'モデルを保存', chatHistorySettings: 'チャット履歴設定', autoSaveChatHistory: 'チャット履歴を自動保存', chatHistoryHelp: 'チャット会話をローカルファイルに自動保存', savePath: '保存先', savePathPlaceholder: 'チャット履歴の保存先', defaultSavePathHelp: '既定: Windows: %APPDATA%/LLSOAI、macOS/Linux: ~/.LLSOAI', editSystemPrompt: 'システムプロンプトを編集', globalSystemPrompt: 'グローバルシステムプロンプト', globalSystemPromptPlaceholder: 'グローバルシステムプロンプトを入力...', globalSystemPromptHelp: 'すべてのワークスペースに適用され、グローバル設定に保存されます。', projectSystemPrompt: 'プロジェクトシステムプロンプト', projectWorkspaceSystemPrompt: 'プロジェクト（ワークスペース）システムプロンプト', projectSystemPromptPlaceholder: 'プロジェクト専用システムプロンプトを入力...', projectSystemPromptHelp: '現在のワークスペースにのみ適用され、ワークスペース設定に保存されます。', chatHistory: 'チャット履歴', expertMode: 'エキスパートモード', enableExpertMode: 'エキスパートモードを有効化', expertModeHelp: '有効にすると、メインモデルは難しいタスクを選択したエキスパートモデルに委任できます。', expertProvider: 'エキスパートプロバイダー', expertModel: 'エキスパートモデル', expertSelectProvider: 'プロバイダーを選択', expertSelectModel: 'モデルを選択', expertProjectDescription: 'このプロジェクトで LLSOAI エキスパートモデルを使用する方法を設定します。', expertGlobalStatus: 'グローバル {state}', expertUseGlobal: 'グローバルを使用', expertFollowGlobalState: 'グローバル状態に従う: {state}', expertForceEnabledDesc: 'このプロジェクトでエキスパートモードを強制的にオンにします。', expertForceDisabledDesc: 'このプロジェクトでエキスパートモードを強制的にオフにします。', expertUseGlobalProvider: 'グローバルエキスパートプロバイダーを使用（{value}）', expertUseGlobalModel: 'グローバルエキスパートモデルを使用（{value}）', expertModelOverrideHelp: 'プロバイダーとモデルの両方を選択すると、グローバルエキスパートモデルを上書きします。どちらかを空にすると、グローバルエキスパートモデルを引き続き使用します。', enhancedTodo: '拡張 TODO', enableEnhancedTodo: '拡張 TODO を有効化', enhancedTodoHelp: '有効にすると TODO をプロジェクトディレクトリに自動保存し、新規 TODO 作成時に未完了 TODO を確認します。', copilotRecords: 'Copilot 記録', copilotRecordsHelp: 'VS Code Copilot チャット記録をインポート/エクスポート', importRecords: '記録をインポート', exportRecords: '記録をエクスポート', saveAll: 'すべて保存', errorExtensionNotInitialized: 'エラー: 拡張機能が初期化されていません', modelIdRequired: 'モデル ID は必須です', enterProviderName: 'プロバイダー名を入力してください', enterBaseUrl: 'Base URL を入力してください', enterApiKey: '新しいプロバイダーの API Key を入力してください', chatHistoryEnabled: '有効', chatHistoryDisabled: '無効', adLabel: '広告'
	};
	translations.fr = {
		...translations.en,
		importConfiguration: 'Importer la configuration', exportConfiguration: 'Exporter la configuration', import: 'Importer', export: 'Exporter', subtitle: 'Copilot compatible OpenAPI', languageLabel: 'Langue', languageAuto: 'Auto (suivre VS Code)', globalSettings: 'Paramètres globaux', projectSettings: 'Paramètres du projet', settingsHint: 'Prompt système, historique de chat, mode expert, import/export des enregistrements Copilot, paramètres TODO avancés', providers: 'Fournisseurs', noProviders: 'Aucun fournisseur configuré', addFirstProvider: 'Ajouter votre premier fournisseur', enabled: 'Activé', disabled: 'Désactivé', apiType: 'Type d’API', configured: '**** Configuré', notSet: '⚠️ Non défini', autoFetchModels: 'Récupérer automatiquement les modèles', autoFetchModelsTitle: 'Récupérer automatiquement les modèles depuis l’API à l’ouverture des paramètres', models: 'Modèles', fetchingModels: 'Récupération des modèles...', noModels: '⚠️ Aucun modèle (vérifiez l’API Key)', edit: 'Modifier', delete: 'Supprimer', fetchModels: 'Récupérer les modèles', loading: 'Chargement...', addModel: '+ Ajouter un modèle', showInChatSelector: 'Afficher dans le sélecteur de chat', addProvider: 'Ajouter un fournisseur', editProvider: 'Modifier le fournisseur', providerName: 'Nom du fournisseur', providerNameHelp: 'Nom unique pour identifier ce fournisseur dans Copilot', apiTypeHelp: 'Protocole API utilisé par ce fournisseur', baseUrlHelp: 'Point de terminaison API', apiKeyHelp: 'Laissez vide pour conserver la clé existante lors de la modification', cancel: 'Annuler', save: 'Enregistrer', saveProvider: 'Enregistrer le fournisseur', editModel: 'Modifier le modèle', modelId: 'ID du modèle', displayName: 'Nom d’affichage', contextLength: 'Longueur du contexte', maxTokens: 'Tokens max.', visionSupport: 'Support vision', toolCalling: 'Appel d’outils', transformThinkTags: 'Transformer les balises Think (<|im_start|>/♩)', samplingMode: 'Mode d’échantillonnage', samplingBoth: 'Les deux (temperature + top_p)', samplingTemperature: 'Temperature seulement', samplingTopP: 'Top P seulement', samplingNone: 'Aucun', samplingHelp: 'Certains modèles (ex. Claude) n’acceptent qu’un seul paramètre d’échantillonnage à la fois', saveModel: 'Enregistrer le modèle', chatHistorySettings: 'Paramètres de l’historique de chat', autoSaveChatHistory: 'Enregistrer automatiquement l’historique', chatHistoryHelp: 'Enregistrer automatiquement les conversations dans des fichiers locaux', savePath: 'Chemin d’enregistrement', savePathPlaceholder: 'Chemin de sauvegarde de l’historique', defaultSavePathHelp: 'Par défaut : Windows : %APPDATA%/LLSOAI, macOS/Linux : ~/.LLSOAI', editSystemPrompt: 'Modifier le prompt système', globalSystemPrompt: 'Prompt système global', globalSystemPromptPlaceholder: 'Saisissez le prompt système global...', globalSystemPromptHelp: 'Appliqué à tous les espaces de travail et stocké dans les paramètres globaux.', projectSystemPrompt: 'Prompt système du projet', projectWorkspaceSystemPrompt: 'Prompt système du projet (espace de travail)', projectSystemPromptPlaceholder: 'Saisissez le prompt système propre au projet...', projectSystemPromptHelp: 'Appliqué uniquement à l’espace de travail actuel et stocké dans ses paramètres.', chatHistory: 'Historique de chat', expertMode: 'Mode expert', enableExpertMode: 'Activer le mode expert', expertModeHelp: 'Une fois activé, le modèle principal peut déléguer les tâches difficiles au modèle expert sélectionné.', expertProvider: 'Fournisseur expert', expertModel: 'Modèle expert', expertSelectProvider: 'Sélectionner un fournisseur', expertSelectModel: 'Sélectionner un modèle', expertProjectDescription: 'Configurez la façon dont ce projet utilise le modèle expert LLSOAI.', expertGlobalStatus: 'Global {state}', expertUseGlobal: 'Utiliser les paramètres globaux', expertFollowGlobalState: 'Suivre l’état global : {state}', expertForceEnabledDesc: 'Forcer l’activation du mode expert pour ce projet.', expertForceDisabledDesc: 'Forcer la désactivation du mode expert pour ce projet.', expertUseGlobalProvider: 'Utiliser le fournisseur expert global ({value})', expertUseGlobalModel: 'Utiliser le modèle expert global ({value})', expertModelOverrideHelp: 'Sélectionnez à la fois un fournisseur et un modèle pour remplacer le modèle expert global. Laissez l’un des deux vide pour continuer à utiliser le modèle expert global.', enhancedTodo: 'TODO avancé', enableEnhancedTodo: 'Activer TODO avancé', enhancedTodoHelp: 'Si activé, les TODO sont automatiquement enregistrés dans le projet et les TODO incomplets sont vérifiés lors d’une nouvelle création.', copilotRecords: 'Enregistrements Copilot', copilotRecordsHelp: 'Importer/exporter les historiques de chat VS Code Copilot', importRecords: 'Importer les enregistrements', exportRecords: 'Exporter les enregistrements', saveAll: 'Tout enregistrer', errorExtensionNotInitialized: 'Erreur : extension non initialisée', modelIdRequired: 'L’ID du modèle est requis', enterProviderName: 'Veuillez saisir un nom de fournisseur', enterBaseUrl: 'Veuillez saisir une Base URL', enterApiKey: 'Veuillez saisir une API Key pour les nouveaux fournisseurs', chatHistoryEnabled: 'Activé', chatHistoryDisabled: 'Désactivé', adLabel: 'Pub'
	};
	translations.de = {
		...translations.en,
		importConfiguration: 'Konfiguration importieren', exportConfiguration: 'Konfiguration exportieren', import: 'Importieren', export: 'Exportieren', subtitle: 'OpenAPI-kompatibler Copilot', languageLabel: 'Sprache', languageAuto: 'Automatisch (VS Code folgen)', globalSettings: 'Globale Einstellungen', projectSettings: 'Projekteinstellungen', settingsHint: 'System-Prompt, Chatverlauf, Expertenmodus, Copilot-Datensätze importieren/exportieren, erweiterte TODO-Einstellungen', providers: 'Anbieter', noProviders: 'Noch keine Anbieter konfiguriert', addFirstProvider: 'Ersten Anbieter hinzufügen', enabled: 'Aktiviert', disabled: 'Deaktiviert', apiType: 'API-Typ', configured: '**** Konfiguriert', notSet: '⚠️ Nicht festgelegt', autoFetchModels: 'Modelle automatisch abrufen', autoFetchModelsTitle: 'Modelle beim Öffnen der Einstellungen automatisch von der API abrufen', models: 'Modelle', fetchingModels: 'Modelle werden abgerufen...', noModels: '⚠️ Keine Modelle (API Key prüfen)', edit: 'Bearbeiten', delete: 'Löschen', fetchModels: 'Modelle abrufen', loading: 'Wird geladen...', addModel: '+ Modell hinzufügen', showInChatSelector: 'Im Chat-Auswahlmenü anzeigen', addProvider: 'Anbieter hinzufügen', editProvider: 'Anbieter bearbeiten', providerName: 'Anbietername', providerNameHelp: 'Eindeutiger Name zur Identifizierung dieses Anbieters in Copilot', apiTypeHelp: 'Von diesem Anbieter verwendetes API-Protokoll', baseUrlHelp: 'API-Endpunkt', apiKeyHelp: 'Beim Bearbeiten leer lassen, um den vorhandenen Schlüssel beizubehalten', cancel: 'Abbrechen', save: 'Speichern', saveProvider: 'Anbieter speichern', editModel: 'Modell bearbeiten', modelId: 'Modell-ID', displayName: 'Anzeigename', contextLength: 'Kontextlänge', maxTokens: 'Max. Tokens', visionSupport: 'Vision-Unterstützung', toolCalling: 'Tool-Aufrufe', transformThinkTags: 'Think-Tags umwandeln (<|im_start|>/♩)', samplingMode: 'Sampling-Modus', samplingBoth: 'Beide (temperature + top_p)', samplingTemperature: 'Nur Temperature', samplingTopP: 'Nur Top P', samplingNone: 'Keine', samplingHelp: 'Einige Modelle (z. B. Claude) akzeptieren jeweils nur einen Sampling-Parameter', saveModel: 'Modell speichern', chatHistorySettings: 'Chatverlauf-Einstellungen', autoSaveChatHistory: 'Chatverlauf automatisch speichern', chatHistoryHelp: 'Chatunterhaltungen automatisch in lokalen Dateien speichern', savePath: 'Speicherpfad', savePathPlaceholder: 'Pfad zum Speichern des Chatverlaufs', defaultSavePathHelp: 'Standard: Windows: %APPDATA%/LLSOAI, macOS/Linux: ~/.LLSOAI', editSystemPrompt: 'System-Prompt bearbeiten', globalSystemPrompt: 'Globaler System-Prompt', globalSystemPromptPlaceholder: 'Globalen System-Prompt hier eingeben...', globalSystemPromptHelp: 'Gilt für alle Arbeitsbereiche und wird in globalen Einstellungen gespeichert.', projectSystemPrompt: 'Projekt-System-Prompt', projectWorkspaceSystemPrompt: 'Projekt-/Arbeitsbereich-System-Prompt', projectSystemPromptPlaceholder: 'Projektspezifischen System-Prompt hier eingeben...', projectSystemPromptHelp: 'Gilt nur für den aktuellen Arbeitsbereich und wird in Arbeitsbereichseinstellungen gespeichert.', chatHistory: 'Chatverlauf', expertMode: 'Expertenmodus', enableExpertMode: 'Expertenmodus aktivieren', expertModeHelp: 'Wenn aktiviert, kann das Hauptmodell schwierige Aufgaben an das ausgewählte Expertenmodell delegieren.', expertProvider: 'Expertenanbieter', expertModel: 'Expertenmodell', expertSelectProvider: 'Anbieter auswählen', expertSelectModel: 'Modell auswählen', expertProjectDescription: 'Konfigurieren Sie, wie dieses Projekt das LLSOAI-Expertenmodell verwendet.', expertGlobalStatus: 'Global {state}', expertUseGlobal: 'Globale Einstellungen verwenden', expertFollowGlobalState: 'Globalem Status folgen: {state}', expertForceEnabledDesc: 'Expertenmodus für dieses Projekt erzwingen.', expertForceDisabledDesc: 'Expertenmodus für dieses Projekt deaktivieren erzwingen.', expertUseGlobalProvider: 'Globalen Expertenanbieter verwenden ({value})', expertUseGlobalModel: 'Globales Expertenmodell verwenden ({value})', expertModelOverrideHelp: 'Wählen Sie sowohl Anbieter als auch Modell aus, um das globale Expertenmodell zu überschreiben. Lassen Sie eines davon leer, um weiterhin das globale Expertenmodell zu verwenden.', enhancedTodo: 'Erweitertes TODO', enableEnhancedTodo: 'Erweitertes TODO aktivieren', enhancedTodoHelp: 'Wenn aktiviert, werden TODOs automatisch im Projektverzeichnis gespeichert; beim Erstellen neuer TODOs wird auf unvollständige TODOs geprüft.', copilotRecords: 'Copilot-Datensätze', copilotRecordsHelp: 'Chatdatensätze aus VS Code Copilot importieren/exportieren', importRecords: 'Datensätze importieren', exportRecords: 'Datensätze exportieren', saveAll: 'Alle speichern', errorExtensionNotInitialized: 'Fehler: Erweiterung nicht initialisiert', modelIdRequired: 'Modell-ID ist erforderlich', enterProviderName: 'Bitte Anbietername eingeben', enterBaseUrl: 'Bitte Base URL eingeben', enterApiKey: 'Bitte API Key für neue Anbieter eingeben', chatHistoryEnabled: 'Aktiviert', chatHistoryDisabled: 'Deaktiviert', adLabel: 'Anzeige'
	};

	function t(key) {
		return translations[currentLanguage]?.[key] || translations.en[key] || key;
	}

	function formatTranslation(template, values) {
		return String(template).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? '');
	}

	function getI18nTemplateValues(el) {
		const values = {};
		Object.keys(el.dataset || {}).forEach(key => {
			if (!key.startsWith('i18nValue')) return;
			const name = key.slice('i18nValue'.length);
			if (!name) return;
			const valueName = name.charAt(0).toLowerCase() + name.slice(1);
			values[valueName] = el.dataset[key];
		});
		Object.keys(el.dataset || {}).forEach(key => {
			if (!key.startsWith('i18nKey')) return;
			const name = key.slice('i18nKey'.length);
			if (!name) return;
			const valueName = name.charAt(0).toLowerCase() + name.slice(1);
			values[valueName] = t(el.dataset[key]);
		});
		return values;
	}

	function applyI18n() {
		document.documentElement.lang = currentLanguage;
		document.querySelectorAll('[data-i18n]').forEach(el => {
			el.textContent = t(el.dataset.i18n);
		});
		document.querySelectorAll('[data-i18n-template]').forEach(el => {
			el.textContent = formatTranslation(t(el.dataset.i18nTemplate), getI18nTemplateValues(el));
		});
		document.querySelectorAll('[data-i18n-title]').forEach(el => {
			el.setAttribute('title', t(el.dataset.i18nTitle));
		});
		document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
			el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
		});
		document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
			el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
		});
	}

	// DOM Elements
	const providersList = document.getElementById('providersList');
	const providerModal = document.getElementById('providerModal');
	const modalTitle = document.getElementById('modalTitle');
	const providerForm = document.getElementById('providerForm');
	const providerId = document.getElementById('providerId');
	const providerName = document.getElementById('providerName');
	const providerApiType = document.getElementById('providerApiType');
	const providerBaseUrl = document.getElementById('providerBaseUrl');
	const providerApiKey = document.getElementById('providerApiKey');
	const providerAutoFetchModels = document.getElementById('providerAutoFetchModels');
	const addProviderBtn = document.getElementById('addProviderBtn');
	const closeModal = document.getElementById('closeModal');
	const cancelBtn = document.getElementById('cancelBtn');
	const importBtn = document.getElementById('importBtn');
	const exportBtn = document.getElementById('exportBtn');
	const settingsBtn = document.getElementById('settingsBtn');
	const testChatBtn = document.getElementById('testChatBtn');
	const exportRecordsBtn = document.getElementById('exportRecordsBtn');
	const importRecordsBtn = document.getElementById('importRecordsBtn');
	const settingsModal = document.getElementById('settingsModal');
	const closeSettingsModal = document.getElementById('closeSettingsModal');
	const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
	const saveSettingsBtn = document.getElementById('saveSettingsBtn');
	const chatHistoryEnabled = document.getElementById('chatHistoryEnabled');
	const chatHistorySavePath = document.getElementById('chatHistorySavePath');
	const editModelModal = document.getElementById('editModelModal');
	const systemPromptModal = document.getElementById('systemPromptModal');
	const closeSystemPromptModal = document.getElementById('closeSystemPromptModal');
	const cancelSystemPromptBtn = document.getElementById('cancelSystemPromptBtn');
	const saveSystemPromptBtn = document.getElementById('saveSystemPromptBtn');
	const globalSystemPromptTextarea = document.getElementById('globalSystemPromptTextarea');
	const workspaceSystemPromptTextarea = document.getElementById('workspaceSystemPromptTextarea');
	const editSystemPromptBtn = document.getElementById('editSystemPromptBtn');
	const closeEditModelBtn = document.getElementById('closeEditModelBtn');
	const cancelEditModelBtn = document.getElementById('cancelEditModelBtn');
	const saveEditModelBtn = document.getElementById('saveEditModelBtn');

	// Global Settings Modal
	const globalSettingsModal = document.getElementById('globalSettingsModal');
	const closeGlobalSettingsModal = document.getElementById('closeGlobalSettingsModal');
	const cancelGlobalSettingsBtn = document.getElementById('cancelGlobalSettingsBtn');
	const saveGlobalSettingsBtn = document.getElementById('saveGlobalSettingsBtn');
	const modalGlobalSystemPrompt = document.getElementById('modalGlobalSystemPrompt');
	const modalChatHistoryEnabled = document.getElementById('modalChatHistoryEnabled');
	const modalChatHistorySavePath = document.getElementById('modalChatHistorySavePath');
	const modalExpertModeEnabled = document.getElementById('modalExpertModeEnabled');
	const modalExpertModeProvider = document.getElementById('modalExpertModeProvider');
	const modalExpertModeModel = document.getElementById('modalExpertModeModel');
	const modalImportRecordsBtn = document.getElementById('modalImportRecordsBtn');
	const modalExportRecordsBtn = document.getElementById('modalExportRecordsBtn');
	
	// Project Settings Modal
	const projectSettingsModal = document.getElementById('projectSettingsModal');
	const closeProjectSettingsModal = document.getElementById('closeProjectSettingsModal');
	const cancelProjectSettingsBtn = document.getElementById('cancelProjectSettingsBtn');
	const saveProjectSettingsBtn = document.getElementById('saveProjectSettingsBtn');
	const modalProjectSystemPrompt = document.getElementById('modalProjectSystemPrompt');

	// Collapsible sections
	const globalSettingsHeader = document.getElementById('globalSettingsHeader');
	const globalSettingsContent = document.getElementById('globalSettingsContent');
	const projectSettingsHeader = document.getElementById('projectSettingsHeader');
	// Settings buttons
	const openGlobalSettingsBtn = document.getElementById('openGlobalSettingsBtn');
	const openProjectSettingsBtn = document.getElementById('openProjectSettingsBtn');
	const languageSelect = document.getElementById('languageSelect');
	const chatHistoryStatus = document.getElementById('chatHistoryStatus');
	const isPanelMode = !!document.getElementById('panelSaveBtn');

	// Initialize
	vscode.postMessage({ command: 'getLanguageSettings' });
	if (isPanelMode) {
		if (window.settingsMode === 'global') {
			vscode.postMessage({ command: 'getChatHistorySettings' });
			vscode.postMessage({ command: 'getExpertModeSettings' });
			vscode.postMessage({ command: 'getSystemPrompt' });
		} else if (window.settingsMode === 'project') {
			vscode.postMessage({ command: 'getSystemPrompt' });
		}
	} else {
		vscode.postMessage({ command: 'getProviders' });
		vscode.postMessage({ command: 'getChatHistorySettings' });
		vscode.postMessage({ command: 'getExpertModeSettings' });
		vscode.postMessage({ command: 'getSystemPrompt' });
	}
	setupEventListeners();

	function setupEventListeners() {
		if (isPanelMode) {
			setupPanelEventListeners();
			return;
		}

		addProviderBtn.addEventListener('click', () => openAddProviderModal());
		closeModal.addEventListener('click', () => closeProviderModal());
		cancelBtn.addEventListener('click', () => closeProviderModal());
		closeEditModelBtn?.addEventListener('click', () => {
			editModelModal?.classList.remove('active');
		});
		cancelEditModelBtn?.addEventListener('click', () => {
			editModelModal?.classList.remove('active');
		});
		saveEditModelBtn?.addEventListener('click', () => {
			saveEditedModel();
		});
		importBtn.addEventListener('click', () => vscode.postMessage({ command: 'importConfig' }));
		exportBtn.addEventListener('click', () => vscode.postMessage({ command: 'exportConfig' }));
		languageSelect?.addEventListener('change', () => {
			configuredLanguage = languageSelect.value || 'auto';
			vscode.postMessage({
				command: 'updateLanguageSettings',
				data: { language: configuredLanguage }
			});
		});
		
		// Settings modal
		settingsBtn?.addEventListener('click', () => openSettingsModal());
		closeSettingsModal?.addEventListener('click', () => closeSettingsModalFn());
		cancelSettingsBtn?.addEventListener('click', () => closeSettingsModalFn());
		saveSettingsBtn?.addEventListener('click', () => saveSettings());
		
		// Test chat button
		testChatBtn?.addEventListener('click', () => {
			vscode.postMessage({ command: 'testNewChat' });
		});
		
		// Chat records buttons
		exportRecordsBtn?.addEventListener('click', () => {
			vscode.postMessage({ command: 'exportRecords' });
		});
		importRecordsBtn?.addEventListener('click', () => {
			vscode.postMessage({ command: 'importRecords' });
		});
		
		// System Prompt modal
		editSystemPromptBtn?.addEventListener('click', () => openSystemPromptModal());
		closeSystemPromptModal?.addEventListener('click', () => closeSystemPromptModalFn());
		cancelSystemPromptBtn?.addEventListener('click', () => closeSystemPromptModalFn());
		saveSystemPromptBtn?.addEventListener('click', () => saveSystemPrompt());
		
		// Settings buttons - Global Settings (open in editor tab)
		openGlobalSettingsBtn?.addEventListener('click', () => vscode.postMessage({ command: 'openGlobalSettingsTab' }));
		closeGlobalSettingsModal?.addEventListener('click', () => closeGlobalSettingsModalFn());
		cancelGlobalSettingsBtn?.addEventListener('click', () => closeGlobalSettingsModalFn());
		saveGlobalSettingsBtn?.addEventListener('click', () => saveGlobalSettings());
		modalImportRecordsBtn?.addEventListener('click', () => vscode.postMessage({ command: 'importRecords' }));
		modalExportRecordsBtn?.addEventListener('click', () => vscode.postMessage({ command: 'exportRecords' }));
		modalExpertModeProvider?.addEventListener('change', () => {
			expertModeSettings.providerId = modalExpertModeProvider.value || '';
			expertModeSettings.modelId = '';
			populateExpertModeModels(modalExpertModeProvider, modalExpertModeModel, expertModeSettings.modelId);
		});
		
		// Settings buttons - Project Settings (open in editor tab)
		openProjectSettingsBtn?.addEventListener('click', () => vscode.postMessage({ command: 'openProjectSettingsTab' }));
		closeProjectSettingsModal?.addEventListener('click', () => closeProjectSettingsModalFn());
		cancelProjectSettingsBtn?.addEventListener('click', () => closeProjectSettingsModalFn());
		saveProjectSettingsBtn?.addEventListener('click', () => saveProjectSettings());
		
		providerForm.addEventListener('submit', (e) => {
			e.preventDefault();
			saveProvider();
		});
		
		// Event delegation for dynamically created buttons
		providersList.addEventListener('click', (e) => {
			const target = e.target.closest('button');
			if (!target) {
				// Check for models toggle button (might be clicking the icon span)
				const toggleIcon = e.target.closest('.toggle-icon');
				if (toggleIcon) {
					const toggleBtn = toggleIcon.closest('.models-toggle-btn');
					if (toggleBtn) {
						toggleModelsList(toggleBtn.dataset.providerId);
					}
				}
				return;
			}
			
			console.log('[configView] Button clicked:', target.className, 'data-id:', target.dataset.id);
			
			if (target.classList.contains('models-toggle-btn')) {
				toggleModelsList(target.dataset.providerId);
			} else if (target.classList.contains('edit-btn')) {
				const id = target.dataset.id;
				if (id) editProvider(id);
			} else if (target.classList.contains('delete-btn')) {
				const id = target.dataset.id;
				if (id) deleteProvider(id);
			} else if (target.classList.contains('edit-model-btn')) {
				// Edit model in provider list
				const modelId = target.dataset.modelId;
				const providerId = target.dataset.providerId;
				if (modelId && providerId) editModelInProvider(providerId, modelId);
			} else if (target.classList.contains('fetch-models-btn')) {
				// Manually fetch models for this provider
				if (target.disabled) return; // Ignore clicks while loading
				const providerId = target.dataset.providerId;
				if (providerId) vscode.postMessage({ command: 'fetchProviderModels', data: { id: providerId } });
			} else if (target.classList.contains('add-model-btn')) {
				// Add new model to provider
				if (target.disabled) return; // Ignore clicks while loading
				const providerId = target.dataset.providerId;
				if (providerId) addModelToProvider(providerId);
			} else if (target.classList.contains('delete-model-btn')) {
				// Delete model from provider list
				const modelId = target.dataset.modelId;
				const providerId = target.dataset.providerId;
				if (modelId && providerId) deleteModelFromProvider(providerId, modelId);
			} else if (target.closest('.toggle')) {
				// Exclude auto-fetch toggle (handled by change event) and model selector toggle
				const toggle = target.closest('.toggle');
				if (toggle.classList.contains('auto-fetch-toggle') || toggle.classList.contains('model-toggle')) {
					return;
				}
				const checkbox = toggle.querySelector('input[type="checkbox"]');
				if (checkbox) {
					const id = checkbox.closest('.provider-card')?.dataset.id;
					if (id) {
						vscode.postMessage({
							command: 'toggleProvider',
							data: { id, enabled: checkbox.checked },
						});
					}
				}
			}
		});
		
		// Handle checkbox toggle
		providersList.addEventListener('change', (e) => {
			const checkbox = e.target.closest('input[type="checkbox"]');
			if (!checkbox) return;
			
			// Check if it's a model selector toggle
			if (checkbox.classList.contains('model-selector-toggle')) {
				const modelId = checkbox.dataset.modelId;
				const providerId = checkbox.dataset.providerId;
				if (!modelId || !providerId) return;
				
				const provider = providers.find(p => p.id === providerId);
				if (!provider) return;
				
				const models = provider.models || provider.apiModels || [];
				const modelIndex = models.findIndex(m => m.modelId === modelId);
				if (modelIndex < 0) return;
				
				models[modelIndex].isUserSelectable = checkbox.checked;
				
				vscode.postMessage({
					command: 'updateProvider',
					data: {
						id: providerId,
						models: models,
					},
				});
				// Re-render to preserve expand state
				renderProviders();
				return;
			}
			
			// Check if it's an auto-fetch toggle
			if (checkbox.classList.contains('auto-fetch-checkbox')) {
				const id = checkbox.dataset.id;
				if (!id) return;
				
				// Update local state first to prevent visual revert on re-render
				const provider = providers.find(p => p.id === id);
				if (provider) {
					provider.autoFetchModels = checkbox.checked;
				}
				
				vscode.postMessage({
					command: 'toggleAutoFetchModels',
					data: { id, autoFetchModels: checkbox.checked },
				});
				// Re-render to preserve expand state
				renderProviders();
				return;
			}
			
			const card = checkbox.closest('.provider-card');
			if (!card) return;
			const id = card.dataset.id;
			if (!id) return;
			vscode.postMessage({
				command: 'toggleProvider',
				data: { id, enabled: checkbox.checked },
			});
		});
		
		// Panel mode button handlers (Editor Tab)
		const panelCancelBtn = document.getElementById('panelCancelBtn');
		const panelSaveBtn = document.getElementById('panelSaveBtn');
		const panelImportRecordsBtn = document.getElementById('panelImportRecordsBtn');
		const panelExportRecordsBtn = document.getElementById('panelExportRecordsBtn');
		const panelExpertModeProvider = document.getElementById('panelExpertModeProvider');
		const panelExpertModeModel = document.getElementById('panelExpertModeModel');

		if (window.panelProviders) {
			providers = window.panelProviders;
			expertModeSettings = window.panelExpertModeSettings || expertModeSettings;
			populateExpertModeProviders(panelExpertModeProvider, expertModeSettings.providerId);
			populateExpertModeModels(panelExpertModeProvider, panelExpertModeModel, expertModeSettings.modelId);
		}
		
		if (panelCancelBtn) {
			panelCancelBtn.addEventListener('click', () => {
				vscode.postMessage({ command: 'cancelPanel' });
			});
		}
		
		if (panelSaveBtn) {
			panelSaveBtn.addEventListener('click', () => {
				const mode = window.settingsMode;
				if (mode === 'global') {
					const globalSystemPrompt = document.getElementById('panelGlobalSystemPrompt')?.value || '';
					const chatHistoryEnabled = document.getElementById('panelChatHistoryEnabled')?.checked || false;
					const chatHistorySavePath = document.getElementById('panelChatHistorySavePath')?.value || '';
					vscode.postMessage({
						command: 'saveGlobalSettings',
						data: {
							globalSystemPrompt,
							chatHistoryEnabled,
							chatHistorySavePath
						}
					});
				} else if (mode === 'project') {
					const projectSystemPrompt = document.getElementById('panelProjectSystemPrompt')?.value || '';
					const expertModeEnabledState = document.querySelector('input[name="panelExpertModeEnabledState"]:checked')?.value || 'global';
					const expertModeProviderId = document.getElementById('panelExpertModeProvider')?.value || '';
					const expertModeModelId = document.getElementById('panelExpertModeModel')?.value || '';
					vscode.postMessage({
						command: 'saveProjectSettings',
						data: {
							projectSystemPrompt,
							expertModeEnabledState,
							expertModeProviderId,
							expertModeModelId
						}
					});
				}
			});
		}
		
		if (panelImportRecordsBtn) {
			panelImportRecordsBtn.addEventListener('click', () => {
				vscode.postMessage({ command: 'importRecords' });
			});
		}
		
		if (panelExportRecordsBtn) {
			panelExportRecordsBtn.addEventListener('click', () => {
				vscode.postMessage({ command: 'exportRecords' });
			});
		}
	}

	function setupPanelEventListeners() {
		const panelCancelBtn = document.getElementById('panelCancelBtn');
		const panelSaveBtn = document.getElementById('panelSaveBtn');
		const panelImportRecordsBtn = document.getElementById('panelImportRecordsBtn');
		const panelExportRecordsBtn = document.getElementById('panelExportRecordsBtn');
		const panelExpertModeProvider = document.getElementById('panelExpertModeProvider');
		const panelExpertModeModel = document.getElementById('panelExpertModeModel');

		if (window.panelProviders) {
			providers = window.panelProviders;
			if (window.panelExpertModeSettings) {
				expertModeSettings = window.panelExpertModeSettings;
			}
			populateExpertModeProviders(panelExpertModeProvider, expertModeSettings.providerId || '');
			populateExpertModeModels(panelExpertModeProvider, panelExpertModeModel, expertModeSettings.modelId || '');
		}

		panelCancelBtn?.addEventListener('click', () => {
			vscode.postMessage({ command: 'cancelPanel' });
		});

		panelSaveBtn?.addEventListener('click', () => {
			const mode = window.settingsMode;
			if (mode === 'global') {
				const globalSystemPrompt = document.getElementById('panelGlobalSystemPrompt')?.value || '';
				const chatHistoryEnabled = document.getElementById('panelChatHistoryEnabled')?.checked || false;
				const chatHistorySavePath = document.getElementById('panelChatHistorySavePath')?.value || '';
				const forceTodoEnabled = document.getElementById('panelForceTodoEnabled')?.checked || false;
				const expertModeEnabled = document.getElementById('panelExpertModeEnabled')?.checked || false;
				const expertModeProviderId = document.getElementById('panelExpertModeProvider')?.value || '';
				const expertModeModelId = document.getElementById('panelExpertModeModel')?.value || '';
				vscode.postMessage({
					command: 'saveGlobalSettings',
					data: {
						globalSystemPrompt,
						chatHistoryEnabled,
						chatHistorySavePath,
						expertModeEnabled,
						expertModeProviderId,
						expertModeModelId,
						forceTodoEnabled
					}
				});
			} else if (mode === 'project') {
				const projectSystemPrompt = document.getElementById('panelProjectSystemPrompt')?.value || '';
				const forceTodoEnabled = document.getElementById('panelProjectForceTodoEnabled')?.checked || false;
				const expertModeEnabledState = document.querySelector('input[name="panelExpertModeEnabledState"]:checked')?.value || 'global';
				const expertModeProviderId = document.getElementById('panelExpertModeProvider')?.value || '';
				const expertModeModelId = document.getElementById('panelExpertModeModel')?.value || '';
				vscode.postMessage({
					command: 'saveProjectSettings',
					data: { projectSystemPrompt, forceTodoEnabled, expertModeEnabledState, expertModeProviderId, expertModeModelId }
				});
			}
		});

		panelImportRecordsBtn?.addEventListener('click', () => {
			vscode.postMessage({ command: 'importRecords' });
		});

		panelExportRecordsBtn?.addEventListener('click', () => {
			vscode.postMessage({ command: 'exportRecords' });
		});

		panelExpertModeProvider?.addEventListener('change', () => {
			populateExpertModeModels(panelExpertModeProvider, panelExpertModeModel, '');
		});
	}

	// Handle messages from extension
	window.addEventListener('message', (event) => {
		const message = event.data;

		switch (message.command) {
			case 'languageSettingsLoaded':
				configuredLanguage = message.data?.configuredLanguage || 'auto';
				currentLanguage = message.data?.resolvedLanguage || resolveLanguage(window.VSCODE_LOCALE);
				if (languageSelect) {
					languageSelect.value = configuredLanguage;
				}
				applyI18n();
				renderProviders();
				break;

			case 'expertModeSettingsLoaded':
				if (message.data) {
					expertModeSettings = message.data.settings || { enabled: false, providerId: '', modelId: '' };
					if (message.data.providers) {
						expertSelectableProviders = message.data.providers;
					}
					updateExpertModeControls();
				}
				break;

			case 'providersLoaded':
				providers = message.data || [];
				// Only mark providers as loading on initial load (triggered by getProviders)
				// Subsequent providersLoaded messages (from updateProvider, toggleProvider, etc.)
				// should not reset loading state for all providers
				if (isInitialLoad) {
					isInitialLoad = false;
					providers.forEach(p => {
						if (p.enabled && p.hasApiKey && p.autoFetchModels !== false) {
							loadingProviders.add(p.id);
						}
					});
				}
				// Expand newly added provider
				if (newlyAddedProviderId) {
					expandedProviders.add(newlyAddedProviderId);
					newlyAddedProviderId = null;
				}
				renderProviders();
				break;

			case 'providerModelsLoading':
				// Set loading state for manual fetch
				if (message.data.loading) {
					loadingProviders.add(message.data.providerId);
					renderProviders();
				}
				break;

			case 'providerModelsUpdated':
				// Async model fetch completed, update the provider's models
				const { providerId, models } = message.data;
				const provider = providers.find(p => p.id === providerId);
				if (provider) {
					provider.models = models;
				}
				// Remove from loading set
				loadingProviders.delete(providerId);
				renderProviders();
				break;

			case 'providerAdded':
				if (!message.success) {
					alert(`Failed to add provider: ${message.error}`);
				} else if (message.data?.id) {
					// Store the newly added provider ID to expand after providersLoaded
					newlyAddedProviderId = message.data.id;
				}
				break;

			case 'chatHistorySettingsLoaded':
				if (message.data) {
					if (chatHistoryEnabled) {
						chatHistoryEnabled.checked = message.data.enabled;
					}
					if (chatHistorySavePath) {
						chatHistorySavePath.value = message.data.savePath || '';
					}
					const panelChatHistoryEnabled = document.getElementById('panelChatHistoryEnabled');
					const panelChatHistorySavePath = document.getElementById('panelChatHistorySavePath');
					if (panelChatHistoryEnabled) {
						panelChatHistoryEnabled.checked = message.data.enabled;
					}
					if (panelChatHistorySavePath) {
						panelChatHistorySavePath.value = message.data.savePath || '';
					}
					
					// Update the chat history status display
					if (chatHistoryStatus) {
						chatHistoryStatus.textContent = message.data.enabled ? t('chatHistoryEnabled') : t('chatHistoryDisabled');
					}
					
					// Also update the modal fields for unified global settings modal
					if (modalChatHistoryEnabled) {
						modalChatHistoryEnabled.checked = message.data.enabled;
					}
					if (modalChatHistorySavePath) {
						modalChatHistorySavePath.value = message.data.savePath || '';
					}
				}
				break;
		case 'systemPromptLoaded':
			if (message.data) {
				if (globalSystemPromptTextarea) {
					globalSystemPromptTextarea.value = message.data.globalPrompt || '';
				}
				if (workspaceSystemPromptTextarea) {
					workspaceSystemPromptTextarea.value = message.data.workspacePrompt || '';
				}
				const panelGlobalSystemPrompt = document.getElementById('panelGlobalSystemPrompt');
				const panelProjectSystemPrompt = document.getElementById('panelProjectSystemPrompt');
				if (panelGlobalSystemPrompt) {
					panelGlobalSystemPrompt.value = message.data.globalPrompt || '';
				}
				if (panelProjectSystemPrompt) {
					panelProjectSystemPrompt.value = message.data.workspacePrompt || '';
				}
				
				// Also update the modal fields for unified modals
				if (modalGlobalSystemPrompt) {
					modalGlobalSystemPrompt.value = message.data.globalPrompt || '';
				}
				if (modalProjectSystemPrompt) {
					modalProjectSystemPrompt.value = message.data.workspacePrompt || '';
				}
			}
			break;

		case 'systemPromptSaved':
			// Saved successfully, nothing to update in UI
			break;
		}
	});

	// Render providers list
	function renderProviders() {
		// Update provider count badge
		const countEl = document.getElementById('providerCount');
		if (countEl) {
			countEl.textContent = providers.length > 0 ? providers.length : '';
		}

		if (providers.length === 0) {
			providersList.innerHTML = `
				<div class="empty-state">
					<p>${t('noProviders')}</p>
					<button class="primary-btn" onclick="document.getElementById('addProviderBtn').click()">${t('addFirstProvider')}</button>
				</div>
			`;
			return;
		}

		providersList.innerHTML = providers.map(provider => `
			<div class="provider-card" data-id="${provider.id}">
				<div class="provider-header">
					<span class="provider-name">${escapeHtml(provider.name)}</span>
					<div class="provider-status">
						<span class="status-badge ${provider.enabled ? 'enabled' : 'disabled'}">
							${provider.enabled ? t('enabled') : t('disabled')}
						</span>
						<label class="toggle">
							<input type="checkbox" ${provider.enabled ? 'checked' : ''} data-id="${provider.id}">
							<span class="toggle-slider"></span>
						</label>
					</div>
				</div>
				<div class="provider-details">
					<div class="provider-detail-item">
						<span class="provider-detail-label">${t('apiType')}</span>
						<span>${provider.apiType === 'anthropic' ? 'Anthropic' : provider.apiType === 'v1-response' ? 'v1 Response' : 'OpenAI-Compatible'}</span>
					</div>
					<div class="provider-detail-item">
						<span class="provider-detail-label">${t('baseUrl')}</span>
						<span>${escapeHtml(provider.baseUrl)}</span>
					</div>
					<div class="provider-detail-item">
						<span class="provider-detail-label">${t('apiKey')}</span>
						<span>${provider.hasApiKey ? t('configured') : t('notSet')}</span>
					</div>
					<div class="provider-detail-item">
						<span class="provider-detail-label">${t('autoFetchModels')}</span>
						<label class="toggle auto-fetch-toggle" title="${t('autoFetchModelsTitle')}">
							<input type="checkbox" class="auto-fetch-checkbox" ${provider.autoFetchModels !== false ? 'checked' : ''} data-id="${provider.id}">
							<span class="toggle-slider"></span>
						</label>
					</div>
				</div>
				${(provider.models || provider.apiModels) && (provider.models || provider.apiModels).length > 0 ? `
					<div class="provider-models">
						<h4 class="models-header">
							<span>${t('models')} (${(provider.models || provider.apiModels).length})</span>
							<button class="models-toggle-btn" data-provider-id="${provider.id}">
								<span class="toggle-icon">${expandedProviders.has(provider.id) ? '▼' : '▶'}</span>
							</button>
						</h4>
						<div class="models-list" data-provider-id="${provider.id}" style="display: ${expandedProviders.has(provider.id) ? 'flex' : 'none'};">
							${(provider.models || provider.apiModels).map(m => `
								<div class="model-item" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}">
									<span class="model-item-name">${escapeHtml(m.displayName || m.modelId)}</span>
									<div class="model-item-actions">
										<label class="toggle model-toggle" title="${t('showInChatSelector')}">
											<input type="checkbox" class="model-selector-toggle" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}" ${m.isUserSelectable === true ? 'checked' : ''}>
											<span class="toggle-slider"></span>
										</label>
										<button class="model-item-btn edit-model-btn" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}">${t('edit')}</button>
										<button class="model-item-btn delete delete-model-btn" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}">${t('delete')}</button>
									</div>
								</div>
							`).join('')}
						</div>
					</div>
				` : (provider.enabled && provider.hasApiKey && provider.autoFetchModels !== false && loadingProviders.has(provider.id))
					? `<div class="provider-detail-item"><span class="provider-detail-label">${t('models')}</span><span class="loading-text"><span class="loading-spinner"></span> ${t('fetchingModels')}</span></div>`
					: `<div class="provider-detail-item"><span class="provider-detail-label">${t('models')}</span><span>${t('noModels')}</span></div>`}
				<div class="provider-actions">
					<button class="secondary-btn edit-btn" data-id="${provider.id}">${t('edit')}</button>
					<button class="secondary-btn delete-btn" data-id="${provider.id}">${t('delete')}</button>
					${provider.autoFetchModels !== false ? `
						<button class="primary-btn fetch-models-btn" data-provider-id="${provider.id}" ${loadingProviders.has(provider.id) ? 'disabled' : ''}>
							${loadingProviders.has(provider.id) ? `<span class="btn-loading"><span class="btn-spinner"></span> ${t('loading')}</span>` : t('fetchModels')}
						</button>
					` : `
						<button class="primary-btn add-model-btn" data-provider-id="${provider.id}" ${loadingProviders.has(provider.id) ? 'disabled' : ''}>
							${loadingProviders.has(provider.id) ? `<span class="btn-loading"><span class="btn-spinner"></span> ${t('loading')}</span>` : t('addModel')}
						</button>
					`}
				</div>
			</div>
		`).join('');
	}

	// Open modal for adding a new provider
	function openAddProviderModal() {
		editingProviderId = null;
		modalTitle.textContent = t('addProvider');
		providerId.value = '';
		providerName.value = '';
		providerApiType.value = 'openai-compatible';
		providerBaseUrl.value = '';
		providerApiKey.value = '';
		providerAutoFetchModels.checked = true;
		providerModal.classList.add('active');
	}

	// Open modal for editing a provider
	function editProvider(id) {
		const provider = providers.find(p => p.id === id);
		if (!provider) return;

		editingProviderId = id;
		modalTitle.textContent = t('editProvider');
		providerId.value = provider.id;
		providerName.value = provider.name;
		providerApiType.value = provider.apiType || 'openai-compatible';
		providerBaseUrl.value = provider.baseUrl;
		providerApiKey.value = ''; // Don't show existing key
		providerAutoFetchModels.checked = provider.autoFetchModels !== false;
		// Ensure models list remains expanded
		expandedProviders.add(id);
		providerModal.classList.add('active');
	};

	// Close the modal
	function closeProviderModal() {
		providerModal.classList.remove('active');
		providerForm.reset();
		editingProviderId = null;
	}

	// Delete provider - confirmation handled by backend
	function deleteProvider(id) {
		if (!id) {
			console.error('[configView] deleteProvider: no id provided');
			return;
		}
		
		console.log('[configView] deleteProvider: sending delete request for id:', id);
		
		vscode.postMessage({
			command: 'deleteProvider',
			data: id
		});
	}

	// Add a new model to a provider
	function addModelToProvider(providerId) {
		const provider = providers.find(p => p.id === providerId);
		if (!provider) return;
		
		editingModelProviderId = providerId;
		editingModelIndex = -1; // -1 means new model
		editingModelData = {
			modelId: '',
			displayName: '',
			contextLength: 128000,
			maxTokens: 16000,
			vision: false,
			toolCalling: true,
			temperature: 0.7,
			topP: 1.0,
			samplingMode: 'both',
			isUserSelectable: false,
			transformThink: false,
		};
		
		const modelName = document.getElementById('editModelName');
		const modelDisplayName = document.getElementById('editModelDisplayName');
		const modelContextLength = document.getElementById('editModelContextLength');
		const modelMaxTokens = document.getElementById('editModelMaxTokens');
		const modelVision = document.getElementById('editModelVision');
		const modelToolCalling = document.getElementById('editModelToolCalling');
		const modelTemperature = document.getElementById('editModelTemperature');
		const modelTopP = document.getElementById('editModelTopP');
		const modelSamplingMode = document.getElementById('editModelSamplingMode');
		const modelUserSelectable = document.getElementById('editModelUserSelectable');
		const modelTransformThink = document.getElementById('editModelTransformThink');
		
		if (modelName) modelName.value = '';
		if (modelDisplayName) modelDisplayName.value = '';
		if (modelContextLength) modelContextLength.value = 128000;
		if (modelMaxTokens) modelMaxTokens.value = 16000;
		if (modelVision) modelVision.checked = false;
		if (modelToolCalling) modelToolCalling.checked = true;
		if (modelTemperature) modelTemperature.value = 0.7;
		if (modelTopP) modelTopP.value = 1.0;
		if (modelSamplingMode) modelSamplingMode.value = 'both';
		if (modelUserSelectable) modelUserSelectable.checked = false;
		if (modelTransformThink) modelTransformThink.checked = false;
		
		// Ensure models list remains expanded
		expandedProviders.add(providerId);
		
		const editModelModal = document.getElementById('editModelModal');
		if (editModelModal) {
			editModelModal.classList.add('active');
		}
	}

	// Edit a model directly from the provider list
	function editModelInProvider(providerId, modelId) {
		const provider = providers.find(p => p.id === providerId);
		if (!provider) return;
		
		const models = provider.models || provider.apiModels || [];
		const modelIndex = models.findIndex(m => m.modelId === modelId);
		if (modelIndex < 0) return;
		
		editingModelProviderId = providerId;
		editingModelIndex = modelIndex;
		editingModelData = JSON.parse(JSON.stringify(models[modelIndex]));
		
		const modelName = document.getElementById('editModelName');
		const modelDisplayName = document.getElementById('editModelDisplayName');
		const modelContextLength = document.getElementById('editModelContextLength');
		const modelMaxTokens = document.getElementById('editModelMaxTokens');
		const modelVision = document.getElementById('editModelVision');
		const modelToolCalling = document.getElementById('editModelToolCalling');
		const modelTemperature = document.getElementById('editModelTemperature');
		const modelTopP = document.getElementById('editModelTopP');
		const modelSamplingMode = document.getElementById('editModelSamplingMode');
		const modelUserSelectable = document.getElementById('editModelUserSelectable');
		const modelTransformThink = document.getElementById('editModelTransformThink');
		
		if (modelName) modelName.value = editingModelData.modelId || '';
		if (modelDisplayName) modelDisplayName.value = editingModelData.displayName || '';
		if (modelContextLength) modelContextLength.value = editingModelData.contextLength || 128000;
		if (modelMaxTokens) modelMaxTokens.value = editingModelData.maxTokens || 16000;
		if (modelVision) modelVision.checked = editingModelData.vision || false;
		if (modelToolCalling) modelToolCalling.checked = editingModelData.toolCalling ?? true;
		if (modelTemperature) modelTemperature.value = editingModelData.temperature ?? 0.7;
		if (modelTopP) modelTopP.value = editingModelData.topP ?? 1.0;
		if (modelSamplingMode) modelSamplingMode.value = editingModelData.samplingMode ?? 'both';
		if (modelUserSelectable) modelUserSelectable.checked = editingModelData.isUserSelectable ?? false;
		if (modelTransformThink) modelTransformThink.checked = editingModelData.transformThink ?? false;
		
		// Ensure provider remains expanded when editing
		expandedProviders.add(providerId);
		
		const editModelModal = document.getElementById('editModelModal');
		if (editModelModal) {
			editModelModal.classList.add('active');
		}
	}
	
	// Save edited model
	function saveEditedModel() {
		const modelName = document.getElementById('editModelName');
		const modelDisplayName = document.getElementById('editModelDisplayName');
		const modelContextLength = document.getElementById('editModelContextLength');
		const modelMaxTokens = document.getElementById('editModelMaxTokens');
		const modelVision = document.getElementById('editModelVision');
		const modelToolCalling = document.getElementById('editModelToolCalling');
		const modelTemperature = document.getElementById('editModelTemperature');
		const modelTopP = document.getElementById('editModelTopP');
		const modelSamplingMode = document.getElementById('editModelSamplingMode');
		const modelUserSelectable = document.getElementById('editModelUserSelectable');
		const modelTransformThink = document.getElementById('editModelTransformThink');
		
		if (!modelName || !modelName.value.trim()) {
			alert(t('modelIdRequired'));
			return;
		}
		
		editingModelData.modelId = modelName.value.trim();
		editingModelData.displayName = modelDisplayName?.value.trim() || '';
		editingModelData.contextLength = parseInt(modelContextLength?.value, 10) || 128000;
		editingModelData.maxTokens = parseInt(modelMaxTokens?.value, 10) || 16000;
		editingModelData.vision = modelVision?.checked || false;
		editingModelData.toolCalling = modelToolCalling?.checked ?? true;
		editingModelData.temperature = parseFloat(modelTemperature?.value) ?? 0.7;
		editingModelData.topP = parseFloat(modelTopP?.value) ?? 1.0;
		editingModelData.samplingMode = modelSamplingMode?.value || 'both';
		editingModelData.isUserSelectable = modelUserSelectable?.checked ?? true;
		editingModelData.transformThink = modelTransformThink?.checked ?? false;
		
		// Update the provider
		const provider = providers.find(p => p.id === editingModelProviderId);
		if (provider) {
			const models = provider.models || provider.apiModels || [];
			if (editingModelIndex >= 0) {
				// Edit existing model
				models[editingModelIndex] = editingModelData;
			} else {
				// Add new model
				models.push(editingModelData);
			}
			
			vscode.postMessage({
				command: 'updateProvider',
				data: {
					id: editingModelProviderId,
					models: models,
				},
			});
		}
		
		// Close modal
		const editModelModal = document.getElementById('editModelModal');
		if (editModelModal) {
			editModelModal.classList.remove('active');
		}
		
		// Re-render to preserve expand state
		renderProviders();
	}

	// Toggle models list visibility
	function toggleModelsList(providerId) {
		const modelsList = document.querySelector(`.models-list[data-provider-id="${providerId}"]`);
		const toggleIcon = document.querySelector(`.models-toggle-btn[data-provider-id="${providerId}"] .toggle-icon`);
		
		if (modelsList && toggleIcon) {
			const isHidden = modelsList.style.display === 'none';
			modelsList.style.display = isHidden ? 'flex' : 'none';
			toggleIcon.textContent = isHidden ? '▼' : '▶';
			if (isHidden) {
				expandedProviders.add(providerId);
			} else {
				expandedProviders.delete(providerId);
			}
		}
	}

	// Delete a model directly from the provider list
	function deleteModelFromProvider(providerId, modelId) {
		const provider = providers.find(p => p.id === providerId);
		if (!provider) return;
		
		const models = provider.models || provider.apiModels || [];
		const modelIndex = models.findIndex(m => m.modelId === modelId);
		if (modelIndex < 0) return;
		
		// Remove the model and send update
		const updatedModels = models.filter((_, i) => i !== modelIndex);
		
		vscode.postMessage({
			command: 'updateProvider',
			data: {
				id: providerId,
				models: updatedModels,
			},
		});
	}

	// Save provider - models will be auto-fetched by the backend
	function saveProvider() {
		const name = providerName.value.trim();
		const apiType = providerApiType.value;
		const baseUrl = providerBaseUrl.value.trim();
		const apiKey = providerApiKey.value.trim();
		const autoFetchModels = providerAutoFetchModels.checked;

		if (!name) {
			alert(t('enterProviderName'));
			return;
		}

		if (!baseUrl) {
			alert(t('enterBaseUrl'));
			return;
		}

		if (!editingProviderId && !apiKey) {
			alert(t('enterApiKey'));
			return;
		}

		const providerData = { name, apiType, baseUrl, apiKey, enabled: true, autoFetchModels };

		if (editingProviderId) {
			// Update existing provider
			vscode.postMessage({
				command: 'updateProvider',
				data: {
					id: editingProviderId,
					...providerData,
					hasApiKey: !!apiKey || true,
				},
			});
		} else {
			// Add new provider - backend will auto-fetch models
			vscode.postMessage({
				command: 'addProvider',
				data: providerData,
			});
		}

		closeProviderModal();
		// Re-render to preserve expand state
		renderProviders();
	};

	// Escape HTML to prevent XSS
	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function getProviderModels(providerId) {
		const provider = providers.find(p => p.id === providerId);
		return provider ? (provider.models || provider.apiModels || []).filter(model => model?.isUserSelectable === true) : [];
	}

	function getExpertSelectableProviders() {
		if (providers.length > 0) {
			return providers.filter(provider => provider?.enabled && getProviderModels(provider.id).length > 0);
		}
		return expertSelectableProviders;
	}

	function populateExpertModeProviders(providerSelect, selectedProviderId) {
		if (!providerSelect) return;
		const placeholder = providerSelect.dataset.placeholderKey
			? formatTranslation(t(providerSelect.dataset.placeholderKey), { value: providerSelect.dataset.placeholderValue || '' })
			: (providerSelect.dataset.placeholder || t('expertProvider'));
		const expertProviders = getExpertSelectableProviders();
		providerSelect.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + expertProviders.map(provider => `
			<option value="${escapeHtml(provider.id)}" ${provider.id === selectedProviderId ? 'selected' : ''}>${escapeHtml(provider.name)}</option>
		`).join('');
		applyI18n();
	}

	function populateExpertModeModels(providerSelect, modelSelect, selectedModelId) {
		if (!modelSelect) return;
		const providerId = providerSelect?.value || '';
		const models = getProviderModels(providerId);
		const placeholder = modelSelect.dataset.placeholderKey
			? formatTranslation(t(modelSelect.dataset.placeholderKey), { value: modelSelect.dataset.placeholderValue || '' })
			: (modelSelect.dataset.placeholder || t('expertModel'));
		modelSelect.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + models.map(model => `
			<option value="${escapeHtml(model.modelId)}" ${model.modelId === selectedModelId ? 'selected' : ''}>${escapeHtml(model.displayName || model.modelId)}</option>
		`).join('');
		applyI18n();
	}

	function updateExpertModeControls() {
		if (modalExpertModeEnabled) modalExpertModeEnabled.checked = !!expertModeSettings.enabled;
		populateExpertModeProviders(modalExpertModeProvider, expertModeSettings.providerId);
		populateExpertModeModels(modalExpertModeProvider, modalExpertModeModel, expertModeSettings.modelId);

		const panelProvider = document.getElementById('panelExpertModeProvider');
		const panelModel = document.getElementById('panelExpertModeModel');
		const panelEnabled = document.getElementById('panelExpertModeEnabled');
		if (panelEnabled) panelEnabled.checked = !!expertModeSettings.enabled;
		if (panelProvider && window.panelProviders) {
			providers = window.panelProviders;
			const selectedProviderId = window.panelExpertModeSettings?.providerId || expertModeSettings.providerId;
			const selectedModelId = window.panelExpertModeSettings?.modelId || expertModeSettings.modelId;
			populateExpertModeProviders(panelProvider, selectedProviderId);
			populateExpertModeModels(panelProvider, panelModel, selectedModelId);
		}
	}

        // Settings Modal
        function openSettingsModal() {
                // Request latest settings before opening
                vscode.postMessage({ command: 'getChatHistorySettings' });
                settingsModal?.classList.add('active');
        }

        function closeSettingsModalFn() {
                settingsModal?.classList.remove('active');
        }

        // Collapsible sections
        function toggleCollapsible(header, content) {
                const isCollapsed = header.classList.contains('collapsed');
                if (isCollapsed) {
                        header.classList.remove('collapsed');
                        content.classList.remove('collapsed');
                } else {
                        header.classList.add('collapsed');
                        content.classList.add('collapsed');
                }
        }

        // System Prompt Modal
        function openSystemPromptModal(tab = 'global') {
                vscode.postMessage({ command: 'getSystemPrompt', data: { tab } });
                systemPromptModal?.classList.add('active');
        }

        function closeSystemPromptModalFn() {
                systemPromptModal?.classList.remove('active');
        }

        function saveSystemPrompt() {
                vscode.postMessage({
                        command: 'updateSystemPrompt',
                        data: {
                                globalPrompt: globalSystemPromptTextarea.value.trim(),
                                workspacePrompt: workspaceSystemPromptTextarea.value.trim()
                        }
                });
                closeSystemPromptModalFn();
        }

        function updateSystemPromptPreview(globalPrompt, workspacePrompt) {
                // Preview removed from card; kept for potential future use
        }

        function saveSettings() {
                vscode.postMessage({
                        command: 'updateChatHistorySettings',
                        data: {
                                enabled: chatHistoryEnabled.checked,
                                savePath: chatHistorySavePath.value.trim()
                        }
                });
                closeSettingsModalFn();
	}

	// Global Settings Modal (Unified)
	function openGlobalSettingsModal() {
		// Load current settings
		vscode.postMessage({ command: 'getSystemPrompt' });
		vscode.postMessage({ command: 'getChatHistorySettings' });
		vscode.postMessage({ command: 'getExpertModeSettings' });
		
		// Populate the modal with current values
		// The message handlers below will update the modal fields
		globalSettingsModal?.classList.add('active');
	}

	function closeGlobalSettingsModalFn() {
		globalSettingsModal?.classList.remove('active');
	}

	function saveGlobalSettings() {
		// Save both global system prompt and chat history settings
		vscode.postMessage({
			command: 'updateSystemPrompt',
			data: {
				globalPrompt: modalGlobalSystemPrompt?.value.trim() || '',
				workspacePrompt: workspaceSystemPromptTextarea?.value.trim() || ''
			}
		});
		vscode.postMessage({
			command: 'updateChatHistorySettings',
			data: {
				enabled: modalChatHistoryEnabled?.checked || false,
				savePath: modalChatHistorySavePath?.value.trim() || ''
			}
		});
		vscode.postMessage({
			command: 'updateExpertModeSettings',
			data: {
				enabled: modalExpertModeEnabled?.checked || false,
				providerId: modalExpertModeProvider?.value || '',
				modelId: modalExpertModeModel?.value || ''
			}
		});
		closeGlobalSettingsModalFn();
	}

	// Project Settings Modal
	function openProjectSettingsModal() {
		vscode.postMessage({ command: 'getSystemPrompt' });
		projectSettingsModal?.classList.add('active');
	}

	function closeProjectSettingsModalFn() {
		projectSettingsModal?.classList.remove('active');
	}

	function saveProjectSettings() {
		vscode.postMessage({
			command: 'updateSystemPrompt',
			data: {
				globalPrompt: globalSystemPromptTextarea?.value.trim() || '',
				workspacePrompt: modalProjectSystemPrompt?.value.trim() || ''
			}
		});
		closeProjectSettingsModalFn();
	}
        adBanner?.addEventListener('click', () => {
                if (adUrl) {
                        vscode.postMessage({ command: 'openUrl', data: adUrl });
                }
        });

        // Handle ad data loaded from extension
        window.addEventListener('message', (event) => {
                const message = event.data;
                if (message.command === 'loadAd' && message.data) {
                        const { image, url } = message.data;
                        if (image && url) {
                                adUrl = url;
								const adLabel = t('adLabel');
                                adBanner.innerHTML = `<span class="ad-label">${adLabel}</span><img src="${image}" alt="Ad" />`;
                                adBanner.style.display = 'block';
                        }
                }
        });
})();
