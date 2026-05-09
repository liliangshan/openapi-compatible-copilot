# Prompt Enhancement Feature Plan

## 1. 背景

当前扩展已经可以作为 OpenAI-compatible Language Model Provider 接收并转发 VS Code Chat 请求。
用户希望增加一个“提示词增强”能力：在用户输入原始需求后，可以由模型先优化提示词，再将优化后的提示词用于后续模型调用。

受 VS Code Extension API 限制，扩展目前无法直接读取、修改或扩展 Copilot Chat 原生输入框，也无法可靠监听 Copilot Chat 输入框的发送按钮事件。因此方案需要基于当前可用 API 设计。

## 2. 目标

- 支持提示词增强功能。
- 尽量不影响普通模型请求。
- 避免误增强工具调用、内部调用、二次模型请求。
- 支持用户显式触发和可配置自动增强。
- 保持实现兼容 VS Code 官方扩展 API。

## 3. 非目标

- 不直接修改 Copilot Chat 原生输入框内容。
- 不在 Copilot Chat 输入框旁边插入自定义按钮。
- 不拦截 Copilot Chat 原生发送事件。
- 不依赖 Copilot 扩展内部未公开 API。

## 4. API 限制说明

Language Model Provider 能接收到模型请求，但请求参数中没有官方字段标识：

```ts
isUserClickedSend: true
```

也没有可靠字段表示请求来源是：

- Copilot Chat 输入框用户点击发送；
- 用户按 Enter 发送；
- Chat Participant 内部调用；
- 其他扩展调用 `model.sendRequest()`；
- 工具调用链中的二次请求。

因此 provider 层不能 100% 判断请求是否来自“用户主动点击发送”。

## 5. 推荐总体方案

采用三层能力组合：

1. **显式触发增强**：通过 `/enhance` 前缀触发。
2. **手动增强命令**：通过命令面板、状态栏、右键菜单增强选中文本或剪贴板内容。
3. **自动增强模式**：可选开启，对“看起来像用户请求”的最后一条 user message 做启发式增强。

默认建议关闭自动增强，优先提供显式触发和手动增强。

## 6. 配置设计

建议增加配置：

```json
{
  "openapiCompatibleCopilot.promptEnhancement.enabled": false,
  "openapiCompatibleCopilot.promptEnhancement.mode": "manual",
  "openapiCompatibleCopilot.promptEnhancement.triggerPrefix": "/enhance",
  "openapiCompatibleCopilot.promptEnhancement.autoMinLength": 8,
  "openapiCompatibleCopilot.promptEnhancement.showEnhancedPrompt": false
}
```

模式说明：

```ts
type PromptEnhancementMode = 'off' | 'manual' | 'prefix' | 'auto'
```

- `off`：关闭提示词增强。
- `manual`：只通过命令增强。
- `prefix`：用户输入 `/enhance xxx` 时增强。
- `auto`：自动尝试增强最后一条用户消息。

## 7. Provider 层伪代码

### 7.1 主流程

```ts
async function provideLanguageModelChatResponse(
  model,
  messages,
  options,
  progress,
  token
) {
  const config = getPromptEnhancementConfig()

  let outboundMessages = messages

  if (shouldEnhancePrompt(messages, options, config)) {
    outboundMessages = await enhanceRequestMessages(messages, config, token)
  }

  return forwardToOpenAICompatibleApi({
    model,
    messages: outboundMessages,
    options,
    progress,
    token
  })
}
```

### 7.2 判断是否增强

```ts
function shouldEnhancePrompt(messages, options, config) {
  if (!config.enabled) {
    return false
  }

  if (config.mode === 'off') {
    return false
  }

  const lastUserText = getLastUserText(messages)

  if (!lastUserText) {
    return false
  }

  if (isAlreadyEnhanced(lastUserText)) {
    return false
  }

  if (hasToolRelatedParts(messages)) {
    return false
  }

  if (config.mode === 'prefix') {
    return lastUserText.startsWith(config.triggerPrefix)
  }

  if (config.mode === 'auto') {
    return isProbablyUserChatRequest(messages, options, config)
  }

  return false
}
```

### 7.3 获取最后一条用户文本

```ts
function getLastUserText(messages) {
  const last = messages[messages.length - 1]

  if (!last) {
    return undefined
  }

  if (last.role !== 'user') {
    return undefined
  }

  return last.content
    .filter(part => part.type === 'text')
    .map(part => part.value)
    .join('\n')
    .trim()
}
```

### 7.4 判断是否可能是用户聊天请求

```ts
function isProbablyUserChatRequest(messages, options, config) {
  const lastUserText = getLastUserText(messages)

  if (!lastUserText) {
    return false
  }

  if (lastUserText.length < config.autoMinLength) {
    return false
  }

  if (looksLikeInternalPrompt(lastUserText)) {
    return false
  }

  if (looksLikeToolFollowup(messages)) {
    return false
  }

  return true
}
```

### 7.5 工具调用过滤

```ts
function hasToolRelatedParts(messages) {
  return messages.some(message => {
    return message.content.some(part => {
      return part.type === 'toolCall' ||
        part.type === 'toolResult'
    })
  })
}
```

### 7.6 避免重复增强

```ts
function isAlreadyEnhanced(text) {
  return text.includes('[Prompt Enhanced]') ||
    text.includes('<!-- prompt-enhanced -->')
}
```

### 7.7 执行增强

```ts
async function enhanceRequestMessages(messages, config, token) {
  const last = messages[messages.length - 1]
  const originalText = getLastUserText(messages)

  const normalizedText = stripTriggerPrefix(
    originalText,
    config.triggerPrefix
  )

  const enhancedText = await callPromptEnhancerModel(
    normalizedText,
    config,
    token
  )

  const enhancedUserMessage = replaceMessageTextPart(last, {
    text: addEnhancementMarker(enhancedText)
  })

  return [
    ...messages.slice(0, -1),
    enhancedUserMessage
  ]
}
```

### 7.8 增强模型调用

```ts
async function callPromptEnhancerModel(rawPrompt, config, token) {
  const systemPrompt = `
你是一个提示词优化器。
请在不改变用户原意的前提下，优化用户提示词。
要求：
1. 保留用户的核心目标。
2. 补充必要的上下文约束。
3. 明确输出格式。
4. 不要直接回答用户问题。
5. 只输出优化后的提示词。
`

  const response = await callOpenAICompatibleApi({
    model: config.enhancerModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: rawPrompt }
    ],
    token
  })

  return response.text.trim()
}
```

## 8. 手动增强命令伪代码

### 8.1 命令入口

```ts
async function enhancePromptCommand() {
  const editor = vscode.window.activeTextEditor
  const selectedText = getSelectedText(editor)

  let rawPrompt = selectedText

  if (!rawPrompt) {
    rawPrompt = await vscode.env.clipboard.readText()
  }

  if (!rawPrompt) {
    rawPrompt = await vscode.window.showInputBox({
      title: 'Enhance Prompt',
      prompt: '请输入需要优化的提示词'
    })
  }

  if (!rawPrompt) {
    return
  }

  const enhancedPrompt = await callPromptEnhancerModel(rawPrompt, config, token)

  await showEnhanceResultActions({
    editor,
    selectedText,
    rawPrompt,
    enhancedPrompt
  })
}
```

### 8.2 结果动作

```ts
async function showEnhanceResultActions(context) {
  const action = await vscode.window.showQuickPick([
    '复制到剪贴板',
    '替换选中文本',
    '插入到当前编辑器',
    '打开新文档预览'
  ])

  switch (action) {
    case '复制到剪贴板':
      await vscode.env.clipboard.writeText(context.enhancedPrompt)
      break

    case '替换选中文本':
      await replaceSelection(context.editor, context.enhancedPrompt)
      break

    case '插入到当前编辑器':
      await insertAtCursor(context.editor, context.enhancedPrompt)
      break

    case '打开新文档预览':
      await openPreviewDocument(context.enhancedPrompt)
      break
  }
}
```

## 9. 状态栏交互建议

状态栏显示：

```text
$(sparkle) Prompt+
```

点击后显示 QuickPick：

```text
Enhance Selected Prompt
Enhance Clipboard Prompt
Enhance From Input
Prompt Enhancement: Off
Prompt Enhancement: Prefix
Prompt Enhancement: Auto
Open Prompt Enhancement Settings
```

## 10. 风险与规避

### 10.1 误增强内部请求

风险：provider 无法准确知道请求来源，可能增强非用户主动请求。

规避：

- 默认不开启 auto。
- auto 模式只处理最后一条 user message。
- 跳过 tool call / tool result 请求。
- 增加重复增强 marker。
- 提供前缀触发模式。

### 10.2 改变用户原意

风险：增强模型可能过度改写。

规避：

- system prompt 明确“不改变用户原意”。
- 提供 showEnhancedPrompt 配置。
- 可在日志或输出中显示增强前后内容。

### 10.3 额外延迟

风险：增强需要多一次模型调用。

规避：

- 只在 prefix/manual/auto 开启时调用。
- 可配置 enhancerModel。
- 可设置超时。

## 11. 推荐落地顺序

### 阶段一：显式触发

- 增加 `/enhance` 前缀判断。
- Provider 转发前替换最后一条 user message。
- 增加避免重复增强 marker。

### 阶段二：手动命令

- 增加 enhance prompt 命令。
- 支持选中文本、剪贴板、输入框。
- 支持复制、替换、插入、新文档预览。

### 阶段三：状态栏入口

- 增加 Prompt+ 状态栏按钮。
- 支持模式切换。
- 支持打开设置。

### 阶段四：自动增强

- 增加 auto 模式。
- 实现启发式判断。
- 增加工具调用过滤。
- 增加用户可见日志或诊断信息。

## 12. 验收标准

- `/enhance xxx` 能触发提示词增强。
- 普通请求默认不被增强。
- 工具调用链请求不会被增强。
- 增强后的请求能正常转发到 OpenAI-compatible API。
- 手动命令可增强选中文本或剪贴板内容。
- 状态栏可进入增强功能菜单。
- 用户可以关闭该功能。
