import { ResolvedAppLanguage } from '../configManager';
import { RemoteNotificationStatus } from './types';

export interface RemoteNotificationTexts {
	status: Record<RemoteNotificationStatus, string>;
	websocket: string;
	webhook: string;
	websocketCache: string;
	webhookCache: string;
	webhookFailed: string;
	dropped: string;
	notConfigured: string;
	off: string;
	menuOpenSettings: string;
	menuOpenSettingsDescription: string;
	menuOpenOutput: string;
	menuOpenOutputDescription: string;
	menuReconnect: string;
	menuReconnectDescription: string;
	menuCopyStatus: string;
	menuCopyStatusDescription: string;
	menuPlaceHolder: string;
	statusCopied: string;
}

const STATUS_EN: Record<RemoteNotificationStatus, string> = {
	disabled: 'Remote Work: Off',
	notConfigured: 'Remote Work: Not Configured',
	connecting: 'Remote Work: Connecting',
	connected: 'Remote Work: Connected',
	reconnecting: 'Remote Work: Reconnecting',
	authFailed: 'Remote Work: Auth Failed',
	error: 'Remote Work: Error',
	partial: 'Remote Work: Partial',
};

const STATUS_ZH_CN: Record<RemoteNotificationStatus, string> = {
	disabled: '远程办公: 关闭',
	notConfigured: '远程办公: 未配置',
	connecting: '远程办公: 连接中',
	connected: '远程办公: 已连接',
	reconnecting: '远程办公: 重连中',
	authFailed: '远程办公: 鉴权失败',
	error: '远程办公: 错误',
	partial: '远程办公: 部分可用',
};

const STATUS_ZH_TW: Record<RemoteNotificationStatus, string> = {
	disabled: '遠端辦公: 關閉',
	notConfigured: '遠端辦公: 未設定',
	connecting: '遠端辦公: 連線中',
	connected: '遠端辦公: 已連線',
	reconnecting: '遠端辦公: 重新連線中',
	authFailed: '遠端辦公: 驗證失敗',
	error: '遠端辦公: 錯誤',
	partial: '遠端辦公: 部分可用',
};

const STATUS_KO: Record<RemoteNotificationStatus, string> = {
	disabled: '원격 근무: 꺼짐',
	notConfigured: '원격 근무: 구성되지 않음',
	connecting: '원격 근무: 연결 중',
	connected: '원격 근무: 연결됨',
	reconnecting: '원격 근무: 재연결 중',
	authFailed: '원격 근무: 인증 실패',
	error: '원격 근무: 오류',
	partial: '원격 근무: 일부 사용 가능',
};

const STATUS_JA: Record<RemoteNotificationStatus, string> = {
	disabled: 'リモートワーク: オフ',
	notConfigured: 'リモートワーク: 未設定',
	connecting: 'リモートワーク: 接続中',
	connected: 'リモートワーク: 接続済み',
	reconnecting: 'リモートワーク: 再接続中',
	authFailed: 'リモートワーク: 認証失敗',
	error: 'リモートワーク: エラー',
	partial: 'リモートワーク: 一部利用可能',
};

const STATUS_FR: Record<RemoteNotificationStatus, string> = {
	disabled: 'Travail à distance : désactivé',
	notConfigured: 'Travail à distance : non configuré',
	connecting: 'Travail à distance : connexion',
	connected: 'Travail à distance : connecté',
	reconnecting: 'Travail à distance : reconnexion',
	authFailed: 'Travail à distance : échec auth',
	error: 'Travail à distance : erreur',
	partial: 'Travail à distance : partiel',
};

const STATUS_DE: Record<RemoteNotificationStatus, string> = {
	disabled: 'Remote-Arbeit: Aus',
	notConfigured: 'Remote-Arbeit: Nicht konfiguriert',
	connecting: 'Remote-Arbeit: Verbindung',
	connected: 'Remote-Arbeit: Verbunden',
	reconnecting: 'Remote-Arbeit: Neu verbinden',
	authFailed: 'Remote-Arbeit: Auth fehlgeschlagen',
	error: 'Remote-Arbeit: Fehler',
	partial: 'Remote-Arbeit: Teilweise verfügbar',
};

const TEXTS: Record<ResolvedAppLanguage, RemoteNotificationTexts> = {
	en: {
		status: STATUS_EN,
		websocket: 'WebSocket',
		webhook: 'Webhook',
		websocketCache: 'WebSocket cache',
		webhookCache: 'Webhook cache',
		webhookFailed: 'Webhook failures',
		dropped: 'Dropped',
		notConfigured: 'Not configured',
		off: 'Off',
		menuOpenSettings: 'Open Remote Work Settings',
		menuOpenSettingsDescription: 'Open remote work settings in VS Code Settings',
		menuOpenOutput: 'Open Output Log',
		menuOpenOutputDescription: 'View remote work connection, webhook, and error logs',
		menuReconnect: 'Reconnect WebSocket',
		menuReconnectDescription: 'Close the current connection and reconnect to the remote endpoint',
		menuCopyStatus: 'Copy Status',
		menuCopyStatusDescription: 'Copy current remote work status and cache statistics',
		menuPlaceHolder: 'Remote Work',
		statusCopied: 'Remote work status copied.',
	},
	'zh-cn': {
		status: STATUS_ZH_CN,
		websocket: '网络套接字',
		webhook: '回调',
		websocketCache: '网络套接字缓存',
		webhookCache: '回调缓存',
		webhookFailed: '回调失败',
		dropped: '已丢弃',
		notConfigured: '未配置',
		off: '关闭',
		menuOpenSettings: '打开远程办公设置',
		menuOpenSettingsDescription: '打开 VS Code 设置中的远程办公配置',
		menuOpenOutput: '打开输出日志',
		menuOpenOutputDescription: '查看远程办公连接、回调和错误日志',
		menuReconnect: '重新连接网络套接字',
		menuReconnectDescription: '关闭当前连接并重新连接远端',
		menuCopyStatus: '复制状态信息',
		menuCopyStatusDescription: '复制当前远程办公状态和缓存统计',
		menuPlaceHolder: '远程办公',
		statusCopied: '远程办公状态已复制。',
	},
	'zh-tw': {
		status: STATUS_ZH_TW,
		websocket: '網路通訊端',
		webhook: '回呼',
		websocketCache: '網路通訊端快取',
		webhookCache: '回呼快取',
		webhookFailed: '回呼失敗',
		dropped: '已丟棄',
		notConfigured: '未設定',
		off: '關閉',
		menuOpenSettings: '開啟遠端辦公設定',
		menuOpenSettingsDescription: '在 VS Code 設定中開啟遠端辦公設定',
		menuOpenOutput: '開啟輸出記錄',
		menuOpenOutputDescription: '查看遠端辦公連線、回呼與錯誤記錄',
		menuReconnect: '重新連線網路通訊端',
		menuReconnectDescription: '關閉目前連線並重新連線遠端',
		menuCopyStatus: '複製狀態資訊',
		menuCopyStatusDescription: '複製目前遠端辦公狀態與快取統計',
		menuPlaceHolder: '遠端辦公',
		statusCopied: '遠端辦公狀態已複製。',
	},
	ko: {
		status: STATUS_KO,
		websocket: '웹소켓',
		webhook: 'Webhook',
		websocketCache: '웹소켓 캐시',
		webhookCache: 'Webhook 캐시',
		webhookFailed: 'Webhook 실패',
		dropped: '삭제됨',
		notConfigured: '구성되지 않음',
		off: '꺼짐',
		menuOpenSettings: '원격 근무 설정 열기',
		menuOpenSettingsDescription: 'VS Code 설정에서 원격 근무 구성을 엽니다',
		menuOpenOutput: '출력 로그 열기',
		menuOpenOutputDescription: '원격 근무 연결, Webhook 및 오류 로그 보기',
		menuReconnect: '웹소켓 다시 연결',
		menuReconnectDescription: '현재 연결을 닫고 원격 엔드포인트에 다시 연결합니다',
		menuCopyStatus: '상태 복사',
		menuCopyStatusDescription: '현재 원격 근무 상태와 캐시 통계를 복사합니다',
		menuPlaceHolder: '원격 근무',
		statusCopied: '원격 근무 상태가 복사되었습니다.',
	},
	ja: {
		status: STATUS_JA,
		websocket: 'WebSocket',
		webhook: 'Webhook',
		websocketCache: 'WebSocket キャッシュ',
		webhookCache: 'Webhook キャッシュ',
		webhookFailed: 'Webhook 失敗',
		dropped: '破棄済み',
		notConfigured: '未設定',
		off: 'オフ',
		menuOpenSettings: 'リモートワーク設定を開く',
		menuOpenSettingsDescription: 'VS Code 設定でリモートワーク設定を開きます',
		menuOpenOutput: '出力ログを開く',
		menuOpenOutputDescription: 'リモートワークの接続、Webhook、エラーログを表示します',
		menuReconnect: 'WebSocket を再接続',
		menuReconnectDescription: '現在の接続を閉じてリモートエンドポイントに再接続します',
		menuCopyStatus: '状態をコピー',
		menuCopyStatusDescription: '現在のリモートワーク状態とキャッシュ統計をコピーします',
		menuPlaceHolder: 'リモートワーク',
		statusCopied: 'リモートワークの状態をコピーしました。',
	},
	fr: {
		status: STATUS_FR,
		websocket: 'WebSocket',
		webhook: 'Webhook',
		websocketCache: 'Cache WebSocket',
		webhookCache: 'Cache Webhook',
		webhookFailed: 'Échecs Webhook',
		dropped: 'Ignorés',
		notConfigured: 'Non configuré',
		off: 'Désactivé',
		menuOpenSettings: 'Ouvrir les paramètres du travail à distance',
		menuOpenSettingsDescription: 'Ouvre la configuration du travail à distance dans les paramètres VS Code',
		menuOpenOutput: 'Ouvrir le journal de sortie',
		menuOpenOutputDescription: 'Afficher les journaux de connexion, Webhook et erreurs',
		menuReconnect: 'Reconnecter WebSocket',
		menuReconnectDescription: 'Ferme la connexion actuelle et reconnecte le point distant',
		menuCopyStatus: 'Copier l’état',
		menuCopyStatusDescription: 'Copie l’état actuel du travail à distance et les statistiques de cache',
		menuPlaceHolder: 'Travail à distance',
		statusCopied: 'État du travail à distance copié.',
	},
	de: {
		status: STATUS_DE,
		websocket: 'WebSocket',
		webhook: 'Webhook',
		websocketCache: 'WebSocket-Cache',
		webhookCache: 'Webhook-Cache',
		webhookFailed: 'Webhook-Fehler',
		dropped: 'Verworfen',
		notConfigured: 'Nicht konfiguriert',
		off: 'Aus',
		menuOpenSettings: 'Remote-Arbeit-Einstellungen öffnen',
		menuOpenSettingsDescription: 'Öffnet die Remote-Arbeit-Einstellungen in VS Code',
		menuOpenOutput: 'Ausgabeprotokoll öffnen',
		menuOpenOutputDescription: 'Verbindungs-, Webhook- und Fehlerprotokolle anzeigen',
		menuReconnect: 'WebSocket erneut verbinden',
		menuReconnectDescription: 'Schließt die aktuelle Verbindung und verbindet den Remote-Endpunkt erneut',
		menuCopyStatus: 'Status kopieren',
		menuCopyStatusDescription: 'Kopiert den aktuellen Remote-Arbeit-Status und Cache-Statistiken',
		menuPlaceHolder: 'Remote-Arbeit',
		statusCopied: 'Remote-Arbeit-Status kopiert.',
	},
};

export function getRemoteNotificationTexts(language: ResolvedAppLanguage): RemoteNotificationTexts {
	return TEXTS[language] || TEXTS.en;
}
