# 远程通知管理功能设计方案

## 背景

本项目需要新增远程通知管理能力，用于把模型响应过程中的关键事件发送到外部系统，并允许外部系统通过网络套接字向编辑器发送聊天消息。

该功能包含两个远程通道：

一、网络套接字通道：支持双向通信。扩展需要把模型所有流式消息、推理片段、工具调用增量、工具结果、完成、取消和错误等事件发送给远端。远端也可以向扩展发送消息，扩展收到后复用现有聊天输入发送能力，但必须跳过提示词优化。

二、回调通道：只发送，不接收。只在模型最终完成之前的最后一条模型消息满足条件时发送一次。该消息必须是可见文本，并且最终助手消息不能包含工具调用内容。

同时，该功能需要提供独立设置页面、状态栏显示、多语言支持，并参考现有提示词优化功能的交互方式。

## 目标

一、提供可配置的远程通知管理功能。

二、通过网络套接字发送模型流式事件，并支持接收远端消息。

三、通过回调发送最终助手消息。

四、远端入站消息进入聊天输入时必须跳过提示词优化。

五、提供独立设置页面和状态栏状态提示。

六、支持多语言文案。

七、默认关闭，用户明确启用后才允许内容外发。

八、远程通知失败不得影响模型正常输出、工具调用和聊天体验。

## 非目标

一、不在首版实现复杂远端管理后台。

二、不要求提供远端服务端程序。

三、不把远程通知作为模型输出的必经链路。

四、不默认发送用户消息、系统提示词和完整上下文。

五、不允许使用隐藏文本前缀绕过提示词优化。

## 总体架构

建议新增以下模块：

一、远程通知配置管理模块。

二、远程通知服务模块。

三、流事件总线模块。

四、远程通知状态栏模块。

五、远程通知设置页面模块。

六、远程通知协议类型模块。

模型提供者不应直接发送网络请求，而应把模型流式过程中的事件发布到流事件总线。远程通知服务订阅事件总线，并把事件写入全局消息缓存。网络套接字发送器和回调发送器各自拥有独立缓存，并通过独立子线程或独立后台任务异步发送。

这样可以避免远程网络连接阻塞模型流式输出。转发路径只负责把内容加入缓存，不负责等待网络发送结果。网络套接字和回调各自独立发送，互不阻塞，也能分别处理重连、心跳、丢弃策略和错误状态。

## 模块设计

### 远程通知配置管理模块

负责读取全局配置、项目配置和最终生效配置。

配置内容包括：

一、是否启用远程通知。

二、是否启用网络套接字通道。

三、是否启用回调通道。

四、网络套接字地址。该地址由用户完整填写，并在地址中包含用于连接鉴权的令牌。

五、回调地址。

六、网络套接字连接鉴权方式。首版固定为从网络套接字地址中读取令牌，并在建立连接时完成鉴权。

七、是否启用全局消息缓存。

八、网络套接字缓存大小限制。

九、回调缓存大小限制。

十、是否允许接收入站消息。

十一、是否允许远端自动发送。

十二、入站消息大小限制。

十三、回调超时与重试次数。

十四、隐私和安全选项。

网络套接字连接令牌由用户放入网络套接字地址中，例如放在地址查询参数或路径中。扩展连接远端时直接使用用户提供的完整地址进行握手鉴权。该地址在界面、日志、状态栏、错误信息和配置导出中必须脱敏显示，不能明文暴露令牌。

回调通道不单独设计鉴权令牌，因为该功能是本地扩展主动连接远端服务，不是远端连接本地扩展。若用户需要回调鉴权，应把鉴权信息放入回调地址中或由远端根据来源、路径、会话标识等方式处理。扩展只负责对回调地址中的疑似令牌内容进行脱敏。

### 流事件总线模块

流事件总线是模型流式输出与远程通知发送之间的解耦层。

模型提供者在以下节点发布事件：

一、请求开始。

二、正文流式片段。

三、推理流式片段。

四、工具调用开始。

五、工具调用参数增量。

六、工具调用完成。

七、工具结果。

八、最终消息完成。

九、请求取消。

十、请求错误。

事件总线只负责发布和订阅，不直接做网络发送。

### 远程通知服务模块

远程通知服务负责：

一、建立网络套接字连接。

二、发送握手消息。

三、维护心跳。

四、断线自动重连。

五、维护异步有界事件队列。

六、维护网络套接字独立消息缓存。

七、维护回调独立消息缓存。

八、通过独立子线程或后台任务发送网络套接字事件。

九、通过独立子线程或后台任务发送回调请求。

十、处理远端入站消息。

十一、更新状态栏状态。

十二、记录安全审计日志和错误日志。

远程通知服务不能阻塞模型输出。模型转发路径只负责把事件加入对应缓存，不等待网络套接字或回调发送完成。缓存满时应采用明确丢弃策略，例如丢弃非关键增量事件，并保留完成、错误、取消等关键事件。

### 状态栏模块

状态栏显示远程通知当前状态。

建议状态包括：

一、已关闭。

二、未配置。

三、连接中。

四、已连接。

五、重连中。

六、鉴权失败。

七、错误。

八、部分可用。

状态栏提示信息应包含：

一、网络套接字状态。

二、回调状态。

三、是否启用内容外发。

四、最近错误。

五、已发送事件数。

六、已丢弃事件数。

七、回调成功数。

八、回调失败数。

点击状态栏应打开远程通知设置页面，并可提供快捷操作：连接、断开、测试连接、发送测试通知、查看最近事件、打开日志。

### 设置页面模块

远程通知应有独立设置页面，避免混入提供商管理页面造成配置混乱。

设置页面包含：

一、总开关。

二、网络套接字开关。

三、网络套接字地址。用户需要在该地址中填写连接鉴权令牌。

四、网络套接字地址令牌说明和脱敏预览。

五、是否允许接收入站消息。

六、是否允许远端自动发送。

七、回调开关。

八、回调地址。

九、全局消息缓存开关。

十、网络套接字缓存大小限制。

十一、回调缓存大小限制。

十二、隐私与安全选项。

十三、测试连接按钮。

十四、发送测试通知按钮。

十五、最近状态和最近错误显示。

十六、全局配置和项目配置切换。

配置变更后应热应用，不要求重启编辑器。

## 网络套接字协议设计

### 协议原则

一、使用结构化消息。

二、所有消息包含协议版本。

三、所有事件包含会话标识和请求标识。

四、所有事件包含单调递增事件编号。

五、正文和推理内容分通道发送。

六、流式内容固定使用增量片段。

七、关键事件不可随意丢弃。

八、入站消息必须校验大小、频率和重复标识。

九、所有网络套接字消息都必须包含类型字段。

十、所有可确认消息都应支持确认回执。

十一、心跳消息必须独立于业务事件，不能混入模型正文流。

十二、回调负载与网络套接字负载保持相同的基础信封结构，便于远端统一解析。

### 通用消息信封

网络套接字和回调均采用通用消息信封。

通用字段如下：

```json
{
	"protocolVersion": "1.0",
	"type": "message.type",
	"messageId": "msg_当前消息唯一标识",
	"eventId": "evt_事件唯一标识",
	"eventSeq": 1,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {}
}
```

字段说明：

一、协议版本用于兼容后续协议升级。

二、类型字段用于区分消息类型。

三、消息标识用于单条消息去重。

四、事件标识用于业务事件去重。

五、事件序号在同一个会话和请求内单调递增。

六、会话标识用于区分聊天会话。

七、请求标识用于区分一次模型请求。

八、工作区标识用于区分不同项目。

九、扩展实例标识用于区分多窗口和多实例。

十、时间字段统一使用国际标准时间字符串。

十一、负载字段保存具体业务内容。

### 网络套接字类型定义

扩展发送给远端的类型：

| 类型 | 用途 |
| --- | --- |
| `client.hello` | 扩展连接后发送握手信息 |
| `client.connection_context` | 连接成功后发送会话标识和工作区目录 |
| `client.heartbeat_ping` | 扩展发送心跳请求 |
| `client.heartbeat_pong` | 扩展回复远端心跳 |
| `model.request_started` | 模型请求开始 |
| `model.text_delta` | 模型正文流式片段 |
| `model.reasoning_delta` | 模型推理流式片段 |
| `model.tool_call_started` | 工具调用开始 |
| `model.tool_call_delta` | 工具调用参数增量 |
| `model.tool_call_completed` | 工具调用参数完成 |
| `model.tool_result` | 工具结果 |
| `model.assistant_final` | 最终助手消息 |
| `model.request_completed` | 模型请求完成 |
| `model.request_cancelled` | 模型请求取消 |
| `model.request_error` | 模型请求错误 |
| `notify.test` | 测试通知 |
| `notify.metrics` | 远程通知统计信息 |

远端发送给扩展的类型：

| 类型 | 用途 |
| --- | --- |
| `server.hello_ack` | 远端握手确认 |
| `server.heartbeat_ping` | 远端发送心跳请求 |
| `server.heartbeat_pong` | 远端回复扩展心跳 |
| `server.ack` | 远端确认收到消息 |
| `server.error` | 远端返回错误 |
| `server.chat_message` | 远端要求扩展写入聊天输入 |
| `server.chat_history_request` | 远端请求当前项目历史聊天记录 |
| `client.chat_history_response` | 扩展返回当前项目历史聊天记录 |
| `client.chat_history_error` | 扩展返回历史聊天记录读取失败原因 |

### 网络套接字握手消息

扩展连接成功后先发送握手消息。

```json
{
	"protocolVersion": "1.0",
	"type": "client.hello",
	"messageId": "msg_hello_唯一标识",
	"eventId": "evt_hello_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"extensionName": "LLS OAI",
		"extensionVersion": "扩展版本",
		"language": "界面语言",
		"capabilities": {
			"streamEvents": true,
			"toolEvents": true,
			"inboundChatMessage": true,
			"webhook": true,
			"heartbeat": true
		}
	}
}
```

远端确认消息：

```json
{
	"protocolVersion": "1.0",
	"type": "server.hello_ack",
	"messageId": "msg_ack_唯一标识",
	"eventId": "evt_ack_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "",
	"workspaceId": "工作区标识",
	"instanceId": "远端实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "remote-server",
	"payload": {
		"accepted": true,
		"serverName": "远端服务名称",
		"serverVersion": "远端服务版本",
		"heartbeatIntervalMs": 30000,
		"enabledCapabilities": {
			"streamEvents": true,
			"toolEvents": true,
			"inboundChatMessage": true
		},
		"errorCode": "",
		"errorMessage": ""
	}
}
```

若远端返回未接受连接，扩展应根据错误码进入鉴权失败或连接错误状态。

### 连接成功上下文消息

扩展收到远端连接成功确认后，立即发送连接上下文消息。

```json
{
	"protocolVersion": "1.0",
	"type": "client.connection_context",
	"messageId": "msg_context_唯一标识",
	"eventId": "evt_context_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"workspaceFolders": [
			{
				"name": "工作区名称",
				"path": "脱敏后的工作区目录，仅保留最后两个目录，不足两个目录时只保留最后一个目录",
				"isPrimary": true
			}
		],
		"activeWorkspaceFolder": "脱敏后的当前主工作区目录，仅保留最后两个目录，不足两个目录时只保留最后一个目录"
	}
}
```

工作区路径脱敏规则：

一、远程通知中不得发送完整工作区绝对路径。

二、工作区路径只保留最后两个目录。

三、如果路径不足两个目录，则只保留最后一个目录。

四、不同操作系统的路径分隔符需要统一处理，输出建议使用斜杠分隔。

五、示例：`/Users/alice/project/demo` 发送为 `project/demo`。

六、示例：`/demo` 发送为 `demo`。

七、示例：`C:\Users\alice\demo` 发送为 `alice/demo`。

### 网络套接字心跳消息

心跳用于检测连接可用性，不携带模型内容。

扩展发送心跳：

```json
{
	"protocolVersion": "1.0",
	"type": "client.heartbeat_ping",
	"messageId": "msg_ping_唯一标识",
	"eventId": "evt_ping_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"nonce": "随机值",
		"sentAt": "2026-05-12T00:00:00.000Z"
	}
}
```

远端回复心跳：

```json
{
	"protocolVersion": "1.0",
	"type": "server.heartbeat_pong",
	"messageId": "msg_pong_唯一标识",
	"eventId": "evt_pong_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "",
	"workspaceId": "工作区标识",
	"instanceId": "远端实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "remote-server",
	"payload": {
		"nonce": "原样返回的随机值",
		"receivedAt": "2026-05-12T00:00:00.000Z"
	}
}
```

远端也可以主动发送心跳请求，扩展必须回复对应的心跳响应。

### 模型请求开始消息

```json
{
	"protocolVersion": "1.0",
	"type": "model.request_started",
	"messageId": "msg_started_唯一标识",
	"eventId": "evt_started_唯一标识",
	"eventSeq": 1,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"providerId": "提供商标识",
		"modelId": "模型标识",
		"apiType": "接口类型",
		"stream": true,
		"toolCallingEnabled": true
	}
}
```

### 模型正文流式片段消息

```json
{
	"protocolVersion": "1.0",
	"type": "model.text_delta",
	"messageId": "msg_text_唯一标识",
	"eventId": "evt_text_唯一标识",
	"eventSeq": 2,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"role": "assistant",
		"channel": "text",
		"delta": "本次新增正文片段",
		"deltaIndex": 1,
		"cumulativeLength": 12,
		"cumulativeHash": "累计正文校验值"
	}
}
```

### 模型推理流式片段消息

```json
{
	"protocolVersion": "1.0",
	"type": "model.reasoning_delta",
	"messageId": "msg_reasoning_唯一标识",
	"eventId": "evt_reasoning_唯一标识",
	"eventSeq": 3,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"role": "assistant",
		"channel": "reasoning",
		"delta": "本次新增推理片段",
		"deltaIndex": 1,
		"cumulativeLength": 12,
		"cumulativeHash": "累计推理内容校验值"
	}
}
```

### 工具调用消息

工具调用开始：

```json
{
	"protocolVersion": "1.0",
	"type": "model.tool_call_started",
	"messageId": "msg_tool_start_唯一标识",
	"eventId": "evt_tool_start_唯一标识",
	"eventSeq": 4,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"toolCallId": "工具调用标识",
		"toolName": "工具名称",
		"toolIndex": 0
	}
}
```

工具参数增量：

```json
{
	"protocolVersion": "1.0",
	"type": "model.tool_call_delta",
	"messageId": "msg_tool_delta_唯一标识",
	"eventId": "evt_tool_delta_唯一标识",
	"eventSeq": 5,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"toolCallId": "工具调用标识",
		"toolName": "工具名称",
		"toolIndex": 0,
		"argumentsDelta": "参数增量片段",
		"argumentsCumulativeLength": 24,
		"argumentsCumulativeHash": "累计参数校验值"
	}
}
```

工具调用完成：

```json
{
	"protocolVersion": "1.0",
	"type": "model.tool_call_completed",
	"messageId": "msg_tool_completed_唯一标识",
	"eventId": "evt_tool_completed_唯一标识",
	"eventSeq": 6,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"toolCallId": "工具调用标识",
		"toolName": "工具名称",
		"toolIndex": 0,
		"argumentsText": "完整参数文本",
		"argumentsHash": "完整参数校验值"
	}
}
```

### 工具结果消息

```json
{
	"protocolVersion": "1.0",
	"type": "model.tool_result",
	"messageId": "msg_tool_result_唯一标识",
	"eventId": "evt_tool_result_唯一标识",
	"eventSeq": 7,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"toolCallId": "工具调用标识",
		"toolName": "工具名称",
		"success": true,
		"resultText": "工具结果摘要或截断内容",
		"truncated": false,
		"errorMessage": ""
	}
}
```

### 最终助手消息

```json
{
	"protocolVersion": "1.0",
	"type": "model.assistant_final",
	"messageId": "msg_final_唯一标识",
	"eventId": "evt_final_唯一标识",
	"eventSeq": 8,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"role": "assistant",
		"text": "最终可见正文",
		"textLength": 128,
		"textHash": "最终正文校验值",
		"hasToolCalls": false,
		"toolCallCount": 0,
		"finishReason": "stop"
	}
}
```

### 请求完成、取消和错误消息

请求完成：

```json
{
	"protocolVersion": "1.0",
	"type": "model.request_completed",
	"messageId": "msg_completed_唯一标识",
	"eventId": "evt_completed_唯一标识",
	"eventSeq": 9,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"finishReason": "stop",
		"hasError": false,
		"cancelled": false,
		"hasToolCalls": false
	}
}
```

请求取消：

```json
{
	"protocolVersion": "1.0",
	"type": "model.request_cancelled",
	"messageId": "msg_cancelled_唯一标识",
	"eventId": "evt_cancelled_唯一标识",
	"eventSeq": 10,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"reason": "用户取消或请求中止"
	}
}
```

请求错误：

```json
{
	"protocolVersion": "1.0",
	"type": "model.request_error",
	"messageId": "msg_error_唯一标识",
	"eventId": "evt_error_唯一标识",
	"eventSeq": 11,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"errorCode": "错误码",
		"errorMessage": "脱敏后的错误信息",
		"retryable": false,
		"stage": "发生阶段"
	}
}
```

### 远端确认和错误消息

远端可以对重要消息返回确认。

```json
{
	"protocolVersion": "1.0",
	"type": "server.ack",
	"messageId": "msg_ack_唯一标识",
	"eventId": "evt_ack_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "远端实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "remote-server",
	"payload": {
		"ackMessageId": "被确认的消息标识",
		"ackEventId": "被确认的事件标识",
		"accepted": true
	}
}
```

远端错误消息：

```json
{
	"protocolVersion": "1.0",
	"type": "server.error",
	"messageId": "msg_server_error_唯一标识",
	"eventId": "evt_server_error_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "远端实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "remote-server",
	"payload": {
		"relatedMessageId": "相关消息标识",
		"errorCode": "错误码",
		"errorMessage": "错误信息",
		"retryable": false
	}
}
```

### 远端聊天消息

远端要求扩展写入聊天输入时，发送如下消息。

```json
{
	"protocolVersion": "1.0",
	"type": "server.chat_message",
	"messageId": "msg_chat_唯一标识",
	"eventId": "evt_chat_唯一标识",
	"eventSeq": 0,
	"sessionId": "目标会话标识",
	"requestId": "",
	"workspaceId": "工作区标识",
	"instanceId": "远端实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "remote-server",
	"payload": {
		"text": "需要写入聊天输入的内容",
		"autoSend": false,
		"bypassPromptEnhancement": true,
		"dedupeKey": "去重键",
		"expireAt": "2026-05-12T00:05:00.000Z"
	}
}
```

扩展收到该消息后必须执行以下规则：

一、入站消息未启用时拒绝。

二、消息过期时拒绝。

三、消息重复时拒绝。

四、文本超过限制时拒绝。

五、未启用远端自动发送时只预填聊天输入。

六、无论是否自动发送，都必须通过发送上下文跳过提示词优化。

七、处理结果可以通过确认或错误消息返回给远端。

### 远端请求项目历史聊天记录

远端可以通过网络套接字主动请求当前项目的历史聊天记录。该能力只读取当前项目工作区目录下的项目聊天日志，不读取全局聊天日志。

#### 请求规则

扩展收到 `server.chat_history_request` 后必须先判断当前项目是否开启项目日志保存功能。

一、扩展必须先判断远端历史聊天记录请求功能是否开启。该能力应有独立开关，例如 `openapicopilot.remoteNotification.allowHistoryRequest`，默认关闭。未开启时返回 `client.chat_history_error`，错误码为 `CHAT_HISTORY_REQUEST_DISABLED`。

二、扩展必须使用现有 `ConfigManager.getProjectChatHistorySettings().enabled` 判断当前项目是否开启项目日志保存功能。即使 `.LLSOAI` 目录存在，如果项目日志保存未开启，也必须返回 `PROJECT_CHAT_HISTORY_DISABLED`，错误信息为“当前项目未开启日志保存”。

三、如果当前项目已开启项目日志保存功能，扩展从当前主工作区目录下的 `.LLSOAI` 目录读取历史聊天记录。首版固定读取当前主工作区目录下的 `.LLSOAI`，不读取全局聊天日志，也不读取其他自定义目录。

四、扩展只读取聊天记录 JSON 文件。文件筛选规则为：只读取普通文件、扩展名为 `.json`、文件名匹配 `chat_*.json`、`chat-session-*.json` 或项目日志日期文件 `YYYY-MM-DD.json`。跳过子目录、符号链接、非 JSON 文件、非聊天记录文件和结构无法识别的文件。

五、扩展按文件修改时间 `mtimeMs` 倒序排序聊天记录文件，优先读取最新文件。

六、扩展定义一个消息变量，用于累计返回消息。

七、扩展循环读取聊天记录。对每个聊天记录文件，解析得到消息数组后，从数组最后一条消息开始向前读取。

八、当累计消息数量大于或等于一百条时停止读取。即使远端传入更大的 limit，首版最大也只能返回一百条。

九、如果所有文件读取完成后不足一百条，则返回实际读取到的消息数量。

十、返回消息顺序建议按时间正序排列，便于远端直接展示和恢复上下文。读取时可以倒序收集，返回前再反转。

十一、扩展不得返回当前项目 `.LLSOAI` 目录之外的聊天记录。

十二、如果项目日志保存已开启但 `.LLSOAI` 目录不存在，返回成功响应，`messages` 为空数组，`messageCount` 为零。

十三、单个文件解析失败时跳过该文件并记录日志，不应导致整个请求失败。只有目录读取权限错误或严重 IO 错误才返回 `PROJECT_HISTORY_READ_FAILED`。

十四、远端历史请求必须有频率限制，例如每分钟最多请求若干次。超限时返回 `CHAT_HISTORY_RATE_LIMITED`。

十五、响应必须有大小限制。首版建议限制单条消息最大长度和总响应最大字节数，超过时截断并设置 `truncated: true` 与 `truncatedReason`。

十六、扩展应使用异步文件接口读取目录、文件信息和文件内容，避免大日志读取阻塞扩展宿主。

十七、扩展读取文件前必须拒绝符号链接，并限制单个日志文件大小，避免读取项目日志目录中伪装的敏感文件或超大文件。

#### 远端请求消息格式

```json
{
	"protocolVersion": "1.0",
	"type": "server.chat_history_request",
	"messageId": "msg_history_request_唯一标识",
	"eventId": "evt_history_request_唯一标识",
	"eventSeq": 0,
	"sessionId": "目标会话标识或空字符串",
	"requestId": "history_request_唯一标识",
	"workspaceId": "工作区标识",
	"instanceId": "远端实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "remote-server",
	"payload": {
		"limit": 100,
		"order": "asc",
		"scope": "project"
	}
}
```

字段说明：

一、`limit` 表示远端期望获取的最大消息数量。首版固定最大值为一百，即使远端传入更大值也只能返回最多一百条。

二、`order` 表示返回顺序。首版建议返回时间正序。

三、`scope` 固定为项目范围，不能请求全局聊天记录。

四、如果请求参数非法，例如 `limit` 小于一或 `scope` 不是 `project`，扩展返回 `INVALID_CHAT_HISTORY_REQUEST`。

#### 扩展成功响应格式

```json
{
	"protocolVersion": "1.0",
	"type": "client.chat_history_response",
	"messageId": "msg_history_response_唯一标识",
	"eventId": "evt_history_response_唯一标识",
	"eventSeq": 0,
	"sessionId": "目标会话标识或空字符串",
	"requestId": "history_request_唯一标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"enabled": true,
		"scope": "project",
		"workspaceFolder": "脱敏后的当前主工作区目录",
		"messageCount": 100,
		"limit": 100,
		"truncated": true,
		"truncatedReason": "message_limit",
		"messages": [
			{
				"role": "user",
				"content": "历史消息内容",
				"timestamp": "2026-05-12T00:00:00.000Z"
			}
		]
	}
}
```

字段说明：

一、`enabled` 表示当前项目是否开启项目日志保存。成功响应中固定为 `true`。

二、`workspaceFolder` 只能返回脱敏后的工作区目录，仍然遵守只保留最后两个目录的规则。

三、`messageCount` 表示实际返回消息数量。

四、`limit` 表示本次读取限制，首版最大为一百。

五、`truncated` 表示是否因为达到数量限制而停止读取。

六、`messages` 保存读取到的历史聊天消息，返回前按时间正序排列。

七、首版响应消息不返回来源文件名，避免泄露会话标识、哈希或其他敏感信息。

#### 聊天记录 JSON 兼容规则

扩展读取聊天记录文件后，按以下规则解析消息数组：

一、如果根节点是数组，则把根节点当作消息数组。

二、如果根节点是对象且包含 `messages` 数组，则优先读取 `messages`。

三、如果根节点是对象且包含 `conversation` 数组，则读取 `conversation`。

四、如果根节点是对象且包含 `records` 数组，则读取 `records`。这是当前项目日志保存功能的主要结构。

五、如果结构无法识别，则跳过该文件。

六、每条消息至少需要包含 `role` 和 `content` 字段。

七、`role` 必须转换为字符串。

八、`content` 如果不是字符串，应转换为字符串；转换失败则跳过该消息。

九、每条消息的内容需要应用单条消息长度限制，超出时截断。

#### 扩展失败响应格式

```json
{
	"protocolVersion": "1.0",
	"type": "client.chat_history_error",
	"messageId": "msg_history_error_唯一标识",
	"eventId": "evt_history_error_唯一标识",
	"eventSeq": 0,
	"sessionId": "目标会话标识或空字符串",
	"requestId": "history_request_唯一标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"enabled": false,
		"scope": "project",
		"errorCode": "PROJECT_CHAT_HISTORY_DISABLED",
		"errorMessage": "当前项目未开启日志保存",
		"retryable": false
	}
}
```

常见错误码：

| 错误码 | 含义 |
| --- | --- |
| `PROJECT_CHAT_HISTORY_DISABLED` | 当前项目未开启日志保存 |
| `NO_WORKSPACE` | 当前没有打开工作区 |
| `PROJECT_HISTORY_DIR_NOT_FOUND` | 当前项目日志目录不存在 |
| `PROJECT_HISTORY_READ_FAILED` | 项目日志读取失败 |
| `CHAT_HISTORY_REQUEST_DISABLED` | 远端历史请求功能未开启 |
| `CHAT_HISTORY_RATE_LIMITED` | 历史请求频率超限 |
| `CHAT_HISTORY_FILE_PARSE_FAILED` | 单个文件解析失败，通常不作为整体失败 |
| `CHAT_HISTORY_RESPONSE_TOO_LARGE` | 响应体超过大小限制 |
| `INVALID_CHAT_HISTORY_REQUEST` | 请求参数非法 |

#### 项目日志读取伪流程

```text
如果当前没有工作区：
  返回 client.chat_history_error，错误码 NO_WORKSPACE

如果远端历史请求功能未开启：
	返回 client.chat_history_error，错误码 CHAT_HISTORY_REQUEST_DISABLED

如果请求频率超限：
	返回 client.chat_history_error，错误码 CHAT_HISTORY_RATE_LIMITED

读取项目聊天历史设置
如果项目日志保存未开启：
  返回 client.chat_history_error，错误码 PROJECT_CHAT_HISTORY_DISABLED，错误信息 当前项目未开启日志保存

定位当前项目工作区目录下的 .LLSOAI 目录
如果目录不存在：
	返回 client.chat_history_response，messages 为空数组，messageCount 为 0

获取 .LLSOAI 目录中的聊天记录文件
只保留普通 JSON 文件，并且文件名匹配 chat_*.json、chat-session-*.json 或 YYYY-MM-DD.json
拒绝符号链接和超大文件
按文件修改时间倒序排序

定义 messages = []
循环读取排序后的文件：
	异步读取文件并解析 JSON，得到消息数组
	兼容根数组、messages、conversation 和 records
	如果结构无法识别或解析失败，跳过该文件并记录日志
	从当前文件消息数组的最后一条消息开始向前读取
  将消息加入 messages
  如果 messages.length >= 100：
    停止读取

将 messages 反转为时间正序
返回 client.chat_history_response
```

### 握手消息

扩展连接成功后发送握手消息。

网络套接字鉴权发生在连接建立阶段。用户在网络套接字地址中填入令牌，扩展使用该完整地址发起连接，远端根据地址中的令牌决定是否接受连接。若远端拒绝连接或握手确认返回鉴权失败，扩展进入鉴权失败状态，并停止自动重连，直到用户修改地址或手动重试。

扩展内部不单独维护网络套接字令牌字段，不把地址中的令牌拆出保存到独立密钥项。所有展示、日志、错误信息和导出内容都必须对地址中的令牌部分进行脱敏。

网络套接字连接成功并收到远端连接成功确认后，扩展需要立即发送连接上下文消息。该消息至少包含当前会话标识和脱敏后的工作区目录。工作区目录用于远端识别当前项目环境，但不得发送完整绝对路径。若存在多个工作区目录，应发送全部脱敏后的工作区目录，并标记当前主工作区目录。

握手消息包含：

一、协议版本。

二、扩展实例标识。

三、工作区标识。

四、窗口标识。

五、扩展版本。

六、界面语言。

七、支持的能力。

八、是否支持入站消息。

九、是否支持流式事件。

十、是否支持工具事件。

十一、当前会话标识。

十二、工作区目录列表。

十三、当前主工作区目录。

远端返回握手确认。

握手确认包含：

一、是否接受连接。

二、远端名称。

三、远端协议版本。

四、启用的能力。

五、建议心跳间隔。

六、错误信息。

### 流式正文事件

正文事件包含：

一、事件类型。

二、事件编号。

三、会话标识。

四、请求标识。

五、消息标识。

六、时间。

七、角色。

八、通道。

九、内容片段。

十、是否为增量。

十一、累计长度。

十二、累计校验值。

### 推理内容事件

推理内容使用独立通道发送，避免与正文混淆。

推理内容默认可配置为不发送，因为推理内容可能包含敏感中间信息。

### 工具调用事件

工具调用事件包含：

一、工具调用标识。

二、工具名称。

三、工具调用索引。

四、参数增量。

五、是否完成。

六、参数累计长度。

七、参数累计校验值。

### 工具结果事件

工具结果事件包含：

一、工具调用标识。

二、工具名称。

三、是否成功。

四、结果摘要。

五、错误信息。

六、结果是否被截断。

工具结果可能非常大，默认应只发送摘要或截断内容。

### 完成事件

完成事件包含：

一、请求标识。

二、消息标识。

三、最终文本长度。

四、是否存在工具调用。

五、完成原因。

六、是否取消。

七、是否错误。

八、最终校验值。

### 错误事件

错误事件包含：

一、错误码。

二、错误消息。

三、发生阶段。

四、是否可重试。

五、请求标识。

六、会话标识。

日志中不得输出鉴权信息和完整敏感正文。

### 入站消息

远端向扩展发送消息时，消息包含：

一、消息标识。

二、会话标识。

三、文本。

四、是否请求自动发送。

五、时间戳。

六、随机值。

七、签名。

扩展处理规则：

一、未启用入站消息时拒绝。

二、超过大小限制时拒绝。

三、超过频率限制时拒绝。

四、重复消息标识时拒绝。

五、签名不通过时拒绝。

六、未启用远端自动发送时，即使远端请求自动发送，也只预填输入框。

七、远端入站消息发送时必须跳过提示词优化。

## 回调协议设计

回调只发送最终助手消息。

回调发送与网络套接字发送完全独立。回调事件写入回调专用缓存，由回调后台任务或子线程独立消费并发送。网络套接字连接状态不影响回调缓存和回调发送，回调失败也不影响网络套接字流式转发。

回调触发条件：

一、模型请求正常完成。

二、最终助手消息存在可见文本。

三、最终助手消息不包含工具调用。

四、请求未取消。

五、请求未出错。

六、同一请求未发送过回调。

不发送回调的情况：

一、请求取消。

二、请求错误。

三、最终文本为空。

四、只有推理内容没有可见正文。

五、最终助手消息包含工具调用。

六、重复完成事件。

注意：如果前面轮次出现过工具调用，但最终助手消息本身不包含工具调用，并且最终有可见文本，则可以发送回调。

回调负载包含：

一、协议版本。

二、扩展实例标识。

三、工作区标识。

四、会话标识。

五、请求标识。

六、消息标识。

七、模型标识。

八、最终文本。

九、文本长度。

十、完成时间。

十一、去重标识。

十二、内容校验值。

回调请求应支持超时和重试。远端需要通过去重标识避免重复处理。

### 回调请求格式

回调使用和网络套接字一致的通用消息信封，通过普通网络请求发送到用户配置的回调地址。

回调请求头建议包含：

```json
{
	"Content-Type": "application/json",
	"X-LLSOAI-Protocol-Version": "1.0",
	"X-LLSOAI-Event-Type": "webhook.assistant_final",
	"X-LLSOAI-Request-Id": "当前请求标识",
	"X-LLSOAI-Session-Id": "当前会话标识",
	"X-LLSOAI-Dedupe-Key": "去重标识"
}
```

回调请求体格式：

```json
{
	"protocolVersion": "1.0",
	"type": "webhook.assistant_final",
	"messageId": "msg_webhook_唯一标识",
	"eventId": "evt_webhook_唯一标识",
	"eventSeq": 0,
	"sessionId": "当前会话标识",
	"requestId": "当前请求标识",
	"workspaceId": "工作区标识",
	"instanceId": "扩展实例标识",
	"timestamp": "2026-05-12T00:00:00.000Z",
	"source": "vscode-extension",
	"payload": {
		"messageId": "助手消息标识",
		"role": "assistant",
		"modelId": "模型标识",
		"providerId": "提供商标识",
		"text": "最终助手可见正文",
		"textLength": 128,
		"textHash": "正文校验值",
		"hasToolCalls": false,
		"toolCallCount": 0,
		"finishReason": "stop",
		"completedAt": "2026-05-12T00:00:00.000Z",
		"dedupeKey": "去重标识",
		"workspaceFolders": [
			{
				"name": "工作区名称",
				"path": "脱敏后的工作区目录，仅保留最后两个目录，不足两个目录时只保留最后一个目录",
				"isPrimary": true
			}
		]
	}
}
```

回调响应格式建议：

```json
{
	"accepted": true,
	"message": "接收结果说明",
	"dedupeKey": "去重标识",
	"retryable": false
}
```

如果远端返回临时错误，且响应体或状态码表明可重试，回调后台任务可以按配置重试。若远端返回永久错误，则记录失败并停止重试。

### 回调类型定义

| 类型 | 用途 |
| --- | --- |
| `webhook.assistant_final` | 最终助手消息回调 |
| `webhook.test` | 测试回调 |
| `webhook.delivery_failed` | 本地记录的回调发送失败事件 |

首版只需要向远端发送 `webhook.assistant_final` 和 `webhook.test`。`webhook.delivery_failed` 只作为本地缓存、日志和状态栏统计使用，不需要再发送给远端。

## 提示词优化绕过设计

不能通过隐藏前缀绕过提示词优化。

推荐改造为发送上下文机制：

一、聊天输入发送函数支持发送上下文参数。

二、发送上下文包含消息来源。

三、发送上下文包含需要跳过的预处理器列表。

四、提示词优化作为预处理器之一。

五、远端入站消息设置跳过提示词优化。

六、提示词优化逻辑只检查发送上下文，不检查文本前缀。

这样可以避免污染用户文本、聊天历史和日志，也能避免误伤合法输入。

## 安全设计

该功能涉及内容外发和远端输入，必须默认保守。

### 默认策略

一、默认关闭远程通知。

二、首次启用时弹出隐私确认。

三、状态栏长期提示内容外发已启用。

四、默认不发送用户消息和系统提示词。

五、默认不允许远端自动发送。

六、默认不允许明文远程地址。

七、默认限制入站消息大小和频率。

### 鉴权与密钥

一、网络套接字连接令牌由用户填入网络套接字地址中，并由远端在连接阶段鉴权。

二、扩展不提供单独的网络套接字令牌输入框，也不把网络套接字令牌拆分保存到密钥存储。

三、普通设置文件、界面展示、状态栏提示、日志、错误信息和配置导出都必须对网络套接字地址中的令牌进行脱敏。

四、回调不提供单独鉴权令牌输入框，也不把回调令牌保存到密钥存储。

五、如用户需要回调鉴权，应把鉴权信息放入回调地址中，或由远端根据来源、路径、会话标识等方式处理。

六、普通设置文件、界面展示、状态栏提示、日志、错误信息和配置导出都必须对回调地址中的疑似令牌内容进行脱敏。

七、日志不得输出任何令牌。

八、地址中的查询参数、路径令牌片段和其他疑似令牌内容需要脱敏后再显示。

## 全局消息缓存与后台发送设计

开启远程通知后，可以启用全局消息缓存。全局消息缓存用于把模型转发路径与远程发送路径彻底解耦。

设计原则：

一、模型流式处理只负责发布事件。

二、远程通知转发层只负责把事件写入缓存。

三、网络套接字和回调使用两个互相独立的缓存。

四、网络套接字缓存由网络套接字后台任务或子线程独立消费。

五、回调缓存由回调后台任务或子线程独立消费。

六、两个缓存互不阻塞，互不共享发送状态。

七、缓存满时只影响对应通道，不影响模型输出，也不影响另一个通道。

八、关键事件优先保留，非关键流式增量可以按策略丢弃或合并。

网络套接字缓存用于保存流式正文、推理片段、工具调用事件、工具结果、完成、取消和错误事件。

回调缓存只保存满足回调候选条件的最终助手消息事件。最终是否发送仍由回调后台任务根据无工具调用、非空文本、未取消、未错误、未重复等规则判断。

后台发送任务可以使用独立子线程，也可以使用不会阻塞模型流式热路径的异步后台任务。无论采用哪种方式，模型转发路径都不能等待远端网络发送结果。

### 地址安全

一、默认只推荐安全协议。

二、明文协议需要用户明确确认。

三、可配置主机白名单。

四、默认拒绝敏感本地地址和链路本地地址。

五、回调重定向后的地址也需要重新校验。

### 入站消息安全

一、默认只预填输入框，不自动发送。

二、自动发送需要用户显式开启。

三、建议提供每条消息用户确认模式。

四、入站消息必须限流。

五、入站消息必须限制最大长度。

六、入站消息建议使用签名、时间戳和随机值防重放。

七、需要记录审计日志，但日志不保存正文。

### 内容脱敏

出站内容可经过脱敏管线。

内置脱敏规则应覆盖常见密钥、令牌、私有凭据、云服务访问密钥和长随机字符串。

用户可配置额外脱敏规则。

## 状态机设计

远程通知服务需要显式状态机。

建议状态包括：

一、已禁用。

二、未配置。

三、连接中。

四、已连接。

五、重连中。

六、鉴权失败。

七、错误。

八、关闭中。

九、部分可用。

状态转移规则必须明确。

鉴权失败时不应无限重连，需要等待用户修改配置或手动重试。

断线后采用指数退避和随机抖动重连。

断线期间产生的非关键事件默认丢弃，并记录丢弃范围和数量。

## 多语言设计

新增所有用户可见文案都需要多语言支持。

需要覆盖：

一、设置页面标题。

二、设置字段标签。

三、设置字段帮助文本。

四、状态栏文本。

五、状态栏提示。

六、隐私确认弹窗。

七、连接成功和失败提示。

八、入站消息拒绝原因。

九、测试连接结果。

十、安全风险说明。

安全相关文案必须完整本地化，不能只提供单一语言。

## 实现计划

### 第一阶段：基础配置和状态栏

一、新增远程通知类型定义。

二、新增配置读写接口。

三、新增地址脱敏工具。

四、新增状态栏模块。

五、新增多语言文案。

六、新增设置页面入口。

### 第二阶段：流事件总线

一、新增流事件总线。

二、在模型流式处理处发布事件。

三、先使用日志或内存订阅验证事件完整性。

四、覆盖正文、推理、工具、完成、取消和错误事件。

### 第三阶段：网络套接字发送

一、实现连接。

二、实现基于网络套接字地址令牌的连接阶段鉴权。

三、实现握手。

四、实现连接成功上下文上报，向远端发送当前会话标识和工作区目录。

五、实现心跳。

六、实现重连。

七、实现网络套接字独立缓存。

八、实现网络套接字后台任务或子线程发送。

九、实现流式事件发送。

十、实现缓存满时丢弃策略。

### 第四阶段：回调发送

一、实现最终消息判定。

二、实现工具调用判定。

三、实现空文本、取消、错误过滤。

四、实现回调独立缓存。

五、实现回调后台任务或子线程发送。

六、实现去重。

七、实现超时和重试。

八、实现失败统计。

### 第五阶段：入站消息处理

一、实现远端消息接收。

二、实现大小限制。

三、实现速率限制。

四、实现重复消息过滤。

五、实现用户确认模式。

六、实现插入聊天输入。

七、实现显式跳过提示词优化。

### 第六阶段：安全和测试完善

一、实现地址校验。

二、实现内容脱敏。

三、实现工作区路径脱敏。工作区路径只保留最后两个目录，不足两个目录时只保留最后一个目录。

四、实现日志脱敏。

五、实现配置导出脱敏。

六、实现状态机测试。

七、实现流式压力测试。

八、实现回调边界测试。

九、实现多语言测试。

## 验收标准

一、远程通知默认关闭。

二、首次启用时显示隐私确认。

三、状态栏能正确显示禁用、未配置、连接中、已连接、重连中、鉴权失败和错误状态。

四、模型流式正文片段能通过网络套接字发送。

五、推理片段和工具事件能按配置发送。

六、网络发送失败不影响模型流式输出。

七、网络断开后能自动重连，并正确显示状态。

八、网络套接字地址中填写的令牌会在连接阶段用于鉴权。

九、网络套接字连接成功后会向远端发送当前会话标识和脱敏后的工作区目录。

十、鉴权失败后不无限重连。

十一、开启全局消息缓存后，模型转发路径只写入缓存，不等待网络发送。

十二、网络套接字和回调使用两个独立缓存，任一通道失败不影响另一通道。

十三、远端入站消息能预填聊天输入。

十四、远端入站消息发送时不会触发提示词优化。

十五、未开启自动发送时，远端请求自动发送会被降级为预填。

十六、回调只在最终助手消息无工具调用且有可见文本时发送。

十七、请求取消、错误、空文本、仅推理内容时不发送回调。

十八、同一请求不会重复发送回调。

十九、配置导出中的网络套接字地址令牌和回调地址疑似令牌会被脱敏。

二十、日志不包含网络套接字地址令牌、回调地址疑似令牌和默认正文内容。

二十一、所有发送到远端的工作区路径都只保留最后两个目录，不足两个目录时只保留最后一个目录。

二十二、多语言切换后新增界面文案能正确显示。

二十三、关闭扩展时能释放连接、后台任务、子线程和订阅资源。

## 专家审查结论

专家认为本方案方向正确，但正式实现前必须强化以下关键点：

一、不能使用隐藏前缀绕过提示词优化，必须使用显式上下文或预处理器跳过机制。

二、不能在模型流式热路径中直接发送网络请求，必须使用流事件总线和异步有界队列。

三、入站消息具有较高安全风险，自动发送必须默认关闭，并增加大小限制、速率限制、重复消息过滤和用户确认能力。

四、必须补全连接状态机，包括心跳、重连、鉴权失败处理、断线事件丢弃策略和错误可观测性。

五、必须加强地址安全、日志脱敏、内容脱敏和配置导出保护。

六、必须明确回调触发规则，只检查最终助手消息是否包含工具调用，而不是简单检查整个请求过程中是否出现过工具调用。

## 第二轮实现审查结论

第二轮审查认为，第一版实现已经具备事件总线、网络套接字连接、双缓存、回调发送、工作区路径脱敏、入站消息提示词优化旁路和基础配置项，但仍存在必须修复的问题。

### 必须修复项

一、鉴权失败后必须停止重连。

远端返回鉴权失败后，扩展应进入鉴权失败状态并停止自动重连。只有用户修改配置或手动重试时才能清除该状态。

二、网络套接字发送失败不能导致后台发送循环退出。

网络套接字发送需要捕获异常。发送失败时应重新入队、进入重连状态或记录错误，不能让发送循环永久停摆。

三、回调只能由真正用户可见的最终助手消息触发一次。

底层模型请求不应把每次内部请求结束都当成最终助手消息。自动工具、多轮专家、方案模型等场景下，回调必须避免重复发送。

四、工作区标识不能基于完整路径直接哈希。

工作区标识应使用脱敏后的工作区路径，并结合持久化盐值计算哈希，避免被远端通过常见路径离线枚举反查。

五、缓存关键事件不能被静默丢弃。

缓存满时应优先丢弃非关键事件。当缓存中全是关键事件时，应拒绝新关键事件并记录日志，或采用明确的可配置策略，不能静默丢弃旧关键事件。

六、工具结果事件必须完整覆盖。

普通工具结果、专家模式工具结果、方案模型工具结果和自动执行工具结果都应发布 `model.tool_result` 事件。

七、入站消息跳过提示词优化不应只依赖文本哈希。

入站消息预填后用户可能编辑文本，导致哈希不匹配。应增加下一次请求级或会话级旁路机制，确保远端入站消息不会触发提示词优化。

八、远程通知设置和状态文案需要多语言与独立界面。

状态栏和提示信息不应硬编码单一语言。后续应补充独立设置页面、测试连接、发送测试通知、最近状态和错误展示。

## 最终建议

建议先完成基础架构再实现具体网络功能。

第一版必须包含：

一、流事件总线。

二、异步有界队列。

三、网络套接字和回调独立缓存。

四、后台任务或子线程独立发送。

五、显式跳过提示词优化机制。

六、完整状态机。

七、入站消息安全限制。

八、回调最终消息判定和去重。

这些能力是远程通知管理功能的基础安全边界，不建议延后实现。
