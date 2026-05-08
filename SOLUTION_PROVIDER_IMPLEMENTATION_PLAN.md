# 方案提供商实现方案

## 0. 当前专家模式分析

本项目已经实现了一套“全局 + 项目”的专家模式配置，并且已经接入到 `LanguageModelChatProvider` 转发链路中。新增“方案提供商”建议尽量复用专家模式的设计方式、配置结构、UI 交互与转发闭环，只在业务语义和“方案最终输出前专家审查”开关上做扩展。

### 0.1 配置层现状

专家模式当前涉及以下文件：

- `package.json`
  - 注册 VS Code 配置项：
    - `openapicopilot.expertMode.enabled`：全局是否启用专家模式，`application` scope。
    - `openapicopilot.expertMode.enabledState`：项目启用状态，`resource` scope，取值为 `global | enabled | disabled`。
    - `openapicopilot.expertMode.providerId`：专家提供商 ID，`resource` scope。
    - `openapicopilot.expertMode.modelId`：专家模型 ID，`resource` scope。
- `src/types.ts`
  - `ExpertModeConfig`：全局/生效配置结构，包含 `enabled/providerId/modelId`。
  - `WorkspaceExpertModeConfig`：项目配置结构，在 `ExpertModeConfig` 基础上增加 `enabledState`。
- `src/configManager.ts`
  - `getExpertModeConfig()`：读取全局专家模式，兼容 `globalState` 旧存储和 VS Code global 配置。
  - `getWorkspaceExpertModeConfig()`：读取项目专家模式，项目 provider/model 为空表示使用全局 provider/model。
  - `getEffectiveExpertModeConfig()`：合并全局与项目配置。
    - 启用状态由项目 `enabledState` 决定：`global` 跟随全局，`enabled` 强制开，`disabled` 强制关。
    - provider/model 只有项目两者都配置时才覆盖全局，否则使用全局专家模型。
  - `updateExpertModeConfig()`：写入全局专家配置。
  - `updateWorkspaceExpertModeConfig()`：写入项目专家配置。
- `src/views/configView.ts` 与 `assets/configView/configView.js/css`
  - 全局设置中展示专家模式开关、专家提供商、专家模型。
  - 项目设置中展示 `Use global / Force enabled / Force disabled` 和项目级 provider/model 覆盖。
  - 可选提供商通过 `getExpertSelectableProviders()` 过滤：只显示已启用 provider，且只显示 `isUserSelectable === true` 的模型。

### 0.2 专家模式全局与项目合并规则

当前专家模式的合并规则可以总结为：

```text
全局配置：
  enabled + providerId + modelId

项目配置：
  enabledState: global | enabled | disabled
  providerId + modelId 可选覆盖

生效配置：
  enabled:
    项目 enabledState=global   => 使用全局 enabled
    项目 enabledState=enabled  => 强制 true
    项目 enabledState=disabled => 强制 false

  provider/model:
    项目 providerId 和 modelId 都非空 => 使用项目模型
    否则 => 使用全局模型
```

该规则适合直接迁移给“方案提供商”。

### 0.3 转发层现状

专家模式当前核心实现集中在 `src/provider.ts`：

- 常量：
  - `ASK_LLSOAI_TOOL_NAME = 'ask_llsoai'`
  - `EXPERT_TOOL_CALL_PREFIX = 'llsoai'`
- `ExpertRunState`
  - 保存一次专家运行状态，包括专家 runId、原主模型消息、专家消息、专家工具调用状态、主模型上下文、主模型工具等。
- 主请求阶段：
  - `_getConfiguredExpertModel()` 读取生效专家配置并解析成可请求的 provider/model 上下文。
  - `_withExpertPrompt()` 在专家模式启用时向主模型 system prompt 追加专家模式说明。
  - `_buildAskLlsoaiTool()` 向主模型注入内置工具 `ask_llsoai`。
- 拦截阶段：
  - 主模型返回 tool call 后，如果工具名为 `ask_llsoai`，provider 内部拦截，不交给 VS Code 工具系统。
  - 调用 `_startExpertRun()` 创建专家运行状态。
- 专家运行阶段：
  - `_runExpertTurn()` 使用配置好的专家 provider/model 请求专家模型。
  - 专家可复用主模型可见工具，但 `_filterExpertTools()` 会过滤 TODO 工具。
  - 专家工具调用 report 给 VS Code 时，callId 改写为：

```text
llsoai:<runId>:<originCallId>
```

- 工具结果回流：
  - 下一轮 provider 请求开始时识别 `llsoai:` 前缀，把工具结果转回专家消息，并继续专家模型。
- 专家结束：
  - 专家最终文本返回后，`_finishExpertAndContinueMain()` 将专家结论作为 `ask_llsoai` 的 tool result 回填给主模型。
  - 主模型继续生成最终回答。

### 0.4 可复用点与注意点

可直接复用：

1. 全局/项目配置合并模式。
2. provider/model 选择 UI 和过滤逻辑。
3. 内置工具注入、拦截、运行状态、工具 callId 前缀、工具结果回流模式。
4. `MainRequestContext`、`_requestModel()`、采样参数应用、OpenAI/Anthropic/v1 response 转换逻辑。

需要避免的问题：

1. 方案提供商和专家模式都可能产生内部工具调用，必须使用不同 callId 前缀，避免误回流。
2. 方案模型如果最终输出前需要调用专家审查，需要避免专家再次触发方案提供商或循环审查。
3. 项目级 provider/model 覆盖规则需要保持一致，降低用户理解成本。
4. 若专家模式关闭或专家模型不可用，“方案专家审查”开关即使开启也应安全降级。

---

## 1. 新功能目标：方案提供商

新增“方案提供商”（Solution Provider）能力，用于把需要先出方案、计划、设计、实施路径的任务委托给一个专门配置的方案模型。

整体定位：

```text
主模型：负责理解用户请求、决定是否需要方案模型、最终整合输出。
方案提供商：负责生成方案、计划、架构设计、实施步骤、风险和验证建议；如果开启方案专家审查，则负责在最终输出前调用专家审查并吸收审查意见。
专家模型：可选，由方案提供商通过 `ask_llsoai` 调用，对方案初稿进行独立审查，审查结果先回到方案模型，再由方案模型修订/确认后回主模型。
```

用户希望该能力“基本上和专家模式一模一样”，因此建议实现为与专家模式平级的内置委托能力：

- 主模型可调用内置工具 `ask_solution_provider`。
- Provider 内部拦截该工具调用。
- 使用全局/项目配置的方案 provider/model 启动方案模型。
- 方案模型可复用 VS Code 原始工具，工具 callId 使用独立前缀。
- 新增一个复选框：如果专家模式可用，方案模型最终输出前是否必须至少调用一次 `ask_llsoai` 进行专家审查。
- 当“方案专家审查”开启且专家模式可用时，Provider 在方案模型 tools 中额外注入 `ask_llsoai`，但不注入 `ask_solution_provider`。
- 方案模型调用 `ask_llsoai` 时，Provider 内部拦截并启动专家模型；专家结果作为 `ask_llsoai` 的 tool result 回填给方案模型，而不是直接回主模型。
- 方案模型根据专家结果修订或确认方案后，将最终方案结果回填给主模型。

### 1.1 建议命名

用户可见名称：

- 中文：方案提供商
- 英文：Solution Provider

内部命名建议：

- 工具名：`ask_solution_provider`
- 工具 callId 前缀：`llsoai_solution`
- 配置前缀：`openapicopilot.solutionProvider.*`
- 类型：
  - `SolutionProviderConfig`
  - `WorkspaceSolutionProviderConfig`
- 状态：
  - `SolutionRunState`

### 1.2 方案提供商与专家模式的区别

| 项目 | 专家模式 | 方案提供商 |
|---|---|---|
| 核心目标 | 独立调查、分析、复核复杂问题 | 输出方案、设计、计划、实施步骤 |
| 触发工具 | `ask_llsoai` | `ask_solution_provider` |
| callId 前缀 | `llsoai:<runId>:<callId>` | `llsoai_solution:<runId>:<callId>` |
| 全局/项目配置 | 已有 | 新增，规则一致 |
| 完成后回主模型 | 是 | 是 |
| 专家审查 | 主模型直接调用 `ask_llsoai` | 方案模型在最终输出前可调用 `ask_llsoai`，专家结果回到方案模型 |

---

## 2. 第一阶段：配置相关

第一阶段只做配置、类型、UI、读取生效配置，不接入转发链路。目标是让用户可以在全局和项目设置里配置方案提供商，并配置“方案最终输出前是否调用专家审查”。

### 2.1 配置项设计

在 `package.json` 的 `contributes.configuration.properties` 增加：

```json
{
  "openapicopilot.solutionProvider.enabled": {
    "type": "boolean",
    "default": false,
    "description": "Enable solution provider. When enabled, the main model can delegate planning and solution design tasks to a selected solution model.",
    "scope": "application"
  },
  "openapicopilot.solutionProvider.enabledState": {
    "type": "string",
    "enum": ["global", "enabled", "disabled"],
    "default": "global",
    "description": "Workspace solution provider enabled state. Use global, force enabled, or force disabled for this workspace.",
    "scope": "resource"
  },
  "openapicopilot.solutionProvider.providerId": {
    "type": "string",
    "default": "",
    "description": "Provider ID used by solution provider.",
    "scope": "resource"
  },
  "openapicopilot.solutionProvider.modelId": {
    "type": "string",
    "default": "",
    "description": "Model ID used by solution provider.",
    "scope": "resource"
  },
  "openapicopilot.solutionProvider.reviewWithExpert": {
    "type": "boolean",
    "default": false,
    "description": "When enabled and expert mode is available, the solution provider model must call ask_llsoai at least once to review the proposed solution before finalizing.",
    "scope": "resource"
  }
}
```

说明：

- `enabled` 使用 `application` scope，作为全局开关。
- `enabledState/providerId/modelId/reviewWithExpert` 使用 `resource` scope，支持项目覆盖。
- `reviewWithExpert` 是新增复选框对应配置。
- `reviewWithExpert` 建议放在方案提供商配置下，而不是专家模式配置下，因为它描述的是“方案模型最终输出前是否必须经过专家审查”的后处理策略。

### 2.2 类型设计

在 `src/types.ts` 新增：

```ts
export interface SolutionProviderConfig {
  enabled: boolean;
  providerId: string;
  modelId: string;
  /** Whether the solution provider must call ask_llsoai for expert review before finalizing */
  reviewWithExpert: boolean;
}

export type WorkspaceSolutionProviderEnabledState = 'global' | 'enabled' | 'disabled';

export interface WorkspaceSolutionProviderConfig extends SolutionProviderConfig {
  enabledState: WorkspaceSolutionProviderEnabledState;
}
```

### 2.3 ConfigManager 设计

在 `src/configManager.ts` 参考专家模式新增常量：

```ts
private static readonly SOLUTION_PROVIDER_CONFIG_KEY = 'openapicopilot.solutionProviderConfig';
private static readonly SOLUTION_PROVIDER_ENABLED_CONFIG_KEY = 'solutionProvider.enabled';
private static readonly SOLUTION_PROVIDER_PROVIDER_CONFIG_KEY = 'solutionProvider.providerId';
private static readonly SOLUTION_PROVIDER_MODEL_CONFIG_KEY = 'solutionProvider.modelId';
private static readonly SOLUTION_PROVIDER_REVIEW_WITH_EXPERT_CONFIG_KEY = 'solutionProvider.reviewWithExpert';
private static readonly WORKSPACE_SOLUTION_PROVIDER_ENABLED_STATE_CONFIG_KEY = 'solutionProvider.enabledState';
```

新增方法：

```ts
getSolutionProviderConfig(): SolutionProviderConfig
getWorkspaceSolutionProviderConfig(): WorkspaceSolutionProviderConfig
getEffectiveSolutionProviderConfig(): SolutionProviderConfig
updateSolutionProviderConfig(settings: Partial<SolutionProviderConfig>): Promise<SolutionProviderConfig>
updateWorkspaceSolutionProviderConfig(settings: Partial<WorkspaceSolutionProviderConfig>): Promise<WorkspaceSolutionProviderConfig>
```

合并规则与专家模式保持一致：

```text
enabled:
  workspace.enabledState=global   => global.enabled
  workspace.enabledState=enabled  => true
  workspace.enabledState=disabled => false

provider/model:
  workspace providerId + modelId 都非空 => workspace
  否则 => global

reviewWithExpert:
  建议支持项目覆盖，但不新增三态。
  简化规则：workspace inspect 有值 => 用 workspace；否则用 global。
```

其中 `reviewWithExpert` 的读取建议使用 `inspect<boolean>()`，以区分“项目未设置”和“项目明确 false”：

```ts
const reviewInspect = config.inspect<boolean>(ConfigManager.SOLUTION_PROVIDER_REVIEW_WITH_EXPERT_CONFIG_KEY);
const workspaceReview = reviewInspect?.workspaceValue;
const globalReview = reviewInspect?.globalValue ?? stored?.reviewWithExpert ?? false;
const effectiveReview = workspaceReview ?? globalReview;
```

这样项目可以明确关闭全局的“专家审查”。

### 2.4 UI 设计

#### 2.4.1 全局设置

在全局设置的 Expert Mode 附近新增 Solution Provider 卡片：

- 复选框：启用方案提供商
- 下拉框：方案提供商
- 下拉框：方案模型
- 复选框：方案最终输出前调用专家审查
- 帮助文本：
  - “启用后，主模型可以把方案设计、实施计划等任务委托给所选方案模型。”
  - “开启专家审查后，若专家模式当前可用，方案模型会在最终输出前至少调用一次 `ask_llsoai` 审查方案；专家结果会先回到方案模型，由方案模型修订/确认后再回主模型。”

#### 2.4.2 项目设置

项目设置参考专家模式：

- 状态单选：
  - 使用全局
  - 当前项目强制开启
  - 当前项目强制关闭
- 下拉框：项目方案提供商覆盖
- 下拉框：项目方案模型覆盖
- 复选框：当前项目方案最终输出前调用专家审查

项目 provider/model 留空时使用全局方案模型。

#### 2.4.3 前端消息

在 `assets/configView/configView.js` 新增消息：

- `getSolutionProviderSettings`
- `updateSolutionProviderSettings`
- 面板保存时扩展 `saveGlobalSettings` 和 `saveProjectSettings` 的 payload：
  - `solutionProviderEnabled`
  - `solutionProviderProviderId`
  - `solutionProviderModelId`
  - `solutionProviderReviewWithExpert`
  - `solutionProviderEnabledState`

在 `src/views/configView.ts` 新增处理：

- `getSolutionProviderSettings`
  - 返回 `settings/globalSettings/workspaceSettings/providers`。
- `updateSolutionProviderSettings`
  - 更新全局方案提供商。
- `saveGlobalSettings`
  - 同时保存全局方案提供商配置。
- `saveProjectSettings`
  - 同时保存项目方案提供商配置。

可复用 `getExpertSelectableProviders()`，也可以重命名为更通用的：

```ts
function getModelSelectableProviders(providers: any[]): any[]
```

UI 改造需要覆盖所有入口，避免只改其中一套设置页：

- `assets/configView/configView.js`
  - 顶部状态变量：`solutionProviderSettings`、`projectSolutionProviderSettings`、`effectiveSolutionProviderSettings`、`solutionSelectableProviders`。
  - 多语言 `translations` 全语言 key。
  - `solutionProviderSettingsLoaded` message handler。
  - provider/model 下拉联动函数。
  - global settings modal 保存逻辑。
  - project settings modal 保存逻辑。
- `src/views/configView.ts`
  - sidebar `_handleMessage()` 增加 `getSolutionProviderSettings` / `updateSolutionProviderSettings`。
  - `_collectSettings()` 增加全局、项目、生效方案提供商配置。
  - `_getHtmlForMode('global')` 增加全局方案提供商卡片。
  - `_getHtmlForMode('project')` 增加项目方案提供商卡片。
  - panel `saveGlobalSettings` / `saveProjectSettings` 增加方案提供商 payload。
- `assets/configView/configView.css`
  - 复用 expert 样式或抽象为通用 provider setting card 样式。

### 2.5 第一阶段验收标准

1. `npm run compile` 通过。
2. VS Code Settings 中能看到 `openapicopilot.solutionProvider.*` 配置项。
3. 全局设置 UI 可保存并回显方案提供商配置。
4. 项目设置 UI 可保存并回显方案提供商配置。
5. 项目 `enabledState` 能正确覆盖全局启用状态。
6. 项目 provider/model 留空时使用全局 provider/model。
7. `reviewWithExpert` 能支持项目覆盖全局。
8. 第一阶段不改变任何聊天转发行为。

---

## 3. 第二阶段：转发接入

第二阶段把方案提供商接入 `src/provider.ts`，实现与专家模式类似的完整闭环。

### 3.1 新增运行状态

新增常量：

```ts
const ASK_SOLUTION_PROVIDER_TOOL_NAME = 'ask_solution_provider';
const SOLUTION_TOOL_CALL_PREFIX = 'llsoai_solution';
```

新增状态结构：

```ts
interface SolutionRunState {
  runId: string;
  sessionId: string;
  askSolutionCallId: string;
  askSolutionArguments: any;
  solutionContextRecords: any[];
  solutionProviderId: string;
  solutionModelId: string;
  solutionRequestContext: MainRequestContext;
  solutionMessages: any[];
  consumedToolResultCallIds: Set<string>;
  pendingSolutionToolCallIds: string[];
  pendingSolutionToolCalls: CollectedToolCall[];
  pendingSolutionToolResults: Map<string, string>;
  pendingSolutionUserFollowUps: string[];
  originalMainMessages: any[];
  mainRequestContext: MainRequestContext;
  mainTools: readonly any[];
  /** Whether the configured solution model supports tool calling */
  solutionToolCalling: boolean;
  /** Reason why expert review was skipped or degraded */
  reviewSkippedReason?: string;
  /** Number of times Provider reminded the solution model to call ask_llsoai */
  forceExpertReviewReminderCount: number;
  /** Whether solution expert review is enabled by effective config */
  reviewWithExpert: boolean;
  /** Whether expert mode is currently available with provider/model/apiKey */
  expertReviewAvailable: boolean;
  /** Whether first final solution output must be preceded by at least one expert review */
  requireInitialExpertReview: boolean;
  /** Whether at least one expert review has completed for this solution run */
  expertReviewCompleted: boolean;
  /** Number of expert reviews requested by the solution model */
  expertReviewCount: number;
  /** The solution model's ask_llsoai tool call currently waiting for expert result */
  pendingExpertReviewCallId?: string;
  createdAt: number;
}
```

建议增加审查次数上限，避免方案模型反复调用专家造成循环：

```ts
const MAX_SOLUTION_EXPERT_REVIEW_COUNT = 2;
const MAX_FORCE_EXPERT_REVIEW_REMINDERS = 2;
```

字段语义：

- `reviewWithExpert`：生效配置是否开启方案专家审查。
- `expertReviewAvailable`：当前专家模式是否可用，要求专家模式开启、provider/model/API key 均有效。
- `requireInitialExpertReview`：当 `reviewWithExpert && expertReviewAvailable` 时为 `true`，表示方案模型第一次最终输出前必须完成至少一次专家审查。
- `expertReviewCompleted`：专家审查至少完成一次后置为 `true`。
- `expertReviewCount`：控制后续可选复审次数，防止循环。
- `pendingExpertReviewCallId`：方案模型已调用 `ask_llsoai` 但专家结果尚未回填时记录原始 callId。
- `solutionToolCalling`：方案模型是否支持工具调用；若为 `false`，则不能注入 `ask_llsoai`，也不能强制专家审查。
- `reviewSkippedReason`：专家审查跳过或降级原因，例如专家不可用、方案模型不支持工具调用、强制提醒次数耗尽等。
- `forceExpertReviewReminderCount`：Provider 因方案模型未调用 `ask_llsoai` 而追加提醒的次数，超过上限后降级，避免循环。

Provider 类新增：

```ts
private _solutionRuns: Map<string, SolutionRunState> = new Map();
private _activeSolutionRunId?: string;
```

### 3.2 获取配置模型

新增：

```ts
private async _getConfiguredSolutionProviderModel(): Promise<(MainRequestContext & {
  providerName: string;
  modelName: string;
  reviewWithExpert: boolean;
  toolCalling: boolean;
}) | null>
```

逻辑参考 `_getConfiguredExpertModel()`：

1. 读取 `getEffectiveSolutionProviderConfig()`。
2. 如果 `enabled/providerId/modelId` 不完整，返回 `null`。
3. 从 `getProvidersWithSecrets()` 找到 provider 和 model。
4. 返回完整 `MainRequestContext`、`reviewWithExpert` 和 `toolCalling`。

`toolCalling` 处理规则：

```ts
const solutionToolCalling = solutionModel.toolCalling ?? true;
state.requireInitialExpertReview =
  state.reviewWithExpert &&
  state.expertReviewAvailable &&
  solutionToolCalling !== false;
```

如果方案模型 `toolCalling === false`：

- 不向方案模型传任何 tools，包括 `ask_llsoai`。
- 不强制专家审查。
- `reviewSkippedReason = 'solution model does not support tool calling'`。

专家模型也要记录 `toolCalling` 能力：

- 如果专家模型 `toolCalling === false`，专家仍可进行纯文本审查。
- 但不要向专家请求传递 VS Code tools，避免 API 报错。

### 3.3 向主模型注入工具

新增工具 schema：

```ts
private _buildAskSolutionProviderTool(): any {
  return {
    name: ASK_SOLUTION_PROVIDER_TOOL_NAME,
    description: 'Delegate solution design, implementation planning, architecture proposal, risk analysis, or step-by-step plan generation to the configured LLS OAI solution provider model. The solution provider will not receive previous conversation history, so the request must be self-contained.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The self-contained solution design task. Include goals, constraints, files, current state, expected deliverables, risks, and acceptance criteria.'
        },
        context: {
          type: 'string',
          description: 'Optional record-only context for user-visible logging; not relied on as full conversation history.'
        },
        expectedOutput: {
          type: 'string',
          description: 'Optional expected output format, such as implementation plan, phased roadmap, migration plan, or review checklist.'
        }
      },
      required: ['question']
    }
  };
}
```

主请求中：

```ts
const expertModel = await this._getConfiguredExpertModel();
const solutionModel = await this._getConfiguredSolutionProviderModel();

const builtInTools = [
  ...(this._timelineService ? this._buildTimelineTools() : []),
  ...(expertModel ? [this._buildAskLlsoaiTool()] : []),
  ...(solutionModel ? [this._buildAskSolutionProviderTool()] : []),
];
```

### 3.4 主模型提示词

新增 `_withSolutionProviderPrompt(messages, enabled, reviewWithExpert)`，或将专家/方案提示统一合并为一个内置能力 prompt。

建议提示内容：

```text
Solution provider is enabled. If the user asks for a design plan, implementation roadmap, architecture proposal, phased migration plan, risk analysis, or you want another model to draft a structured solution, call ask_solution_provider.
The solution provider will not receive previous conversation history. The question must be self-contained.
After the solution provider returns, continue as the main model and produce the final user-facing answer.
If solution expert review is enabled and expert mode is available, the solution provider may call ask_llsoai internally before returning its final solution. The expert review result is consumed by the solution provider first, then the final revised solution is returned to you.
```

如果专家模式和方案提供商同时启用：

- 主模型可按需要调用 `ask_llsoai` 或 `ask_solution_provider`。
- 系统提示需要说明两者区别：
  - `ask_solution_provider` 用于“先出方案”。
  - `ask_llsoai` 用于“困难问题独立调查/复核”。

### 3.5 拦截方案工具调用

主模型 tool call 分发逻辑中新增：

```ts
if (toolCall.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
  if (solutionModel) {
    await this._startSolutionRun(toolCall, solutionModel, currentSessionId, requestBody.messages, mainContext, apiTools, progress, token);
  } else {
    await this._continueMainAfterUnavailableSolutionProvider(toolCall, requestBody.messages, mainContext, apiTools, progress, token);
  }
  continue;
}
```

注意：`apiTools` 传给方案提供商时要过滤内部工具，避免递归。

### 3.6 方案模型运行

新增方法参考专家模式：

```ts
private _buildSolutionInitialMessages(input: any, solutionModelId: string, state: SolutionRunState): any[]
private _filterSolutionTools(state: SolutionRunState, tools: readonly any[]): any[]
private async _startSolutionRun(...): Promise<void>
private async _runSolutionTurn(...): Promise<void>
private async _continueSolutionFromToolResult(...): Promise<void>
private async _continueSolutionFromUserMessage(...): Promise<void>
private async _continueSolutionFromExpertResult(...): Promise<void>
private async _finishSolutionAndContinueMain(...): Promise<void>
```

方案模型 system prompt 建议：

```text
You are LLSOAI solution provider. Your job is to draft a clear, actionable solution or implementation plan for the delegated task.
Focus on goals, constraints, phased steps, affected files/modules, risks, validation plan, rollback plan, and open questions.
Use tools when available to inspect the workspace and make the plan grounded in the actual project.
Do not call ask_solution_provider. Do not use TODO enforcement.
When finished, produce a final solution proposal for the main model.
```

如果 `state.requireInitialExpertReview === true`，在方案模型 system prompt 中追加：

```text
Solution expert review is enabled.

You have access to the ask_llsoai tool for expert review.
Before you produce your final solution provider result, you MUST call ask_llsoai at least once to review your proposed solution.

The ask_llsoai request must include:
1. the original delegated task,
2. your proposed solution,
3. relevant files, constraints, assumptions, and acceptance criteria,
4. the exact review criteria.

After ask_llsoai returns, revise or confirm your solution based on the expert review.
After the first expert review is completed, you may decide whether additional expert reviews are necessary, but avoid repeated reviews unless they materially improve the final solution.
Do not call ask_solution_provider.
```

工具过滤建议：

```ts
private _filterSolutionTools(state: SolutionRunState, tools: readonly any[]): any[] {
  return tools.filter((tool: any) => {
    if (tool?.name === TODO_TOOL_NAME) {
      return false;
    }
    if (tool?.name === ASK_SOLUTION_PROVIDER_TOOL_NAME) {
      return false;
    }
    if (tool?.name === ASK_LLSOAI_TOOL_NAME) {
      return state.reviewWithExpert && state.expertReviewAvailable;
    }
    return true;
  });
}
```

工具可见性规则：

- 主模型可见：`ask_llsoai`、`ask_solution_provider`，以及普通 VS Code 工具。
- 方案模型默认可见：普通 VS Code 工具。
- 方案模型在 `reviewWithExpert=true` 且专家可用时额外可见：`ask_llsoai`。
- 方案模型永远不可见：`ask_solution_provider`。
- 专家模型永远不可见：`ask_llsoai`、`ask_solution_provider`、TODO enforcement 工具。

专家工具过滤必须同步修正，不能沿用当前“只过滤 TODO”的实现：

```ts
private _filterExpertTools(tools: readonly any[]): any[] {
  return tools.filter((tool: any) =>
    tool?.name !== TODO_TOOL_NAME &&
    tool?.name !== ASK_LLSOAI_TOOL_NAME &&
    tool?.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME &&
    tool?.name !== TIMELINE_LIST_TOOL_NAME &&
    tool?.name !== TIMELINE_RESTORE_TOOL_NAME &&
    tool?.name !== TIMELINE_READ_LINES_TOOL_NAME
  );
}
```

#### 3.6.1 timeline 工具策略

当前主模型路径使用 `_requestModelWithTimelineTools()` 自动执行 timeline 内置工具，但专家/方案子模型路径默认使用 `_requestModel()`。因此第一版建议：

- 方案模型过滤 timeline 内置工具：
  - `timeline_list_by_file`
  - `timeline_restore_snapshot`
  - `timeline_read_snapshot_lines`
- 专家模型同样过滤 timeline 内置工具。
- 子模型只使用 VS Code 透传的原始工具，不使用 provider 内部 timeline 工具。

后续增强可以考虑让方案/专家子模型也走 `_requestModelWithTimelineTools()`，但这需要单独验证内部 timeline 工具在子模型状态机中的自动执行、回流和可见输出。

### 3.7 方案工具调用与结果回流

方案模型调用 VS Code 工具时：

```ts
progress.report(new vscode.LanguageModelToolCallPart(
  `${SOLUTION_TOOL_CALL_PREFIX}:${state.runId}:${toolCall.id}`,
  toolCall.name,
  toolCall.input
));
```

在 provider 请求开始处扫描 tool result 时增加识别：

```text
llsoai:<runId>:<originCallId>           => 专家工具结果
llsoai_solution:<runId>:<originCallId>  => 方案工具结果
```

识别到 `llsoai_solution:` 后：

1. 从 `_solutionRuns` 找到 state。
2. 把结果追加为 solution `tool` message。
3. 如果仍有 pending 工具结果，继续等待。
4. 工具结果收齐后继续 `_runSolutionTurn()`。
5. 不走主模型普通请求。

### 3.8 方案模型内部调用专家审查

这是新增复选框对应的核心逻辑。

第一版采用“方案模型内部调用 `ask_llsoai` 审查”的方案，而不是“方案完成后回主模型再由主模型调用专家”，也不是“Provider 在方案模型外部直接调用专家并合并结果”。

目标流程：

```text
主模型调用 ask_solution_provider
  ↓
Provider 启动方案模型
  ↓
如果 reviewWithExpert=true 且专家模式可用：
  方案模型 tools 中额外注入 ask_llsoai
  并要求最终输出前至少调用一次 ask_llsoai
  ↓
方案模型生成初版方案
  ↓
方案模型调用 ask_llsoai 请求专家审查
  ↓
Provider 拦截该 ask_llsoai，不交给 VS Code
  ↓
启动专家模型审查
  ↓
专家模型只使用普通 VS Code 工具，不可见 ask_llsoai / ask_solution_provider
  ↓
专家审查结果作为 ask_llsoai tool result 回填给方案模型
  ↓
方案模型根据专家结果修订或确认方案
  ↓
方案模型最终输出
  ↓
Provider 将最终方案作为 ask_solution_provider tool result 回填主模型
  ↓
主模型最终回答用户
```

#### 3.8.1 方案模型调用 `ask_llsoai` 的拦截

当 `_runSolutionTurn()` 收到方案模型 tool call 时：

- 如果工具名是普通 VS Code 工具，则使用 `llsoai_solution:<runId>:<originCallId>` report 给 VS Code，等待工具结果回流。
- 如果工具名是 `ask_llsoai`，则 Provider 内部拦截，不 report 给 VS Code。
- 如果工具名是 `ask_solution_provider`，理论上不应出现，因为不会传给方案模型；若出现，应返回错误 tool result 或忽略并记录日志，避免递归。

重要：方案模型调用 `ask_llsoai` 时，必须先把方案模型这一轮 assistant `tool_calls` 消息写入 `solutionMessages`，之后专家结果才能作为对应的 `tool` message 回填。否则 OpenAI/Anthropic 工具协议中的消息序列不合法。

示例：

```ts
solutionState.solutionMessages.push({
  role: 'assistant',
  content: result.text || undefined,
  tool_calls: result.toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments || JSON.stringify(toolCall.input ?? {}),
    },
  })),
});
```

如果本轮有多个 tool call，assistant message 应包含全部 tool_calls。后续每个工具结果都必须使用对应的原始 `tool_call_id`。

#### 3.8.1.1 同轮多工具调用策略

第一版要求 `ask_llsoai` 不与普通 VS Code 工具同轮调用。

原因：如果一轮同时出现普通工具和 `ask_llsoai`，Provider 需要同时等待普通工具结果和专家审查结果，状态机会明显复杂化。

策略：

1. 在方案模型 system prompt 中明确：

```text
Do not call ask_llsoai in the same assistant message as ordinary tools.
First gather evidence with ordinary tools, wait for their results, draft a complete proposal, then call ask_llsoai with the complete proposal.
```

2. 如果实际仍出现同轮混合调用：
   - 先记录 assistant tool_calls 消息。
   - 普通 VS Code 工具照常 report，等待 `llsoai_solution:` 结果回流。
   - 对本轮 `ask_llsoai` 追加一个错误 tool result，提示方案模型等普通工具结果回来后再重新发起专家审查。

错误 tool result 示例：

```text
Expert review was not started because ask_llsoai was called in the same assistant message as ordinary tools.
Please wait for ordinary tool results, update the proposal, then call ask_llsoai again with the complete proposal.
```

这样第一版不需要支持“普通工具 pending + 专家审查 pending”的并发嵌套。

方案模型调用 `ask_llsoai` 时建议逻辑：

```ts
if (toolCall.name === ASK_LLSOAI_TOOL_NAME) {
  if (!state.reviewWithExpert || !state.expertReviewAvailable) {
    // 理论上不会发生，因为此时不应给方案模型传 ask_llsoai。
    await this._appendSolutionToolError(state, toolCall.id, 'Expert review is not available for this solution run.');
    await this._runSolutionTurn(state, progress, token);
    return;
  }

  if (state.expertReviewCount >= MAX_SOLUTION_EXPERT_REVIEW_COUNT) {
    await this._appendSolutionToolError(state, toolCall.id, 'Maximum expert review count reached. Continue with the current review results.');
    await this._runSolutionTurn(state, progress, token);
    return;
  }

  state.pendingExpertReviewCallId = toolCall.id;
  state.expertReviewCount += 1;
  try {
    await this._startExpertReviewForSolutionRun(state, toolCall, progress, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.expertReviewCompleted = false;
    state.pendingExpertReviewCallId = undefined;
    state.reviewSkippedReason = `expert review failed: ${message}`;
    state.solutionMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: `Expert review failed: ${message}\n\nPlease continue by producing the best final solution based on available information, and mention that expert review failed.`,
    });
    await this._runSolutionTurn(state, progress, token);
  }
  return;
}
```

#### 3.8.2 专家结果回填给方案模型

现有专家模式默认专家结束后调用 `_finishExpertAndContinueMain()`，将专家结果回填给主模型。

方案专家审查需要不同的返回目标：专家结果必须回到方案模型，让方案模型吸收审查意见后再输出最终方案。

推荐改造 `ExpertRunState`，增加返回目标：

```ts
type ExpertSource =
  | {
      type: 'main';
      askLlsoaiCallId: string;
      askLlsoaiArguments: any;
    }
  | {
      type: 'solution';
      solutionRunId: string;
      solutionAskLlsoaiCallId: string;
      askLlsoaiArguments: any;
    };

type ExpertReturnTarget =
  | {
      type: 'main';
      originalMainMessages: any[];
      mainRequestContext: MainRequestContext;
      mainTools: readonly any[];
    }
  | {
      type: 'solution';
      solutionRunId: string;
      solutionToolCallId: string;
    };

interface ExpertRunState {
  // existing fields...
  source: ExpertSource;
  returnTarget: ExpertReturnTarget;
}
```

这样可以把“专家由谁发起”和“专家结果回到哪里”分开：

- 主模型直接调用 `ask_llsoai`：`source.type='main'`，`returnTarget.type='main'`。
- 方案模型调用 `ask_llsoai`：`source.type='solution'`，`returnTarget.type='solution'`。

如果第一版不想大幅重构 `ExpertRunState`，可以采用最小兼容策略：

- 保留现有字段 `askLlsoaiCallId` / `askLlsoaiArguments` / `originalMainMessages` / `mainRequestContext` / `mainTools`。
- 方案审查 expert run 中：
  - `askLlsoaiCallId` 填方案模型的 `ask_llsoai` callId。
  - `askLlsoaiArguments` 填方案模型传入的参数。
  - `originalMainMessages` 可填 `[]` 或方案启动时的主消息副本。
  - `mainRequestContext` / `mainTools` 填原主模型上下文和工具，供专家请求构造使用。
- 但当 `returnTarget.type === 'solution'` 时，结束流程必须走 `_finishExpertAndContinueSolution()`，不得读取 main 专用字段并调用 `_finishExpertAndContinueMain()`。

专家结束时：

```ts
if (state.returnTarget.type === 'main') {
  await this._finishExpertAndContinueMain(state, expertAnswer, progress, token);
} else {
  await this._finishExpertAndContinueSolution(state, expertAnswer, progress, token);
}
```

`_finishExpertAndContinueSolution()` 逻辑：

```ts
private async _finishExpertAndContinueSolution(
  expertState: ExpertRunState,
  expertAnswer: string,
  progress: Progress<...>,
  token: CancellationToken
): Promise<void> {
  const target = expertState.returnTarget;
  if (target.type !== 'solution') {
    return;
  }

  const solutionState = this._solutionRuns.get(target.solutionRunId);
  if (!solutionState) {
    progress.report(new vscode.LanguageModelTextPart('Solution run no longer exists. Expert review result cannot be applied.'));
    return;
  }

  solutionState.expertReviewCompleted = true;
  solutionState.pendingExpertReviewCallId = undefined;

  solutionState.solutionMessages.push({
    role: 'tool',
    tool_call_id: target.solutionToolCallId,
    content: expertAnswer,
  });

  await this._runSolutionTurn(solutionState, progress, token);
}
```

注意：

- `solutionToolCallId` 是方案模型原始的 `ask_llsoai` callId。
- 专家模型内部调用 VS Code 工具时仍使用 `llsoai:<expertRunId>:<originCallId>` 前缀。
- `llsoai:` 前缀只用于专家模型内部工具结果回流，不用于方案模型的 `ask_llsoai` tool result。

#### 3.8.3 首次专家审查强制规则

如果 `state.requireInitialExpertReview === true`，方案模型第一次最终输出前必须完成至少一次专家审查。

当 `_runSolutionTurn()` 得到普通文本且无工具调用时：

```ts
if (state.requireInitialExpertReview && !state.expertReviewCompleted) {
  if (state.forceExpertReviewReminderCount >= MAX_FORCE_EXPERT_REVIEW_REMINDERS) {
    state.reviewSkippedReason = 'solution model did not call ask_llsoai after required reminders';
    state.requireInitialExpertReview = false;
    await this._finishSolutionAndContinueMain(state, result.text || '', progress, token);
    return;
  }

  state.forceExpertReviewReminderCount += 1;
  state.solutionMessages.push({
    role: 'assistant',
    content: result.text || '',
  });

  state.solutionMessages.push({
    role: 'user',
    content: [
      'Expert review is required before finalizing the solution.',
      'You have not called ask_llsoai yet, or the expert review has not completed.',
      'Please call ask_llsoai now to review your proposed solution.',
      'Do not produce the final solution provider result until the expert review result is returned.',
    ].join('\n'),
  });

  await this._runSolutionTurn(state, progress, token);
  return;
}
```

这样第一次审查由 Provider 状态字段强制，不完全依赖 prompt。

如果达到 `MAX_FORCE_EXPERT_REVIEW_REMINDERS` 后方案模型仍未调用 `ask_llsoai`，则降级回填当前方案，并在 `reviewSkippedReason` 中记录原因，避免无限循环。

#### 3.8.4 专家审查 prompt

方案模型传给 `ask_llsoai` 的 `question` 应包含完整上下文。建议在方案模型 system prompt 中要求调用参数包含：

```text
Please review the following solution proposal generated by the solution provider.

Review criteria:
1. Correctness
2. Completeness
3. Feasibility
4. Risks and edge cases
5. Missing constraints or assumptions
6. Validation plan
7. Required changes
8. Optional improvements
9. Final recommendation

Original delegated task:
{question}

Solution proposal:
{solution draft}
```

#### 3.8.5 审查可见性

与专家模式原则一致，方案提供商、方案模型调用 `ask_llsoai`、专家审查过程都应通过 `progress.report(LanguageModelTextPart)` 对用户可见，但不暴露原始 chain-of-thought，只展示可审计过程、工具调用和结论。

建议用户可见输出结构：

```md
### 🧭 Solution Provider Started

...方案模型分析和工具调用...

### 🧠 Solution Provider Requested Expert Review

方案模型调用 ask_llsoai 审查初版方案。

### ✅ Expert Review Returned to Solution Provider

...专家审查结论摘要...

### 🧭 Final Solution Provider Result

...方案模型吸收专家意见后的最终方案...
```

### 3.9 用户追加消息处理

与专家模式一致：

- 如果存在 active solution run，且新请求不是 `llsoai_solution:` 工具结果，而是用户追加文本，则转发给方案模型。
- 如果方案模型仍在等待工具结果，用户追加文本先缓存到 `pendingSolutionUserFollowUps`。
- 不在 provider 中硬编码“取消/停止/回主模型”等关键词。

需要注意优先级：

1. 先处理带前缀的工具结果：
  - `llsoai_solution:` 回到 solution run。
  - `llsoai:` 回到 expert run。
2. 再处理 active expert run：
  - 如果 `activeExpertRun.returnTarget.type === 'main'`，用户追加消息转给 expert run，沿用现有专家模式行为。
  - 如果 `activeExpertRun.returnTarget.type === 'solution'`，说明专家是 solution run 的子流程，用户追加消息应缓存到对应 `SolutionRunState.pendingSolutionUserFollowUps`，不要直接发给 expert run。
3. 再处理 active solution run：用户追加消息转给或缓存到 solution run。
4. 最后走普通主模型请求。

如果方案专家审查期间用户追加消息，需要决定发给谁：

- 第一版建议：专家审查期间仍视为 solution run 的一部分。
- 如果 `pendingExpertReviewCallId` 存在，说明方案模型正在等待专家审查结果，此时用户追加消息应先缓存到 `pendingSolutionUserFollowUps`，待专家结果回到方案模型并完成当前 `_runSolutionTurn()` 后再追加给方案模型。
- 不建议把用户追加消息直接插入专家审查上下文，避免专家审查目标漂移；专家只审查方案模型提交的审查请求。

### 3.10 回填主模型

方案模型最终输出后构造主模型续写消息：

```ts
const mainMessages = [
  ...state.originalMainMessages,
  {
    role: 'assistant',
    tool_calls: [{
      id: state.askSolutionCallId,
      type: 'function',
      function: {
        name: ASK_SOLUTION_PROVIDER_TOOL_NAME,
        arguments: JSON.stringify(state.askSolutionArguments ?? {}),
      },
    }],
  },
  {
    role: 'tool',
    tool_call_id: state.askSolutionCallId,
    content: finalSolutionToolResult,
  },
];
```

主模型继续请求时，建议过滤内部工具：

```ts
.filter(tool =>
  tool?.name !== ASK_LLSOAI_TOOL_NAME &&
  tool?.name !== ASK_SOLUTION_PROVIDER_TOOL_NAME
)
```

避免主模型在同一轮回填后继续递归调用内置委托工具。

回填内容建议包含专家审查状态，方便主模型理解最终方案是否已经经过审查：

```text
Solution provider result:

{finalSolutionAnswer}

Expert review status:
- enabled: {state.reviewWithExpert}
- available: {state.expertReviewAvailable}
- completed: {state.expertReviewCompleted}
- reviewCount: {state.expertReviewCount}

Please synthesize the final user-facing answer based on the final solution provider result.
```

### 3.11 第二阶段验收标准

1. `npm run compile` 通过。
2. 方案提供商关闭时行为不变。
3. 方案提供商开启但 provider/model 不完整时，不注入 `ask_solution_provider`。
4. 方案提供商开启且配置完整时，主模型 tools 中出现 `ask_solution_provider`。
5. 主模型调用 `ask_solution_provider` 后，provider 内部拦截，不交给 VS Code 工具系统。
6. 方案模型可调用 VS Code 工具，callId 格式为：

```text
llsoai_solution:<runId>:<originCallId>
```

7. `llsoai_solution:` 工具结果能回流给方案模型继续运行。
8. 方案模型最终结果能作为 tool result 回填给主模型。
9. `reviewWithExpert=false` 时，方案模型 tools 不包含 `ask_llsoai`。
10. `reviewWithExpert=true` 但专家模式不可用时，方案模型 tools 不包含 `ask_llsoai`，方案流程安全降级，不报错阻断。
11. `reviewWithExpert=true` 且专家模式可用时，方案模型 tools 包含 `ask_llsoai`。
12. 方案模型永远看不到 `ask_solution_provider`，避免递归方案委托。
13. 专家模型永远看不到 `ask_llsoai` 和 `ask_solution_provider`，避免专家递归或专家调用方案。
14. 方案模型第一次最终输出前，如果尚未完成专家审查，Provider 会追加提醒并继续方案模型，强制其调用 `ask_llsoai`。
15. 方案模型调用 `ask_llsoai` 后，Provider 内部拦截，不 report 给 VS Code 工具系统。
16. 专家审查结果能作为 `ask_llsoai` tool result 回填给方案模型，而不是直接回主模型。
17. 方案模型收到专家结果后能修订/确认方案并最终输出。
18. 最终回主模型的是经过方案模型吸收专家审查后的最终方案。
19. 专家审查次数有限制，避免循环调用。
20. 专家审查中专家调用 VS Code 工具时仍使用 `llsoai:<runId>:<originCallId>` 前缀。
21. 方案模型调用 VS Code 工具时仍使用 `llsoai_solution:<runId>:<originCallId>` 前缀。
22. 专家模式和方案提供商同时启用时，两个前缀互不干扰。
23. 用户追加消息能正确转发给 active solution run；如果专家审查正在进行，则先缓存，待审查结果回到方案模型后再处理。
24. 方案模型调用 `ask_llsoai` 时，`solutionMessages` 中先保存 assistant `tool_calls` 消息，再保存专家结果 tool message。
25. 如果方案模型同轮同时调用普通工具和 `ask_llsoai`，第一版不启动专家审查，而是提示其等待普通工具结果后重新请求审查。
26. `toolCalling=false` 的方案模型不会收到 tools，也不会被强制专家审查。
27. `toolCalling=false` 的专家模型可做纯文本审查，但不会收到 VS Code tools。
28. timeline 内置工具不会暴露给方案模型和专家模型，除非后续专门改造子模型 timeline 支持。
29. 专家审查失败时，错误会作为 `ask_llsoai` tool result 回填给方案模型，方案 run 不应直接崩溃。
30. 达到最大强制提醒次数后，方案 run 安全降级并记录 `reviewSkippedReason`。

### 3.12 Chat History 保存策略

方案提供商接入后，建议明确保存策略：

1. 主模型最终回答仍按现有逻辑保存，`modelId` 使用主模型。
2. 方案模型会话单独保存，`modelId` 使用 `solutionModelId`。
3. 方案内部触发的专家审查仍保存为专家模式历史，`modelId` 使用 `expertModelId`。
4. 专家审查返回 solution 时仍可复用 `_saveExpertChatHistory()`，但记录中应包含 `returnTarget: solution` 或等价摘要，方便区分普通专家委托和方案内专家审查。
5. 若专家审查失败或被跳过，方案模型历史中应记录 `reviewSkippedReason` 或错误摘要。

### 3.13 第二阶段实现后的专家审查待修复项

当前第二阶段已完成 `src/provider.ts` 的基础接入，并已通过 `npm run compile`。专家审查认为整体架构方向正确，核心闭环已经具备，但进入稳定可用前需要继续修复以下问题。

#### 3.13.1 必须修复项

1. **主模型同轮混合内部委托工具和普通工具时协议可能错乱**
  - 现状：主模型同一轮如果同时返回 `ask_solution_provider` / `ask_llsoai` 和普通 VS Code 工具，当前循环会先启动内部委托，再继续 report 普通工具。
  - 风险：同一个 assistant `tool_calls` 消息被拆成内部闭环和外部工具调用混合处理，容易造成协议顺序和用户体验问题。
  - 建议：主模型 tool calls 先分类；第一版不支持同轮混合内部委托工具和普通工具。如果出现混合调用，应优先处理内部委托，并要求模型下一轮再调用普通工具，或回填错误 tool result 提示重新发起。

2. **方案模型历史和最终主模型续写结果未保存**
  - 现状：普通主模型初始回答和专家历史已有保存逻辑，但方案模型会话、`main_after_solution` 最终回答、方案专家审查失败/跳过原因尚未完整保存。
  - 风险：聊天历史缺失关键方案链路，后续审计、回溯和调试困难。
  - 建议：新增 `_buildSolutionChatMessages()` / `_saveSolutionChatHistory()`；在 `_runSolutionTurn()` 每次方案模型返回后保存方案历史；在 `_finishSolutionAndContinueMain()` 和 `_continueMainAfterUnavailableSolutionProvider()` 中保存最终主模型续写结果；专家历史中记录 `returnTarget: solution`。

3. **方案内专家审查后续工具回流失败时缺少安全回填**
  - 现状：`_startExpertReviewForSolutionRun()` 只捕获首次 `_runExpertTurn()` 错误。如果专家模型先调用 VS Code 工具，后续工具结果回流后再次 `_runExpertTurn()` 失败，错误不会自动作为 `ask_llsoai` tool result 回填给方案模型。
  - 风险：方案模型可能一直等待专家审查结果，`pendingExpertReviewCallId` 无法清理，solution run 卡住。
  - 建议：新增 `_failExpertReviewBackToSolution()`；在 `_continueExpertFromToolResult()` 等专家后续路径中，如果 `returnTarget.type === 'solution'`，捕获异常并将错误作为方案模型 `ask_llsoai` 的 tool result 回填，然后继续方案 run 安全降级。

4. **`_activeSolutionRunId` / `_activeExpertRunId` 全局单例不适合多 session 并发**
  - 现状：active run 只用单个字段保存，多个 chat session 并发时后一个 run 会覆盖前一个 run。
  - 风险：不同 session 交错时，旧 session 的用户追加消息可能无法正确转发到对应 active run。
  - 建议：改成按 session 维护，例如 `_activeExpertRunBySession = new Map<string, string>()` 和 `_activeSolutionRunBySession = new Map<string, string>()`；若暂不重构，至少在 active id 不匹配当前 session 时 fallback 查找当前 session 对应 run。

5. **solution run 完成时未清理指向它的悬挂 expert run**
  - 现状：`_finishSolutionAndContinueMain()` 删除 solution run 后，没有扫描并清理 `returnTarget.type === 'solution'` 且指向该 solution run 的 expert run。
  - 风险：后续专家工具结果回流时找不到 solution run，可能留下悬挂 expert run 或 active 状态。
  - 建议：solution run 完成时扫描 `_expertRuns`，删除所有指向当前 solution run 的子 expert run，并同步清理 active expert id。

#### 3.13.2 建议修复项

1. **工具结果前缀处理顺序建议更防御**
  - 建议先处理更具体的 `llsoai_solution:`，再处理 `llsoai:`。当前两者不会误匹配，但这样更利于未来扩展。

2. **主模型 prompt 需要更明确地区分两个内置工具**
  - 建议补充：`ask_solution_provider` 用于规划、设计、方案草拟；`ask_llsoai` 用于独立调查、验证、专家复核。

3. **方案专家审查 prompt 应补充明确审查标准**
  - 建议要求方案模型提交给 `ask_llsoai` 的审查请求包含：Correctness、Completeness、Feasibility、Risks and edge cases、Missing constraints or assumptions、Validation plan、Required changes、Optional improvements、Final recommendation。

4. **内部工具过滤建议抽象统一方法**
  - 建议新增 `_isInternalToolName()` / `_isTimelineTool()` 或类似 helper，专家模型和方案模型复用，避免未来新增内部工具时漏传给子模型。

5. **`solutionContextRecords` 每轮重复注入可能导致上下文膨胀**
  - 现状：`solutionMessages` 已经包含完整协议历史，`solutionContextRecords` 又作为额外 user message 每轮注入。
  - 建议：`solutionContextRecords` 主要用于压缩和调试输出，不必每轮完整注入；必要时只追加摘要。

#### 3.13.3 后续优化项

1. 子模型 timeline 工具支持可单独设计；当前第一版过滤 timeline 工具是可接受策略。
2. 专家审查次数和强制提醒次数后续可配置化。
3. 用户可见输出可进一步结构化，例如显示专家审查状态、降级原因和工具等待状态。

### 3.14 方案草案 Markdown 落地策略

当前阶段暂不新增用户可见的 `solutionProvider.persistenceMode` 配置项。方案提供商采用 **auto prompt-driven persistence** 策略：由 Provider 提供安全边界和建议路径，由方案模型根据任务复杂度、专家审查需求和工作区能力自行决定是否落地 Markdown。

核心原则：

```text
Provider 生成唯一、安全、workspace 相对的建议路径
  ↓
方案模型根据 prompt 自主判断是否需要保存 Markdown
  ↓
如果保存，只能写入 Provider 提供的路径
  ↓
如果跳过或失败，必须返回完整 inline 方案
  ↓
专家审查同时支持 solutionFile 和 fallbackInlineSolution
```

#### 3.14.1 Provider 安全边界

Provider 在启动 solution run 前生成唯一的草案路径：

```text
.LLSOAI/Solution/drafts/{timestamp}-{runId}-draft.md
```

约束：

1. 路径必须是 workspace 相对路径，不向模型暴露用户本机绝对路径。
2. 文件名必须包含 `runId`，避免并发方案相互覆盖。
3. 模型只能写入 Provider 提供的这个路径。
4. 模型不得创建或修改 `.LLSOAI/Solution/` 之外的任何文件。
5. Provider 后续实现时必须校验返回的 `solutionFile` 是否等于预生成路径，不能接受模型自造路径。
6. 如果没有 workspace、workspace 不可写或没有文件写入工具，则跳过落地并使用 inline 方案。

#### 3.14.2 方案模型提示词建议

方案模型 system prompt 中建议加入：

```text
Solution draft persistence guidance:

You may persist the full solution as a Markdown file when doing so improves traceability, expert review quality, or avoids very long inline responses.

If you decide to persist the solution, use only the following workspace-relative path:

{solutionDraftFile}

Do not create or modify files outside .LLSOAI/Solution/.

Saving the solution is recommended when:
1. the solution is long or multi-phase;
2. expert review is enabled;
3. the solution contains architecture, migration, or implementation plan details;
4. the user may need to review, reuse, or audit the plan later.

Saving the solution is optional or can be skipped when:
1. the solution is short;
2. no file writing tool is available;
3. workspace persistence appears unavailable;
4. the task is exploratory;
5. the user explicitly asked not to write files.

If saving succeeds, return solutionFile, solutionSummary, and writeStatus="succeeded".
If saving is skipped or fails, return fullSolutionInline, solutionSummary, writeStatus="skipped" or "failed", and writeReason/writeError when available.
```

#### 3.14.3 结构化返回协议

即使不增加配置项，方案模型也必须按结构化协议返回写入状态，便于 Provider 判断专家审查输入和降级路径。

建议最小结构：

```ts
type SolutionProviderResult = {
  writeStatus: 'succeeded' | 'skipped' | 'failed';
  solutionFile?: string;
  solutionSummary: string;
  fullSolutionInline?: string;
  writeReason?: string;
  writeError?: string;
};
```

字段规则：

1. `writeStatus` 必填。
2. `solutionSummary` 必填，用于主模型理解方案，也用于专家审查上下文。
3. `solutionFile` 仅在写入成功或尝试写入预批准路径时返回，且必须等于 Provider 提供的路径。
4. `writeStatus !== 'succeeded'` 时必须返回 `fullSolutionInline`。
5. `writeStatus === 'failed'` 时应返回 `writeError`。
6. `writeStatus === 'skipped'` 时应返回 `writeReason`，例如 `solution_short`、`file_write_tool_unavailable`、`workspace_not_available`、`user_preferred_no_file_write`。

#### 3.14.4 专家审查输入

专家审查不能只传 `solutionFile`。即使文件写入成功，也必须附带任务摘要、方案摘要和审查重点。

推荐结构：

```ts
type SolutionExpertReviewInput = {
  userRequestSummary: string;
  solutionSummary: string;
  reviewFocus: string[];
  solutionFile?: string;
  fallbackInlineSolution?: string;
};
```

专家审查规则：

1. 如果 `solutionFile` 存在且专家可读取，优先读取文件。
2. 如果文件不可读、未写入、路径不存在或 workspace 不可用，使用 `fallbackInlineSolution`。
3. 如果二者都不可用，专家应明确返回“缺少方案内容”，Provider 将专家审查标记为 failed/partial 并安全降级。

专家 prompt 建议：

```text
Please review the solution produced by the solution provider.

User request summary:
{userRequestSummary}

Solution summary:
{solutionSummary}

Solution file, if available:
{solutionFile}

Review focus:
{reviewFocus}

Read the solution file if tools are available. If the file cannot be read, explicitly state that limitation and review based on the provided inline fallback or summary.
```

#### 3.14.5 降级策略

Markdown 落地是增强能力，不是方案生成链路的单点故障。

降级规则：

| 场景 | 行为 |
|---|---|
| 无 workspace | 跳过落地，返回 inline 方案 |
| workspace 不可写 | 返回 `writeStatus='failed'` 和 inline 方案 |
| 无文件写入工具 | 返回 `writeStatus='skipped'` 和 inline 方案 |
| 模型判断方案较短无需保存 | 返回 `writeStatus='skipped'` 和 inline 方案 |
| 写入成功但专家无法读取 | 专家使用 `fallbackInlineSolution` |
| 专家审查失败 | 保留方案结果，记录失败原因并安全降级 |

#### 3.14.6 后续可选配置

如果后续用户需要更确定的行为，可再增加：

```ts
type SolutionPersistenceMode = 'auto' | 'always' | 'never';
```

语义：

| 模式 | 行为 |
|---|---|
| `auto` | 默认，模型根据 prompt 和上下文自行判断。 |
| `always` | Provider 要求模型尽量写入，失败仍降级 inline。 |
| `never` | 禁止写入，只允许 inline 方案。 |

当前阶段先不暴露该配置，避免过早增加配置复杂度。

---

## 4. 推荐实施顺序

### 第一阶段 PR/提交范围

1. `package.json` 增加配置项。
2. `src/types.ts` 增加类型。
3. `src/configManager.ts` 增加读取、合并、更新方法。
4. `src/views/configView.ts` 增加后端消息处理和面板 HTML。
5. `assets/configView/configView.js` 增加状态、i18n、下拉联动、保存逻辑。
6. `assets/configView/configView.css` 复用专家模式样式或抽象成通用 provider setting card。
7. 编译验证。

### 第二阶段 PR/提交范围

1. `src/provider.ts` 增加 solution run 类型、状态和配置读取。
2. 注入 `ask_solution_provider` 工具和主模型 prompt。
3. 拦截主模型方案工具调用。
4. 实现方案模型运行、工具调用、工具结果回流。
5. 实现方案模型内部调用 `ask_llsoai` 的拦截和专家结果回流。
6. 实现首次专家审查强制规则和审查次数限制。
7. 实现方案模型最终输出后回填主模型。
8. 增加日志/用户可见输出。
9. 编译和手动验证完整链路。

---

## 5. 风险与约束

1. **循环调用风险**：方案模型永远不能看到 `ask_solution_provider`；专家模型永远不能看到 `ask_llsoai` 和 `ask_solution_provider`。只有在 `reviewWithExpert=true` 且专家可用时，方案模型才允许看到 `ask_llsoai`。
2. **callId 解析风险**：专家前缀和方案前缀必须严格区分。
3. **配置覆盖理解成本**：必须和专家模式保持一致，否则用户难以理解。
4. **审查成本增加**：`reviewWithExpert` 会多一次专家模型请求，应默认关闭。
5. **模型能力差异**：方案模型可能不支持工具调用，仍应允许其直接输出方案。
6. **审查不可用降级**：专家模式关闭、专家 provider/model 缺失、API key 缺失时，不能阻断方案回填主模型；此时不要向方案模型注入 `ask_llsoai`，并在最终回填中标明专家审查未执行。
7. **首次强制审查循环风险**：如果方案模型一直不调用 `ask_llsoai` 而反复输出最终文本，Provider 追加提醒可能形成循环。需要设置最大强制提醒次数或总轮数，超过后降级回填并标记审查未完成。
8. **专家结果返回目标风险**：现有专家模式默认回主模型，方案审查要求专家结果回方案模型，因此必须为 `ExpertRunState` 增加 `returnTarget` 或等价机制，避免把方案审查结果错误回填给主模型。
9. **用户追加消息时序风险**：专家审查进行中用户追加消息应缓存到 solution run，不应直接改写专家审查请求。

---

## 6. 最终建议

建议严格分两阶段实现：

1. **第一阶段只做配置相关**，完全不影响现有聊天转发，降低回归风险。
2. **第二阶段再做转发接入**，按专家模式复制一条独立的 solution run 状态机，并实现“方案模型内部调用 `ask_llsoai` 审查”的分支。

这样实现后，用户可以获得三层协作能力：

```text
主模型
  ├─ 需要独立调查/复核 => ask_llsoai => 专家模式
  └─ 需要设计方案/实施计划 => ask_solution_provider => 方案提供商
                                      └─ 可选：方案模型最终输出前调用 ask_llsoai 审查
```

最终推荐架构：

```text
主模型调用 ask_solution_provider
  ↓
Provider 启动方案模型
  ↓
Provider 构造方案模型 tools：
  - 普通 VS Code tools
  - 如果 reviewWithExpert=true 且专家可用，则额外加入 ask_llsoai
  - 永远不加入 ask_solution_provider
  ↓
方案模型生成初版方案
  ↓
如果 requireInitialExpertReview=true 且尚未 expertReviewCompleted：
  - 方案模型必须调用 ask_llsoai
  - 如果没调用就直接最终输出，Provider 追加提醒并继续方案模型
  ↓
Provider 拦截方案模型的 ask_llsoai
  ↓
启动专家模型
  ↓
专家模型只拿普通 VS Code tools，不拿 ask_llsoai/ask_solution_provider
  ↓
专家审查完成
  ↓
Provider 将专家结果作为 ask_llsoai tool result 回填给方案模型
  ↓
方案模型根据专家结果修订/确认方案
  ↓
方案模型最终输出
  ↓
Provider 将最终方案结果作为 ask_solution_provider tool result 回填主模型
  ↓
主模型最终回答用户
```
