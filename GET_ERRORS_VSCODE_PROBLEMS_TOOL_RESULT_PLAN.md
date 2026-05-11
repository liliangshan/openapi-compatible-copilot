# 模型调用 get_errors 时替换为 VS Code 问题面板结果的方案

## 目标

在本项目中，当模型调用 `get_errors` 工具时，不再把该工具调用转发给外部工具系统执行，而是在扩展内部拦截该工具调用。

拦截后，扩展通过 VS Code API 读取当前“问题”面板中的诊断信息，然后把这些诊断信息包装成 `get_errors` 工具的返回内容，继续发送给模型。

也就是说，对模型来说流程仍然是：

```text
模型调用 get_errors 工具
        ↓
收到 get_errors 工具返回结果
        ↓
基于工具结果继续回答用户
```

但实际执行时，`get_errors` 的结果来自本扩展调用的：

```ts
vscode.languages.getDiagnostics()
```

而不是来自外部工具。

## 不做什么

本方案明确不做以下事情：

- 不在扩展启动时获取诊断。
- 不在用户请求一开始就注入诊断上下文。
- 不通过用户输入关键词判断是否附加诊断。
- 不影响没有调用 `get_errors` 的普通请求。
- 不影响其他工具调用。

只有模型真的调用了 `get_errors`，才获取 VS Code 问题面板内容并返回给模型。

## 推荐接入位置

本项目中建议把逻辑放在“模型工具调用处理”这一层。结合当前项目代码，推荐接入 `src/provider.ts` 中已有的内部工具续跑链路，也就是类似 `_requestModelWithTimelineTools` 的位置。

实施时可以把该链路扩展成“内部工具循环”：

- 继续处理已有 timeline 工具；
- 新增处理 `get_errors`；
- 当模型只调用这些可内部执行工具时，扩展本地执行并把 tool result 续传给模型；
- 当模型同一轮混合调用 `get_errors` 和普通外部工具时，不允许只返回部分工具结果，也不允许把 `get_errors` 转发给外部工具系统。实现上应为本轮所有 tool calls 构造 tool result：对 `get_errors` 返回本地 VS Code 诊断结果，对普通外部工具返回可重试提示，让模型下一轮单独选择一种工具调用路径。

也就是：

1. 用户消息正常发送给模型。
2. 模型返回工具调用。
3. 扩展准备执行工具调用。
4. 在执行前判断工具名。
5. 如果工具名是 `get_errors`，走本地 VS Code 诊断读取逻辑。
6. 把读取到的问题面板内容伪装成工具返回结果。
7. 将工具结果继续发送给模型。

不要把这段逻辑放在提示词增强、上下文缓存或请求初始化阶段。

## 返回数量限制

`get_errors` 每次最多返回十条诊断。

限制规则：

- 先获取 VS Code 当前已知诊断，这些诊断通常会显示在 Problems 面板中，但不保证完全等同于 Problems 面板当前界面过滤后的可见结果；
- 按严重级别排序，错误优先，其次警告、信息、提示；
- 同严重级别下按文件路径和行号排序；
- 最终只把前十条放入 `diagnostics` 返回给模型；
- `summary.total` 仍表示匹配到的诊断总数；
- 如果总数超过十条，设置 `truncated: true`，并在 `message` 中说明只返回了前十条。

这样可以避免工具返回内容过大，同时让模型优先看到最关键的问题。

## 总体流程

```text
用户发送问题
    ↓
扩展把用户消息发送给模型
    ↓
模型决定调用 get_errors
    ↓
扩展收到模型工具调用请求
    ↓
扩展判断 tool name 是否等于 get_errors
    ↓
是：调用 vscode.languages.getDiagnostics 获取 VS Code 问题面板数据
    ↓
格式化为工具返回内容
    ↓
作为 get_errors 的 tool result 返回给模型
    ↓
模型基于该工具结果生成最终回答
```

## 工具拦截判断

只判断工具调用名称，不判断用户文本。

```ts
function isGetErrorsToolCall(toolCall: ToolCall): boolean {
  return toolCall.name === 'get_errors';
}
```

如果当前项目里的工具调用名称字段不是 `name`，而是类似：

```ts
function.name
```

则可以兼容写成：

```ts
function getToolCallName(toolCall: unknown): string | undefined {
  const value = toolCall as {
    name?: string;
    function?: {
      name?: string;
    };
  };

  return value.name ?? value.function?.name;
}

function isGetErrorsToolCall(toolCall: unknown): boolean {
  return getToolCallName(toolCall) === 'get_errors';
}
```

## 工具返回内容设计

返回给模型的内容建议保持结构化，便于模型稳定解析。

```ts
interface GetErrorsToolResult {
  ok: boolean;
  source: 'vscode.languages.getDiagnostics';
  summary: {
    total: number;
    errors: number;
    warnings: number;
    information: number;
    hints: number;
  };
  diagnostics: VscodeDiagnosticItem[];
  message: string;
  truncated: boolean;
}
```

单条诊断内容：

```ts
interface VscodeDiagnosticItem {
  uri: string;
  filePath: string;
  severity: 'error' | 'warning' | 'information' | 'hint' | 'unknown';
  message: string;
  source?: string;
  code?: string;
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
}
```

最终 `tool` 消息的 `content` 使用 `JSON.stringify(result)`。

## 核心代码示例

以下代码是方案示例，具体类型名需要按项目现有模型请求和工具调用结构调整。

### 工具调用入口

```ts
async function handleModelToolCalls(
  toolCalls: ToolCall[]
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    if (isGetErrorsToolCall(toolCall)) {
      const result = await executeGetErrorsFromVscodeDiagnostics(toolCall);
      results.push(result);
      continue;
    }

    const result = await executeExistingTool(toolCall);
    results.push(result);
  }

  return results;
}
```

### get_errors 本地执行逻辑

```ts
import * as vscode from 'vscode';

async function executeGetErrorsFromVscodeDiagnostics(
  toolCall: ToolCall
): Promise<ToolResultMessage> {
  try {
    const args = parseGetErrorsArgs(toolCall.arguments);
    const data = collectVscodeDiagnostics(args);

    return createToolResultMessage(toolCall, data);
  } catch (error) {
    const fallback: GetErrorsToolResult = {
      ok: false,
      source: 'vscode.languages.getDiagnostics',
      summary: {
        total: 0,
        errors: 0,
        warnings: 0,
        information: 0,
        hints: 0
      },
      diagnostics: [],
      message: error instanceof Error ? error.message : '读取 VS Code 问题面板失败',
      truncated: false
    };

    return createToolResultMessage(toolCall, fallback);
  }
}
```

### 获取 VS Code 问题面板诊断

```ts
interface GetErrorsArgs {
  filePaths?: string[];
}

function collectVscodeDiagnostics(args: GetErrorsArgs): GetErrorsToolResult {
  const allDiagnostics = vscode.languages.getDiagnostics();
  const maxItems = 10;
  const items: VscodeDiagnosticItem[] = [];

  for (const [uri, diagnostics] of allDiagnostics) {
    if (!matchesFilePaths(uri, args.filePaths)) {
      continue;
    }

    for (const diagnostic of diagnostics) {
      items.push(toVscodeDiagnosticItem(uri, diagnostic));
    }
  }

  items.sort(compareDiagnosticItems);

  const summary = buildDiagnosticSummary(items);
  const truncated = items.length > maxItems;
  const visibleItems = items.slice(0, maxItems);

  return {
    ok: true,
    source: 'vscode.languages.getDiagnostics',
    summary,
    diagnostics: visibleItems,
    message: items.length === 0
      ? '当前 VS Code 问题面板没有匹配的诊断信息。'
      : truncated
        ? `当前 VS Code 问题面板共有 ${items.length} 条匹配诊断，已返回前 ${maxItems} 条。`
        : `当前 VS Code 问题面板共有 ${items.length} 条匹配诊断。`,
    truncated
  };
}
```

### 诊断转换

```ts
function toVscodeDiagnosticItem(
  uri: vscode.Uri,
  diagnostic: vscode.Diagnostic
): VscodeDiagnosticItem {
  return {
    uri: uri.toString(),
    filePath: uri.fsPath || uri.toString(),
    severity: toSeverity(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source,
    code: normalizeDiagnosticCode(diagnostic.code),
    range: {
      startLine: diagnostic.range.start.line + 1,
      startCharacter: diagnostic.range.start.character + 1,
      endLine: diagnostic.range.end.line + 1,
      endCharacter: diagnostic.range.end.character + 1
    }
  };
}

function toSeverity(
  severity: vscode.DiagnosticSeverity
): VscodeDiagnosticItem['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'information';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
    default:
      return 'unknown';
  }
}

function normalizeDiagnosticCode(
  code: vscode.Diagnostic['code']
): string | undefined {
  if (code === undefined) {
    return undefined;
  }

  if (typeof code === 'string' || typeof code === 'number') {
    return String(code);
  }

  return String(code.value);
}
```

### 按文件路径过滤

```ts
function matchesFilePaths(uri: vscode.Uri, filePaths?: string[]): boolean {
  if (!filePaths || filePaths.length === 0) {
    return true;
  }

  const fsPath = normalizePath(uri.fsPath || uri.toString());
  const relativePath = normalizePath(vscode.workspace.asRelativePath(uri, false));

  return filePaths.some(filePath => {
    const target = normalizePath(filePath.trim());

    if (!target) {
      return false;
    }

    return fsPath === target
      || relativePath === target
      || fsPath.endsWith('/' + target)
      || relativePath.endsWith('/' + target)
      || fsPath.startsWith(target.endsWith('/') ? target : target + '/')
      || relativePath.startsWith(target.endsWith('/') ? target : target + '/');
  });
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
```

### 统计与排序

```ts
function buildDiagnosticSummary(
  items: VscodeDiagnosticItem[]
): GetErrorsToolResult['summary'] {
  const summary = {
    total: items.length,
    errors: 0,
    warnings: 0,
    information: 0,
    hints: 0
  };

  for (const item of items) {
    if (item.severity === 'error') {
      summary.errors += 1;
    } else if (item.severity === 'warning') {
      summary.warnings += 1;
    } else if (item.severity === 'information') {
      summary.information += 1;
    } else if (item.severity === 'hint') {
      summary.hints += 1;
    }
  }

  return summary;
}

function compareDiagnosticItems(
  a: VscodeDiagnosticItem,
  b: VscodeDiagnosticItem
): number {
  const weight: Record<VscodeDiagnosticItem['severity'], number> = {
    error: 1,
    warning: 2,
    information: 3,
    hint: 4,
    unknown: 5
  };

  const severityDiff = weight[a.severity] - weight[b.severity];
  if (severityDiff !== 0) {
    return severityDiff;
  }

  const fileDiff = a.filePath.localeCompare(b.filePath);
  if (fileDiff !== 0) {
    return fileDiff;
  }

  return a.range.startLine - b.range.startLine;
}
```

### 参数解析

```ts
function parseGetErrorsArgs(raw: unknown): GetErrorsArgs {
  if (!raw) {
    return {};
  }

  if (typeof raw === 'string') {
    try {
      return normalizeGetErrorsArgs(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  return normalizeGetErrorsArgs(raw as GetErrorsArgs);
}

function normalizeGetErrorsArgs(args: GetErrorsArgs): GetErrorsArgs {
  return {
    filePaths: Array.isArray(args.filePaths)
      ? args.filePaths.filter(item => typeof item === 'string' && item.trim().length > 0)
      : undefined
  };
}
```

### 构造工具返回消息

如果项目使用 OpenAI 兼容工具调用协议，返回格式通常类似：

```ts
function createToolResultMessage(
  toolCall: ToolCall,
  result: GetErrorsToolResult
): ToolResultMessage {
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content: JSON.stringify(result, null, 2)
  };
}
```

如果项目内部协议需要工具名，可以保留 `name`：

```ts
function createToolResultMessage(
  toolCall: ToolCall,
  result: GetErrorsToolResult
): ToolResultMessage {
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    name: 'get_errors',
    content: JSON.stringify(result, null, 2)
  };
}
```

## 返回给模型的示例内容

```json
{
  "ok": true,
  "source": "vscode.languages.getDiagnostics",
  "summary": {
    "total": 2,
    "errors": 1,
    "warnings": 1,
    "information": 0,
    "hints": 0
  },
  "diagnostics": [
    {
      "uri": "file:///workspace/src/extension.ts",
      "filePath": "/workspace/src/extension.ts",
      "severity": "error",
      "message": "类型不匹配",
      "source": "typescript",
      "code": "2345",
      "range": {
        "startLine": 10,
        "startCharacter": 5,
        "endLine": 10,
        "endCharacter": 20
      }
    }
  ],
  "message": "当前 VS Code 问题面板共有 2 条匹配诊断。",
  "truncated": false
}
```

## 工具调用协议要求

使用 OpenAI 兼容工具调用协议时，不能单独把工具结果消息发给模型。

下一次请求中必须同时包含：

1. 模型上一轮返回的 assistant tool_calls 消息；
2. 每个 tool_call_id 对应的 tool result 消息。

示例：

```ts
const nextMessages = [
  ...previousMessages,
  {
    role: 'assistant',
    content: result.text || null,
    tool_calls: internalCalls.map(call => toOpenAIToolCall(call))
  },
  ...internalCalls.map(call => ({
    role: 'tool',
    tool_call_id: call.id,
    content: executeInternalToolAsJson(call)
  }))
];
```

如果同一条 assistant 消息里有多个 tool_calls，必须保证每个 tool_call_id 都有对应 tool result。不能只返回 `get_errors` 的结果而忽略其他工具调用。

## 和现有请求链路的关系

原本链路可能是：

```text
模型请求调用 get_errors
    ↓
扩展或运行器执行 get_errors 工具
    ↓
工具结果返回给模型
```

调整后链路变为：

```text
模型请求调用 get_errors
    ↓
扩展识别到 get_errors
    ↓
不再调用外部 get_errors
    ↓
扩展自己读取 VS Code 问题面板
    ↓
把读取结果作为 get_errors 工具结果返回给模型
```

对于模型来说，两者没有区别。模型仍然收到一条正常的 `tool` 返回消息。

## 错误处理

### 无诊断

返回成功，但诊断列表为空：

```json
{
  "ok": true,
  "diagnostics": [],
  "message": "当前 VS Code 问题面板没有匹配的诊断信息。"
}
```

### 读取异常

返回失败结构，但仍然是工具返回消息：

```json
{
  "ok": false,
  "diagnostics": [],
  "message": "读取 VS Code 问题面板失败"
}
```

### 诊断过多

截断返回，并告知模型：

```json
{
  "ok": true,
  "truncated": true,
  "message": "当前 VS Code 问题面板共有 500 条匹配诊断，已返回前 10 条。"
}
```

## 注意事项

1. `vscode.languages.getDiagnostics()` 读取的是 VS Code 当前已知诊断，依赖语言服务和相关扩展是否已经完成分析。
2. 某些诊断可能来自虚拟文件、未保存文件或远程文件，因此需要保留 `uri`。
3. 工具结果不宜过大，本方案固定每次最多返回十条诊断。
4. 不要在用户请求入口处自动附加诊断，否则会违背本方案的按工具调用返回原则。
5. 不要影响其他工具调用，非 `get_errors` 工具继续走原有执行逻辑。

## 最终结论

本方案将 `get_errors` 实现为一个由扩展本地接管的虚拟工具。

模型只有在真正调用 `get_errors` 时，扩展才读取 VS Code 问题面板，并把结果作为工具调用返回值发送给模型。

这样既能保持模型工具调用协议不变，又能确保返回的是当前 VS Code 已知的真实诊断信息。
