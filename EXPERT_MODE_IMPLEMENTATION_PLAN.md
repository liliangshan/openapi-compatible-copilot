# 专家模式转发实现计划

## 目标

在现有 `LanguageModelChatProvider` 转发链路中实现专家模式闭环：

1. 专家模式开启后，主模型可调用内置工具 `ask_llsoai`。
2. Provider 拦截 `ask_llsoai`，不把它交给 VS Code 工具系统。
3. Provider 使用全局设置中的专家厂商和模型启动专家模型。
4. 专家模型可复用 VS Code 传入的工具，但工具名保持原样。
5. 专家工具调用的 `callId` 加前缀：`llsoai:<runId>:<originCallId>`。
6. VS Code 执行工具后，Provider 识别 `llsoai:` 前缀，把工具结果转回专家模型继续分析。
7. 专家输出最终文本后，Provider 将专家结论作为 `ask_llsoai` 的工具结果回填给主模型。
8. 主模型结合专家结论继续输出最终回答。
9. 专家运行期间用户追加的普通消息统一转发给专家模型，由专家模型自行判断是否继续分析或结束并回传主模型，Provider 不硬编码取消关键词。

## 约定

### 专家工具调用前缀

```text
llsoai:<runId>:<originCallId>
```

含义：

- `llsoai`：表示该工具调用由 LLS OAI 专家模式发起；
- `runId`：本次专家运行 ID；
- `originCallId`：专家模型原始工具调用 ID。

示例：

```text
llsoai:expert_1710000000000_abcd:call_read_file_1
```

### 工具名不改写

专家调用工具时只改写 `callId`，不改工具名：

```text
name: read_file
callId: llsoai:<runId>:<originCallId>
```

这样 VS Code 仍然按原工具名执行工具。

## 实现步骤

### 1. 类型和状态

在 `src/provider.ts` 内部新增轻量内存状态：

```ts
interface ExpertRunState {
  runId: string;
  askExpertCallId: string;
  askExpertArguments: any;
  expertProviderId: string;
  expertModelId: string;
  expertMessages: any[];
  originalMainMessages: any[];
  createdAt: number;
}
```

Provider 类新增：

```ts
private _expertRuns: Map<string, ExpertRunState> = new Map();
```

第一版只做内存状态，窗口 reload 后丢失可以接受。

### 2. 主模型注入 ask_llsoai

当 `ConfigManager.getExpertModeConfig()` 返回：

- `enabled === true`
- `providerId` 非空
- `modelId` 非空

则给主模型 tools 中追加 `ask_llsoai`。

工具 schema：

```json
{
  "type": "function",
  "function": {
    "name": "ask_llsoai",
    "description": "Delegate a difficult problem to the configured expert model for independent analysis.",
    "parameters": {
      "type": "object",
      "properties": {
        "question": { "type": "string" },
        "context": { "type": "string" }
      },
      "required": ["question"]
    }
  }
}
```

### 3. 主模型提示词

专家模式开启后，在主模型 system prompt 中追加专家模式使用说明：

- 复杂问题可以调用 `ask_llsoai`；
- 专家会独立分析并可调用工具；
- 收到专家结论后再综合回答；
- 不要把 `ask_llsoai` 当普通用户可见回答。

### 4. 拦截 ask_llsoai

主模型流式结束整理 tool calls 时：

- 如果工具名不是 `ask_llsoai`，维持原逻辑，交给 VS Code；
- 如果工具名是 `ask_llsoai`：
  - 不 report 给 VS Code；
  - 创建 `ExpertRunState`；
  - 构造专家 messages；
  - 请求专家模型。

### 5. 专家请求

专家模型请求使用：

- 全局专家 provider/model 配置；
- 复用 OpenAI-compatible / Anthropic-compatible 转换逻辑；
- tools 使用 `options.tools`，但排除 `ask_llsoai`；
- 不注入 TODO 强制逻辑；
- 专家过程通过 `progress.report(LanguageModelTextPart)` 对用户可见。

### 6. 专家工具调用

专家返回工具调用时：

1. 保存专家 assistant tool_calls 到 `ExpertRunState.expertMessages`；
2. 对每个 tool call report 给 VS Code：

```ts
progress.report(new vscode.LanguageModelToolCallPart(
  `llsoai:${runId}:${originCallId}`,
  toolName,
  parsedArgs
));
```

3. 当前 provider 调用返回，等待 VS Code 执行工具并重新请求 provider。

### 7. 专家工具结果回流

下一轮 `provideLanguageModelChatResponse()` 开始时：

1. 扫描 messages 中的 `LanguageModelToolResultPart`；
2. 如果 `callId` 以 `llsoai:` 开头：
   - 解析 `runId` 和原始 callId；
   - 从 `_expertRuns` 取状态；
   - 把工具结果追加为专家 `tool` message；
   - 继续请求专家模型；
   - 不走主模型普通请求。

### 7.1 专家运行期间的用户追加消息

如果当前存在 active expert run，且新一轮请求没有 `llsoai:` 工具结果，但包含用户追加文本：

1. Provider 不在本地识别“取消专家/停止专家/回到主模型”等固定关键词；
2. 追加文本直接作为专家 `user` message 写入 `ExpertRunState.expertMessages`；
3. 继续请求专家模型；
4. 是否继续调用工具、继续分析，还是输出最终结论并交回主模型，由专家模型自己决定。

### 8. 专家最终结论回填主模型

专家返回普通文本且无工具调用时：

1. 输出专家最终结论到用户可见流；
2. 删除 `_expertRuns` 中对应状态；
3. 构造主模型续写 messages：
   - 原主模型 messages；
  - assistant 的 `ask_llsoai` tool call；
   - tool role 的专家结论；
4. 再请求主模型并流式输出最终回答。

## 验证计划

1. `npm run compile` 必须通过。
2. 专家模式关闭时行为不变。
3. 专家模式开启但 provider/model 缺失时不注入 `ask_llsoai`。
4. 主模型调用普通工具时行为不变。
5. 主模型调用 `ask_llsoai` 后不会把 `ask_llsoai` 交给 VS Code。
6. 专家调用工具时，VS Code 看到的 callId 形如 `llsoai:<runId>:<originCallId>`。
7. 工具结果回流后能继续专家模型。
8. 专家最终结论能回填给主模型，主模型继续输出最终回答。
