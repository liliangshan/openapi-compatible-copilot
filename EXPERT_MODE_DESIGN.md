# 专家模式完整设计方案

## 1. 背景与目标

当前项目是一个 VS Code `LanguageModelChatProvider` 扩展，用于把 Copilot Chat 的请求转发到 OpenAI-compatible 或 Anthropic-compatible 模型。

现有主流程是：

```text
VS Code Chat
  ↓
OpenAPIChatModelProvider.provideLanguageModelChatResponse()
  ↓
构造 OpenAI/Anthropic 请求
  ↓
请求当前用户选择的主模型
  ↓
把模型文本或 tool_call 通过 progress.report() 返回给 VS Code
```

本方案要增加“专家模式”：当主模型遇到复杂问题、无法判断、需要复核或用户明确要求专家参与时，主模型可以调用内置工具 `ask_expert`。扩展拦截该工具调用后，启动另一个配置好的专家模型，由专家模型作为一个受控的只读子 Agent 进行分析。

专家模式的目标不是隐藏地替主模型做一次问答，而是：

1. 专家全过程对用户可见；
2. 专家可以多轮分析和调用内部只读工具；
3. 专家调用的工具全部由扩展内部执行，和主模型/VS Code 工具调用区分开；
4. 专家最终结论同时展示给用户，并作为 `ask_expert` 的结果交回主模型；
5. 主模型基于专家结论继续生成最终回答。

最终用户体验类似：

```text
用户提问
  ↓
主模型判断需要专家
  ↓
🧠 专家模式启动
  ↓
专家分析过程、专家工具调用、专家工具结果摘要全部显示给用户
  ↓
专家最终结论显示给用户
  ↓
主模型结合专家结论输出最终回答
```

## 2. 核心原则

### 2.1 专家模式默认可见

专家模式不是隐藏内部机制。专家的工作过程、工具调用、工具结果摘要和最终结论都应该通过 `progress.report()` 输出给 VS Code Chat，让用户可见。

需要注意：这里展示的是专家的可解释工作过程，不是要求暴露模型原始 chain-of-thought。专家应输出可审计、可理解的分析步骤，例如：

- 准备检查哪些文件；
- 为什么调用某个只读工具；
- 工具结果摘要；
- 基于证据的判断；
- 最终建议。

### 2.2 主模型仍是最终整合者

专家负责调查和分析，主模型负责最终回答用户。

专家最终结论会被放回主模型续写上下文，形式等价于：

```json
{
  "role": "tool",
  "tool_call_id": "call_ask_expert_xxx",
  "content": "专家最终结论..."
}
```

主模型根据专家结论继续生成最终回答。

### 2.3 专家使用内部只读工具

专家工具不走 VS Code 原生工具机制，而由扩展内部执行。

专家工具统一使用 `expert_*` 命名空间：

```text
expert_read_file
expert_file_search
expert_grep_search
expert_get_errors
```

这样可以清楚区分工具来源：

```json
{
  "agent": "expert",
  "tool": "expert_read_file"
}
```

主模型普通工具调用仍然交给 VS Code：

```json
{
  "agent": "main",
  "tool": "read_file"
}
```

### 2.4 第一版只读，不修改项目

专家第一版只能：

- 读取文件；
- 搜索文件；
- 搜索文本；
- 查看 VS Code diagnostics/problems。

专家第一版禁止：

- 写文件；
- 执行终端命令；
- 安装依赖；
- 调用 git；
- 调用 VS Code 原生工具；
- 递归调用 `ask_expert`。

### 2.5 防循环和可控成本

必须限制：

- 每个用户 turn 最多调用专家 1 次；
- 专家最大步骤数；
- 专家总超时；
- 专家最大输出长度；
- 工具结果最大长度；
- 专家不能再次调用专家。

## 3. 总体流程

### 3.1 正常主模型流程

```text
用户消息
  ↓
provider 构造主模型 requestBody
  ↓
主模型请求，tools 中包含：
  - VS Code 原生 tools
  - ask_expert（如果专家模式启用）
  ↓
主模型输出普通文本或 tool_call
```

### 3.2 主模型调用专家

当主模型返回 `ask_expert` tool call 时：

```text
主模型产生 ask_expert tool_call
  ↓
provider 识别 toolName === ask_expert
  ↓
不把 ask_expert report 给 VS Code runtime
  ↓
provider 内部启动 runExpertAgent()
  ↓
专家全过程通过 progress.report() 显示给用户
  ↓
专家最终结论返回给 provider
  ↓
provider 构造主模型续写 messages
  ↓
再次请求主模型
  ↓
主模型最终回答通过 progress.report() 输出给用户
```

### 3.3 用户可见输出结构

建议输出格式：

````md
---

### 🧠 专家模式已启动

**专家模型**：provider/model  
**问题**：xxx

#### 💭 专家分析

专家说明当前准备如何调查。

#### 🔎 专家调用工具：`expert_grep_search`

```json
{
  "query": "ask_expert",
  "includePattern": "src/**/*.ts"
}
```

#### 📄 工具结果摘要

找到 3 处相关代码：

- `src/provider.ts`
- `src/configManager.ts`
- `src/types.ts`

#### 💭 专家分析

专家基于工具结果继续分析。

#### ✅ 专家最终结论

专家给出结论、证据、建议和风险。

---

### 综合回答

主模型结合专家结论给出最终回答。
````

## 4. 配置设计

### 4.1 类型定义

建议在 `src/types.ts` 中增加：

```ts
export type ExpertToolName =
  | 'expert_read_file'
  | 'expert_file_search'
  | 'expert_grep_search'
  | 'expert_get_errors';

export interface ExpertModeConfig {
  /** 是否启用专家模式 */
  enabled: boolean;
  /** 专家使用的 provider id */
  providerId: string;
  /** 专家使用的 model id */
  modelId: string;
  /** 专家最大循环步数 */
  maxSteps: number;
  /** 专家总超时，毫秒 */
  timeoutMs: number;
  /** 专家模型最大输出 tokens */
  maxTokens: number;
  /** 专家可用内部工具 */
  allowedTools: ExpertToolName[];
  /** 是否把专家过程显示到 VS Code Chat，默认 true */
  visibleProcess: boolean;
  /** 是否显示专家工具调用参数，默认 true */
  showToolCalls: boolean;
  /** 是否显示工具结果摘要，默认 true */
  showToolResultSummary: boolean;
  /** 是否显示原始工具结果，默认 false */
  showRawToolResult: boolean;
  /** 每个用户 turn 最多专家调用次数 */
  maxCallsPerTurn: number;
  /** 是否保存专家日志 */
  debugLogEnabled: boolean;
}
```

默认配置：

```ts
export const DEFAULT_EXPERT_MODE_CONFIG: ExpertModeConfig = {
  enabled: false,
  providerId: '',
  modelId: '',
  maxSteps: 8,
  timeoutMs: 60000,
  maxTokens: 8000,
  allowedTools: [
    'expert_read_file',
    'expert_file_search',
    'expert_grep_search',
    'expert_get_errors',
  ],
  visibleProcess: true,
  showToolCalls: true,
  showToolResultSummary: true,
  showRawToolResult: false,
  maxCallsPerTurn: 1,
  debugLogEnabled: true,
};
```

### 4.2 ConfigManager

在 `src/configManager.ts` 增加持久化 key：

```ts
private static readonly EXPERT_MODE_CONFIG_KEY = 'openapicopilot.expertModeConfig';
```

增加方法：

```ts
getExpertModeConfig(): ExpertModeConfig
updateExpertModeConfig(updates: Partial<ExpertModeConfig>): Promise<ExpertModeConfig>
```

专家 provider/model 复用现有 provider 配置和 SecretStorage 中的 API key。

### 4.3 配置 UI

在配置页面增加 “Expert Mode” 区域：

- Enable Expert Mode；
- Expert Provider；
- Expert Model；
- Max Steps；
- Timeout；
- Max Tokens；
- Visible Process；
- Show Tool Calls；
- Show Tool Result Summary；
- Allowed Tools：
  - Read files；
  - Search files；
  - Search text；
  - Read diagnostics。

第一版如果 UI 工作量较大，可以先在配置层完成，UI 后补。

## 5. `ask_expert` 工具设计

主模型可见的工具只有一个：`ask_expert`。

```ts
export const ASK_EXPERT_TOOL = {
  type: 'function',
  function: {
    name: 'ask_expert',
    description: 'Delegate a difficult problem to a visible expert agent. The expert can use read-only internal tools, show its process to the user, and return a final conclusion for the main model.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The exact problem the expert should analyze.',
        },
        context: {
          type: 'string',
          description: 'Relevant context already known by the main model.',
        },
        goal: {
          type: 'string',
          description: 'What the expert should produce.',
        },
        constraints: {
          type: 'string',
          description: 'Constraints such as read-only, no commands, no edits.',
        },
      },
      required: ['question'],
    },
  },
};
```

主模型 system prompt 追加规则：

```text
You have access to ask_expert.
Use ask_expert when the task is complex, uncertain, requires cross-file investigation, requires a second opinion, or the user explicitly asks for expert mode.
Do not use ask_expert for simple questions.
When calling ask_expert, provide a precise question, relevant context, desired goal, and constraints.
The expert process will be visible to the user.
```

## 6. 专家内部工具设计

专家只看到 `expert_*` 工具。

### 6.1 `expert_read_file`

输入：

```json
{
  "filePath": "/absolute/path/to/file",
  "startLine": 1,
  "endLine": 200
}
```

行为：读取 workspace 内指定文件的指定行范围。

限制：

- 路径必须在当前 workspace 内；
- 最大读取行数默认 500；
- 禁止读取二进制文件；
- 禁止读取超大文件；
- 返回给专家完整结果；
- 展示给用户时只展示摘要。

### 6.2 `expert_file_search`

输入：

```json
{
  "query": "src/**/*.ts",
  "maxResults": 50
}
```

行为：基于 glob 搜索 workspace 文件。

限制：

- 默认忽略 `.git`、`node_modules`、`out`、`dist`；
- 最大结果数默认 50；
- 只返回路径列表。

### 6.3 `expert_grep_search`

输入：

```json
{
  "query": "ask_expert|ExpertMode",
  "includePattern": "src/**/*.ts",
  "isRegexp": true,
  "maxResults": 50
}
```

行为：在 workspace 中执行文本搜索。

限制：

- 默认忽略大型目录；
- 限制结果数量；
- 限制每条结果长度；
- 对用户展示摘要，对专家返回可用上下文。

### 6.4 `expert_get_errors`

输入：

```json
{
  "filePaths": ["/absolute/path/to/file"]
}
```

行为：读取 VS Code diagnostics。

实现建议：

```ts
vscode.languages.getDiagnostics(uri)
```

限制：

- 不传 `filePaths` 时读取当前 workspace diagnostics；
- 最大返回 100 条；
- 返回文件、范围、severity、message、source。

## 7. 专家 Agent 循环

### 7.1 新增文件

建议新增：

```text
src/expertMode.ts
```

职责：

- 读取专家配置；
- 构造专家模型请求；
- 管理专家多轮循环；
- 执行内部只读工具；
- 通过事件回调把专家过程交给 provider 显示；
- 返回专家最终结论。

### 7.2 类型设计

```ts
export interface ExpertRequest {
  question: string;
  context?: string;
  goal?: string;
  constraints?: string;
  mainModelId: string;
  currentMessages: any[];
  workspaceFolders: string[];
  abortSignal?: AbortSignal;
}

export interface ExpertResult {
  ok: boolean;
  finalAnswer: string;
  steps: number;
  usedTools: string[];
  events: ExpertEvent[];
  error?: string;
}

export type ExpertEvent =
  | { type: 'start'; question: string; expertModelId: string }
  | { type: 'analysis'; content: string }
  | { type: 'tool_call'; toolName: string; args: unknown }
  | { type: 'tool_result'; toolName: string; summary: string; rawLength: number }
  | { type: 'final'; content: string }
  | { type: 'error'; message: string };

export interface ExpertRunOptions {
  onEvent?: (event: ExpertEvent) => void;
}

export async function runExpertAgent(
  input: ExpertRequest,
  options?: ExpertRunOptions
): Promise<ExpertResult>;
```

### 7.3 循环逻辑

```text
runExpertAgent()
  ↓
emit start
  ↓
构造专家 system prompt
  ↓
构造专家 user message，包含 question/context/goal/constraints
  ↓
for step in maxSteps:
    请求专家模型
    如果专家输出 analysis 文本：
        emit analysis
    如果专家输出 expert_* tool_call：
        emit tool_call
        executeExpertTool()
        emit tool_result
        把 tool result 加入 expert messages
        continue
    如果专家输出 final：
        emit final
        return ExpertResult
  ↓
超过 maxSteps 或 timeout：
    emit error
    return failed ExpertResult
```

### 7.4 专家 prompt

专家 system prompt：

```text
You are a visible expert agent inside a VS Code chat provider.

Your work is visible to the user. Provide concise, auditable analysis updates instead of hidden chain-of-thought.

You may use only the provided expert_* read-only tools.
Do not modify files.
Do not run terminal commands.
Do not perform git operations.
Do not call ask_expert.

When you need workspace information, call an expert_* tool.
After each tool result, continue analysis or call another tool if needed.

When finished, provide a final answer with:
1. Summary
2. Evidence
3. Recommended action
4. Risks or uncertainties
```

## 8. Provider 集成设计

### 8.1 注入 `ask_expert`

在 `provideLanguageModelChatResponse()` 中构造 `requestBody.tools` 时：

```ts
const expertConfig = this._configManager.getExpertModeConfig();

if (options.tools && options.tools.length > 0) {
  requestBody.tools = convertVsCodeTools(options.tools);
}

if (expertConfig.enabled && expertConfig.providerId && expertConfig.modelId && !expertAlreadyUsed) {
  requestBody.tools = [...(requestBody.tools ?? []), ASK_EXPERT_TOOL];
}
```

### 8.2 拦截 `ask_expert`

当前代码在流式结束时会遍历 `pendingToolCalls` 并 `progress.report(new vscode.LanguageModelToolCallPart(...))`。

需要改为：

```text
如果 toolName !== ask_expert：
  继续原有逻辑，report 给 VS Code runtime

如果 toolName === ask_expert：
  不 report 给 VS Code runtime
  provider 内部执行专家模式
  专家过程通过 progress.report(TextPart) 展示
  专家 finalAnswer 放入主模型续写上下文
```

### 8.3 专家过程展示

provider 传入 `onEvent`：

```ts
const expertResult = await runExpertAgent(expertInput, {
  onEvent: (event) => {
    const markdown = renderExpertEvent(event, expertConfig);
    if (markdown) {
      progress.report(new vscode.LanguageModelTextPart(markdown));
    }
  },
});
```

`renderExpertEvent()` 根据配置输出 Markdown：

- `start`：显示专家模式启动；
- `analysis`：显示专家分析；
- `tool_call`：显示工具名和参数；
- `tool_result`：显示工具结果摘要；
- `final`：显示专家最终结论；
- `error`：显示专家失败原因。

### 8.4 主模型续写

专家完成后，构造主模型续写 messages：

```ts
const continuationMessages = [
  ...requestBody.messages,
  {
    role: 'assistant',
    tool_calls: [
      {
        id: askExpertCallId,
        type: 'function',
        function: {
          name: 'ask_expert',
          arguments: JSON.stringify(askExpertArgs),
        },
      },
    ],
  },
  {
    role: 'tool',
    tool_call_id: askExpertCallId,
    content: expertResult.ok
      ? expertResult.finalAnswer
      : `[Expert mode failed]\n${expertResult.error}`,
  },
];
```

然后再次请求主模型，流式输出最终回答。

续写阶段建议：

- 不再提供 `ask_expert`；
- 可以保留普通 VS Code tools，也可以第一版关闭所有 tools 简化；
- 标记 `expertAlreadyUsed = true`；
- 防止主模型再次调用专家。

## 9. 可见性与上下文策略

### 9.1 通过 `progress.report()` 输出专家过程

专家所有可见过程都通过：

```ts
progress.report(new vscode.LanguageModelTextPart(markdown));
```

这意味着：

- 用户可以看到专家参考；
- VS Code 后续可能把这些可见 assistant 文本带回上下文；
- 专家内容成为聊天历史的一部分。

### 9.2 同时作为主模型上下文

专家最终结论不仅展示给用户，还作为 tool result 进入主模型续写请求。

这保证主模型不会只依赖“显示过的文本”，而是明确收到一个结构化专家结果。

### 9.3 完整工具结果不默认展示

为了避免刷屏：

- 用户看到工具调用参数；
- 用户看到工具结果摘要；
- 专家模型收到完整工具结果；
- debug 日志保存完整工具结果；
- `showRawToolResult` 默认 false。

## 10. 日志与调试

如果 `debugLogEnabled` 为 true，保存专家全过程到 `.LLSOAI`：

```text
~/.LLSOAI/expert_logs/expert_<sessionId>_<turnId>_<timestamp>.json
```

日志结构：

```json
{
  "sessionId": "...",
  "turnId": "...",
  "mainModelId": "...",
  "expertModelId": "...",
  "question": "...",
  "events": [
    {
      "type": "tool_call",
      "toolName": "expert_read_file",
      "args": {}
    }
  ],
  "finalAnswer": "...",
  "startedAt": "...",
  "finishedAt": "...",
  "durationMs": 12345
}
```

## 11. 安全限制

### 11.1 路径安全

所有文件路径必须：

- 解析为绝对路径；
- 规范化；
- 确认位于当前 workspace folder 下；
- 禁止通过 `../` 越界。

### 11.2 工具限制

只允许配置中的 `allowedTools`。

即使专家模型请求了其他工具，也返回错误：

```text
Tool not allowed: xxx
```

### 11.3 输出限制

限制：

- 单个工具结果最大字符数；
- 专家最终结论最大字符数；
- 专家可见过程最大字符数；
- 超限时截断并标注。

### 11.4 循环限制

限制：

- `maxSteps`；
- `timeoutMs`；
- `maxCallsPerTurn`；
- 专家不允许 `ask_expert`。

## 12. 错误处理

### 12.1 专家失败

专家失败时仍然展示给用户：

```md
#### ⚠️ 专家模式失败

原因：timeout after 60000ms
```

同时给主模型的 tool result：

```text
[Expert mode failed]
Reason: timeout after 60000ms.
Continue using available context and explain uncertainty.
```

### 12.2 工具失败

工具失败时：

- 向用户展示失败摘要；
- 把失败结果返回给专家模型；
- 专家可选择换工具或给出不确定结论。

### 12.3 主模型续写失败

如果专家完成但主模型续写失败：

- 用户至少已经看到专家过程和专家最终结论；
- provider 抛出主模型请求错误；
- debug 日志记录续写失败原因。

## 13. 代码改动范围

建议改动文件：

```text
src/types.ts
src/configManager.ts
src/provider.ts
src/expertMode.ts        新增
src/expertTools.ts       新增，可选
src/expertRenderer.ts    新增，可选
src/views/configView.ts  可选，配置 UI
assets/configView/*      可选，配置 UI
```

### 13.1 `src/types.ts`

新增：

- `ExpertModeConfig`
- `ExpertToolName`
- 可选：`ExpertEvent`、`ExpertResult`

### 13.2 `src/configManager.ts`

新增：

- `getExpertModeConfig()`
- `updateExpertModeConfig()`
- 默认配置合并逻辑。

### 13.3 `src/provider.ts`

新增/调整：

- 构造主模型 tools 时追加 `ask_expert`；
- 主模型 system prompt 追加专家模式说明；
- 拦截 `ask_expert`；
- 调用 `runExpertAgent()`；
- 将专家事件渲染后 `progress.report()`；
- 发送主模型续写请求；
- 防止同 turn 重复调用专家。

### 13.4 `src/expertMode.ts`

新增：

- 专家模型请求；
- 专家循环；
- 专家 tool call 解析；
- 专家 final answer 判断；
- timeout/maxSteps 管理。

### 13.5 `src/expertTools.ts`

可选新增：

- `executeExpertTool()`；
- `expert_read_file`；
- `expert_file_search`；
- `expert_grep_search`；
- `expert_get_errors`。

### 13.6 `src/expertRenderer.ts`

可选新增：

- `renderExpertEvent()`；
- 把专家事件转换成 Markdown；
- 根据配置控制是否显示 tool args/raw result。

## 14. 实现阶段建议

### 阶段一：可见专家骨架

- 增加专家配置；
- 注入 `ask_expert`；
- 拦截 `ask_expert`；
- 专家模型单次请求；
- 专家结果可见输出；
- 主模型续写。

### 阶段二：专家内部只读工具

- 实现 `expert_read_file`；
- 实现 `expert_file_search`；
- 实现 `expert_grep_search`；
- 实现 `expert_get_errors`；
- 实现专家多步循环。

### 阶段三：日志和安全

- 保存 expert debug 日志；
- 限制路径；
- 限制工具结果长度；
- 限制 maxSteps/timeout；
- 完善错误处理。

### 阶段四：配置 UI

- 开关专家模式；
- 选择专家 provider/model；
- 配置可见性、最大步数、超时、工具权限。

## 15. 测试计划

### 15.1 功能测试

1. 专家模式关闭时，主模型不会收到 `ask_expert`；
2. 专家模式开启时，主模型 tools 包含 `ask_expert`；
3. 主模型调用 `ask_expert` 后，provider 不把它交给 VS Code runtime；
4. 专家开始事件显示给用户；
5. 专家分析事件显示给用户；
6. 专家工具调用显示给用户；
7. 工具结果摘要显示给用户；
8. 专家最终结论显示给用户；
9. 主模型能基于专家最终结论续写回答。

### 15.2 安全测试

1. 专家无法读取 workspace 外文件；
2. 专家无法调用非 `expert_*` 工具；
3. 专家无法执行命令；
4. 专家无法写文件；
5. 专家无法递归调用 `ask_expert`；
6. 超过 maxSteps 后终止；
7. 超过 timeout 后终止。

### 15.3 兼容测试

1. OpenAI-compatible 专家模型可用；
2. Anthropic 专家模型可用；
3. 主模型为 OpenAI-compatible、专家为 Anthropic；
4. 主模型为 Anthropic、专家为 OpenAI-compatible；
5. 普通 VS Code tools 仍然能由主模型正常调用。

## 16. 推荐第一版范围

第一版建议实现：

- `ExpertModeConfig`；
- `ConfigManager` 专家配置读写；
- `ask_expert` 工具注入；
- `ask_expert` 拦截；
- 专家模式可见输出；
- 专家最终结论回传主模型；
- 主模型续写；
- 专家只读工具：
  - `expert_read_file`
  - `expert_file_search`
  - `expert_grep_search`
  - `expert_get_errors`
- 防循环、防超时、防越界；
- debug 日志。

第一版不建议实现：

- 专家写文件；
- 专家执行命令；
- 专家调用 VS Code 原生工具；
- 专家递归调用专家；
- 自动失败兜底调用专家；
- 复杂 UI 动画。

## 17. 最终结论

专家模式应设计为一个可见的、受控的、只读的专家子 Agent。

主模型通过 `ask_expert` 请求专家帮助；provider 内部拦截该请求并启动专家模型。专家使用扩展内部的 `expert_*` 只读工具完成多轮调查，所有专家过程通过 `progress.report()` 展示给用户。专家最终结论既展示给用户，也作为 `ask_expert` 的结果传回主模型。主模型再基于专家结论输出最终回答。

该方案的优势：

- 用户能看到专家参考和过程；
- 主模型和专家工具调用来源清晰可分；
- 专家权限安全可控；
- 不依赖 VS Code 原生工具回调机制；
- 可逐步扩展到更多内部工具；
- 适合当前项目的 provider 层架构。
