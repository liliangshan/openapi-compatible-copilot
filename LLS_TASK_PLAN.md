# @lls-task 任务流自动续跑方案

## 1. 背景与目标

本方案用于在当前 VS Code 中转项目中新增一套 `@lls-task` 能力：用户在 Copilot Chat 中提交带有 `@lls-task` 的请求后，扩展能够获取用户提交内容，调用模型把内容分析并规划成任务流，持续展示到状态栏/资源管理器视图中，并在主模型每轮执行完成后自动检测任务是否完成；如果任务流未完成且模型已经停止执行，则自动继续提交给主模型，直到任务流完成或达到安全停止条件。

核心目标：

1. 支持用户通过 `@lls-task` 显式启动任务流管理。
2. 捕获用户提交的原始需求内容。
3. 由模型分析需求并生成结构化任务流。
4. 将任务流进度写入状态栏，并同步到资源管理器视图。
5. 要求主模型在执行完每个阶段后调用内置工具更新资源管理器进度。
6. 主模型本轮完成后延迟 1 分钟检测是否仍在执行。
7. 如果模型不再执行且任务流未完成，则自动继续提交给主模型。
8. 全流程必须可控、可暂停、可恢复，并避免无限循环。

## 2. 用户体验设计

### 2.1 触发方式

用户在 Chat 中提交：

```text
@lls-task 帮我实现 xxx 功能
```

或：

```text
@lls-task
目标：xxx
要求：xxx
验收：xxx
```

扩展识别到 `@lls-task` 后进入任务流模式。

### 2.2 状态栏展示

状态栏显示当前任务流摘要，例如：

```text
$(checklist) LLS Task 2/7 执行中
```

点击状态栏打开任务详情，展示：

- 当前任务流名称。
- 总任务数。
- 已完成任务数。
- 当前执行任务。
- 最近一次模型活动时间。
- 自动续跑状态。
- 最近错误。
- 暂停/继续/停止按钮。

### 2.3 资源管理器展示

在 Activity Bar 或 Explorer 中新增 `LLS Task` 视图，显示任务树：

```text
LLS Task
├─ ✅ 1. 分析现有代码结构
├─ 🔄 2. 设计任务流状态模型
├─ ⏳ 3. 实现状态栏展示
├─ ⏳ 4. 实现进度更新工具
└─ ⏳ 5. 验证自动续跑
```

每个任务支持状态：

- `pending`：未开始。
- `running`：执行中。
- `completed`：已完成。
- `failed`：失败。
- `skipped`：跳过。
- `blocked`：阻塞。

### 2.4 自动续跑行为

主模型完成一轮响应后：

1. 扩展记录当前 request 已完成。
2. 启动 1 分钟延迟检测。
3. 延迟到期后检查当前是否还有模型请求在执行。
4. 如果仍有模型执行，则不续跑，等待下一次完成事件。
5. 如果没有模型执行，则检查任务流是否全部完成。
6. 如果未完成，则自动构造续跑提示并提交给主模型。
7. 如果已完成，则标记任务流结束。

## 3. 总体架构

建议新增模块：

```text
src/llsTask/
├─ types.ts              # 任务流类型定义
├─ config.ts             # 配置读取与默认值
├─ service.ts            # 任务流核心服务
├─ planner.ts            # 任务规划模型调用与结果解析
├─ statusBar.ts          # 状态栏展示
├─ treeView.ts           # 资源管理器任务树
├─ tool.ts               # 内置进度更新工具定义与处理
├─ autoContinue.ts       # 延迟检测与自动续跑调度
├─ persistence.ts        # 工作区任务状态持久化
└─ messages.ts           # 多语言文案
```

与现有模块关系：

```text
用户 Chat 输入
   ↓
vscode.chat.createChatParticipant 创建的 @lls-task 智能体捕获用户提交内容
   ↓
llsTask.service 创建会话
   ↓
llsTask.planner 规划任务流
   ↓
statusBar/treeView 展示任务
   ↓
主模型执行任务
   ↓
主模型调用内置工具 update_lls_task_progress
   ↓
tool.ts 更新任务状态与资源管理器
   ↓
主模型完成
   ↓
autoContinue.ts 延迟 1 分钟检测
   ↓
未完成则自动继续提交
```

## 4. 关键数据结构

### 4.1 任务流会话

```ts
export interface LlsTaskSession {
  id: string;
  title: string;
  originalPrompt: string;
  normalizedPrompt: string;
  status: LlsTaskSessionStatus;
  tasks: LlsTaskItem[];
  activeTaskId?: string;
  createdAt: number;
  updatedAt: number;
  lastModelActivityAt?: number;
  autoContinueEnabled: boolean;
  continueCount: number;
  maxContinueCount: number;
  lastError?: string;
}

export type LlsTaskSessionStatus =
  | 'planning'
  | 'running'
  | 'waiting-model'
  | 'waiting-continue-check'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';
```

### 4.2 单个任务

```ts
export interface LlsTaskItem {
  id: string;
  title: string;
  description?: string;
  status: LlsTaskItemStatus;
  order: number;
  dependsOn?: string[];
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  lastUpdateAt?: number;
  notes?: string;
  evidence?: string[];
}

export type LlsTaskItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'blocked';
```

### 4.3 内置工具参数

```ts
export interface UpdateLlsTaskProgressInput {
  sessionId?: string;
  taskId: string;
  status: LlsTaskItemStatus;
  progress?: number;
  notes?: string;
  evidence?: string[];
  nextTaskId?: string;
}
```

## 5. `@lls-task` 捕获方案

### 5.1 捕获位置

优先通过 VS Code Chat Participant API 创建一个独立的 `@lls-task` 智能体来捕获用户提交内容，而不是只在 `src/provider.ts` 的普通模型转发入口里被动识别文本。

也就是说，用户在 Chat 中选择或输入 `@lls-task` 后，VS Code 会把该轮请求分发到我们注册的 participant handler，扩展可以直接从 `request.prompt` 拿到用户提交内容。

基础示例：

```ts
export function activate(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant(
    'lls.task',
    async (request, stream, token) => {
      // 用户点击发送后会进入这里
      const userPrompt = request.prompt;

      stream.progress('正在分析任务并规划任务流...');

      await llsTaskService.startFromPrompt({
        originalPrompt: userPrompt,
        source: 'chatParticipant',
        token,
      });

      stream.markdown('已创建 LLS Task 任务流，后续将按任务流推进。');
    }
  );

  participant.description = 'LLS Task 任务流智能体';
  context.subscriptions.push(participant);
}
```

推荐注册信息：

```text
participant id: lls.task
用户入口: @lls-task 或 @lls task
显示名称: LLS Task
说明: 捕获用户需求，规划任务流，跟踪执行进度，并在未完成时自动续跑。
```

需要在 `package.json` 中按 VS Code Chat Participant 规范补充对应 contribution，使 Chat 输入框中能够出现该智能体入口。具体字段以当前 VS Code 版本 API 为准。

`provider.ts` 仍然需要参与后续执行链路，但它的职责调整为：

1. 为主模型请求注入当前任务流系统提示。
2. 为主模型注入 `update_lls_task_progress` 内置工具。
3. 拦截主模型对进度工具的调用。
4. 追踪主模型请求开始、完成、取消和错误。
5. 在主模型完成后通知 `autoContinue.ts` 做 1 分钟延迟检测。

因此首版架构应区分两个入口：

| 入口 | 职责 |
|---|---|
| `vscode.chat.createChatParticipant('lls.task', handler)` | 捕获用户通过 `@lls-task` 提交的原始需求，并创建/规划任务流 |
| `LanguageModelChatProvider` / `provider.ts` | 承接后续主模型执行、工具注入、工具拦截、模型活动追踪和自动续跑 |

处理逻辑：

1. 注册 `lls.task` Chat Participant。
2. 用户通过 `@lls-task` 发送消息后进入 participant handler。
3. 从 `request.prompt` 读取用户真实需求。
4. 若存在任务会话，则判断是新建任务还是继续现有任务。
5. 创建或恢复任务会话。
6. 调用任务规划器生成任务流。
7. 将任务流写入状态栏和资源管理器。
8. 将后续执行请求交给主模型，并由 provider 注入任务流系统提示和进度工具。

### 5.2 输入清洗

需要保留用户原始输入，同时生成规范化输入：

```text
原始输入：@lls-task 帮我把远程通知功能补完
规范化输入：帮我把远程通知功能补完
```

`originalPrompt` 用于追溯，`normalizedPrompt` 用于任务规划。

如果使用 Chat Participant API，`request.prompt` 通常已经是去掉 participant mention 后的用户正文，但仍建议做一次兼容清洗，避免用户手动输入 `@lls-task` 文本导致重复前缀残留。

## 6. 任务规划方案

### 6.1 规划时机

当首次识别 `@lls-task` 且当前没有可复用任务流时，进入 `planning` 状态。

规划可以采用两种方式：

#### 方案 A：使用当前主模型规划

优点：实现简单，无需新增配置。
缺点：规划会占用主模型一次输出，并且与执行模型耦合。

#### 方案 B：复用方案提供商规划

优点：与项目已有 `solutionProvider` 设计一致，适合复杂任务规划。
缺点：依赖方案提供商配置。

建议首版采用混合策略：

1. 如果 `solutionProvider` 已启用且可用，则优先调用方案提供商规划任务流。
2. 否则使用当前主模型规划。
3. 如果规划失败，则降级为简单任务流：分析 → 实施 → 验证 → 总结。

### 6.2 规划输出格式

要求模型输出严格 JSON：

```json
{
  "title": "实现 @lls-task 任务流能力",
  "tasks": [
    {
      "id": "task-1",
      "title": "分析现有 provider 请求链路",
      "description": "确认用户消息捕获、工具注入和完成事件位置",
      "dependsOn": []
    }
  ]
}
```

扩展解析 JSON 后写入 `LlsTaskSession.tasks`。

## 7. 主模型系统提示增强

当 `@lls-task` 会话处于运行中时，需要向主模型追加系统提示，要求它遵守任务流：

```text
你正在执行一个 LLS Task 任务流。
必须按任务列表推进工作。
每完成、开始、阻塞或失败一个任务，都必须调用内置工具 update_lls_task_progress 更新进度。
不要只在文字中说明进度，必须调用工具。
如果任务未全部完成，本轮回答结束前应说明下一步需要继续执行的任务。
```

同时把当前任务流摘要注入上下文：

```text
当前任务流：
- [completed] task-1 分析现有代码结构
- [running] task-2 实现状态栏展示
- [pending] task-3 验证自动续跑
```

## 8. 内置工具设计

### 8.1 工具名称

建议工具名：

```text
update_lls_task_progress
```

### 8.2 工具描述

```text
Update the current @lls-task workflow progress. You must call this tool whenever you start, complete, fail, block, skip, or update a task.
```

### 8.3 工具参数 JSON Schema

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Optional task session id. If omitted, the active session is used."
    },
    "taskId": {
      "type": "string",
      "description": "Task id to update."
    },
    "status": {
      "type": "string",
      "enum": ["pending", "running", "completed", "failed", "skipped", "blocked"]
    },
    "progress": {
      "type": "number",
      "minimum": 0,
      "maximum": 100
    },
    "notes": {
      "type": "string"
    },
    "evidence": {
      "type": "array",
      "items": { "type": "string" }
    },
    "nextTaskId": {
      "type": "string"
    }
  },
  "required": ["taskId", "status"]
}
```

### 8.4 工具处理逻辑

1. 校验 session 是否存在。
2. 校验 taskId 是否属于当前 session。
3. 更新任务状态、进度、备注和证据。
4. 如果状态为 `running`，设置 `activeTaskId`。
5. 如果状态为 `completed`，自动计算整体完成度。
6. 如果所有任务完成，标记 session 为 `completed`。
7. 刷新状态栏和资源管理器。
8. 持久化任务流状态。
9. 返回简短工具结果给主模型。

返回示例：

```json
{
  "ok": true,
  "sessionStatus": "running",
  "completed": 2,
  "total": 5,
  "nextTask": "task-3"
}
```

## 9. 状态栏与资源管理器同步

### 9.1 状态栏文案

| 状态 | 示例 |
|---|---|
| 未启用 | `$(checklist) LLS Task` |
| 规划中 | `$(sync~spin) LLS Task 规划中` |
| 执行中 | `$(play) LLS Task 2/5` |
| 等待检测 | `$(watch) LLS Task 检测中` |
| 已暂停 | `$(debug-pause) LLS Task 已暂停` |
| 已完成 | `$(pass) LLS Task 完成` |
| 失败 | `$(error) LLS Task 失败` |

### 9.2 资源管理器刷新

`llsTask.treeView` 订阅 `service.onDidChangeSession` 事件。

每次工具更新任务状态后触发：

```ts
this._onDidChangeTreeData.fire(undefined);
```

## 10. 自动续跑调度

### 10.1 检测触发点

在 provider 确认主模型最终完成后调用：

```ts
llsTaskAutoContinue.schedulePostModelCheck(sessionId);
```

### 10.2 延迟一分钟检测

延迟检测事件首版按 `workspaceKey` 写入 Map 缓存，不按 `requestId` 管理。原因是首版目标是“一个工作区同一时间只运行一个 active LLS Task”，自动续跑只需要判断整个工作区是否空闲即可。

`sessionId` 仍然保留在 timer value 中，用于知道这个 timer 最终要检测哪个任务流；但 timer 的外层 key 使用 `workspaceKey`。

```ts
class LlsTaskAutoContinue {
  private pendingCheckTimers = new Map<string, {
    sessionId: string;
    timer: NodeJS.Timeout;
    scheduledAt: number;
  }>();

  schedulePostModelCheck(workspaceKey: string, sessionId: string): void {
    this.clearPostModelCheck(workspaceKey);

    const delayMs = config.autoContinueDelayMs ?? 60_000;
    const timer = setTimeout(() => {
      const pending = this.pendingCheckTimers.get(workspaceKey);
      this.pendingCheckTimers.delete(workspaceKey);

      if (!pending || pending.sessionId !== sessionId) {
        return;
      }

      void this.checkAndContinue(workspaceKey, sessionId);
    }, delayMs);

    this.pendingCheckTimers.set(workspaceKey, {
      sessionId,
      timer,
      scheduledAt: Date.now(),
    });
  }

  clearPostModelCheck(workspaceKey: string): void {
    const pending = this.pendingCheckTimers.get(workspaceKey);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingCheckTimers.delete(workspaceKey);
  }
}
```

关键规则：

1. 主模型完成后，按 `workspaceKey` 创建一个 1 分钟延时检测事件，并在 value 中记录目标 `sessionId`。
2. 如果同一个 `workspaceKey` 已经存在旧的延时检测事件，先清理旧事件，再写入新事件。
3. 如果 1 分钟内同一个工作区又发生新的模型请求，立即清理该工作区对应的延时检测事件。
4. timer 真正触发前，必须先从 Map 删除自己，避免重复触发或内存残留。
5. 首版不引入 `requestId`，只判断工作区级别是否正在执行模型请求。

### 10.3 检测条件

检测时必须同时满足：

1. `autoContinueEnabled === true`。
2. session 状态不是 `completed/failed/paused/cancelled`。
3. 当前没有任何主模型请求仍在执行。
4. 任务流中仍存在未完成任务。
5. `continueCount < maxContinueCount`。
6. 最近一次自动续跑不是刚刚触发，避免重复提交。

### 10.4 如何判断模型是否仍在执行

在 provider 请求开始和结束处维护工作区级模型活动状态。首版不需要 `requestId`，只需要知道“这个工作区当前是否有模型请求正在执行”。

由于首版限制为一个工作区同一时间只有一个 active LLS Task，所以工作区级状态足够使用，结构更简单，也能解决首次请求还没有 `sessionId` 的问题。

```ts
class ModelActivityTracker {
  private runningWorkspaces = new Set<string>();

  markStarted(workspaceKey: string): void {
    this.runningWorkspaces.add(workspaceKey);
  }

  markFinished(workspaceKey: string): void {
    this.runningWorkspaces.delete(workspaceKey);
  }

  isWorkspaceRunning(workspaceKey: string): boolean {
    return this.runningWorkspaces.has(workspaceKey);
  }

  isAnyRunning(): boolean {
    return this.runningWorkspaces.size > 0;
  }
}
```

请求开始时：

1. 解析当前请求所属的 `workspaceKey`。
2. 调用 `modelActivityTracker.markStarted(workspaceKey)`。
3. 清理该工作区已缓存的延时检测事件：`llsTaskAutoContinue.clearPostModelCheck(workspaceKey)`。

请求结束、取消、错误时：

1. 调用 `modelActivityTracker.markFinished(workspaceKey)`。
2. 获取该工作区当前 active task session。
3. 如果 session 未完成、未暂停、未取消，则重新调度该工作区的 1 分钟延时检测。

示例：

```ts
function onModelRequestStarted(workspaceKey: string) {
  modelActivityTracker.markStarted(workspaceKey);
  llsTaskAutoContinue.clearPostModelCheck(workspaceKey);
}

function onModelRequestFinished(workspaceKey: string) {
  modelActivityTracker.markFinished(workspaceKey);

  const session = llsTaskService.getActiveSession(workspaceKey);
  if (session && llsTaskService.shouldAutoContinue(session)) {
    llsTaskAutoContinue.schedulePostModelCheck(workspaceKey, session.id);
  }
}
```

检测时使用：

```ts
if (modelActivityTracker.isWorkspaceRunning(workspaceKey)) {
  return;
}
```

注意：这种实现不区分同一工作区内多个并发请求。如果后续允许一个工作区内多个模型请求并发，需要把 `runningWorkspaces` 升级为 `Map<workspaceKey, number>` 计数；如果后续允许一个工作区多个 LLS Task 并行，再升级为 `workspaceKey -> sessionId -> request` 的二级结构。首版不引入 `requestId`，保持实现简单。

### 10.5 自动续跑提示词

自动续跑提交给主模型的内容建议：

```text
@lls-task continue
当前任务流尚未完成，请继续执行下一个未完成任务。

任务流状态：
- [completed] task-1 ...
- [running] task-2 ...
- [pending] task-3 ...

要求：
1. 继续从第一个未完成或 running 的任务开始。
2. 每次任务状态变化必须调用 update_lls_task_progress。
3. 如果任务全部完成，请调用 update_lls_task_progress 标记所有任务 completed，并给出总结。
```

### 10.6 自动提交实现风险

因为本方案已经通过 `vscode.chat.createChatParticipant` 创建了自己的 `@lls-task` 智能体，所以自动续跑应优先围绕该 participant 设计：

1. 用户首次提交时进入 `lls.task` participant handler，创建任务流。
2. participant handler 内部可以把“执行当前任务流”的请求转交给当前配置的主模型。
3. 主模型完成后，provider 或任务服务触发 1 分钟延迟检测。
4. 如果任务未完成，扩展构造一条 `@lls-task continue` 续跑请求，再走同一套 participant/主模型执行链路。

需要注意：`createChatParticipant` 可以稳定捕获用户发给该智能体的消息，但 VS Code Chat API 对“扩展在无用户动作时主动向 Chat 面板提交一条可见用户消息”的支持可能仍然受限。因此自动续跑要分两层实现：

#### 自动续跑执行层

这层不依赖 Chat 面板是否真的插入了一条用户消息，而是由扩展内部直接调用当前主模型 provider/model 来继续执行任务流。

```ts
export interface LlsTaskRunner {
  runContinue(sessionId: string, prompt: string): Promise<void>;
}
```

执行层负责：

- 构造续跑 prompt。
- 注入任务流上下文。
- 复用 `update_lls_task_progress` 工具。
- 将模型输出通过 participant `stream` 或任务详情视图展示。
- 触发下一轮完成后的延迟检测。

#### Chat UI 提交层

如果希望 Chat 面板里也出现一条显式续跑消息，需要调研当前 VS Code 版本是否支持扩展主动提交 Chat 请求。可选路径：

1. 是否可以复用已有远程通知入站消息发送能力。
2. 是否可通过 command 或 proposed API 触发 Chat 请求。
3. 如果不能真正自动发送，则降级为：
   - 状态栏提示“任务未完成，点击继续”。
   - 提供命令 `openapicopilot.llsTask.continue`。
   - 点击后将续跑提示插入 Chat 输入框或直接触发发送。

首版建议把自动续跑抽象成接口：

```ts
export interface LlsTaskSubmitter {
  submit(prompt: string): Promise<boolean>;
}
```

不同实现：

- `ChatApiSubmitter`：如果 VS Code API 支持，直接发送。
- `ParticipantRunnerSubmitter`：不插入 Chat 用户消息，直接通过 `@lls-task` 智能体内部 runner 续跑。
- `RemoteInboundSubmitter`：复用远程入站消息通道。
- `ManualSubmitter`：插入输入框并提示用户确认。

首版建议默认使用 `ParticipantRunnerSubmitter`，保证任务流可以闭环；如果用户希望所有续跑都显示在 Chat 面板中，再提供配置切换到 `ChatApiSubmitter` 或 `ManualSubmitter`。

## 11. 配置项设计

### 11.1 基础配置项

建议在 `package.json` 增加：

```json
{
  "openapicopilot.llsTask.enabled": {
    "type": "boolean",
    "default": false,
    "description": "Enable @lls-task workflow mode.",
    "scope": "application"
  },
  "openapicopilot.llsTask.autoContinue": {
    "type": "boolean",
    "default": true,
    "description": "Automatically continue unfinished @lls-task workflows after the model becomes idle.",
    "scope": "application"
  },
  "openapicopilot.llsTask.autoContinueDelayMs": {
    "type": "number",
    "default": 60000,
    "minimum": 10000,
    "description": "Delay in milliseconds before checking whether an unfinished @lls-task workflow should continue.",
    "scope": "application"
  },
  "openapicopilot.llsTask.maxContinueCount": {
    "type": "number",
    "default": 10,
    "minimum": 1,
    "maximum": 50,
    "description": "Maximum number of automatic continuation attempts for one @lls-task workflow.",
    "scope": "application"
  },
  "openapicopilot.llsTask.persistWorkspaceState": {
    "type": "boolean",
    "default": true,
    "description": "Persist @lls-task workflow state in workspace storage.",
    "scope": "application"
  }
}
```

### 11.2 任务流模型配置

全局设置中需要参考现有“专家模式”设置方式，为 `@lls-task` 单独配置一个“任务流模型”。该模型专门负责：

1. 根据用户提交内容规划任务流。
2. 在任务执行过程中分析当前任务流状态。
3. 生成自动续跑提示词。
4. 必要时对任务流做重新规划。

任务流模型不要和专家模型强绑定，应该是独立配置项，但 UI、配置合并规则、provider/model 下拉选择逻辑要尽量复用专家模式已有实现。

#### 全局设置 UI

在全局设置页增加一个 `LLS Task / 任务流` 区域，布局参考专家模式：

```text
LLS Task / 任务流
├─ 启用 @lls-task                       [开关]
├─ 任务流模型提供商                      [下拉选择 provider]
├─ 任务流模型                            [下拉选择 model]
├─ 自动续跑                              [开关]
├─ 自动续跑延迟                          [数字输入，默认 60000]
└─ 最大自动续跑次数                      [数字输入，默认 10]
```

provider/model 选择规则参考专家模式：

1. 只展示已启用 provider。
2. 只展示 `isUserSelectable === true` 的模型。
3. provider 改变后刷新模型列表。
4. providerId 和 modelId 必须同时有效，否则认为任务流模型未配置。
5. 未配置任务流模型时，可以降级使用当前主模型，但状态栏和设置页要提示“任务流模型未配置”。

#### 建议配置项

在 `package.json` 中新增：

```json
{
  "openapicopilot.llsTask.providerId": {
    "type": "string",
    "default": "",
    "description": "Provider ID used by @lls-task workflow model.",
    "scope": "machine-overridable"
  },
  "openapicopilot.llsTask.modelId": {
    "type": "string",
    "default": "",
    "description": "Model ID used by @lls-task workflow model.",
    "scope": "machine-overridable"
  }
}
```

如果需要项目级覆盖，则参考专家模式增加：

```json
{
  "openapicopilot.llsTask.enabledState": {
    "type": "string",
    "enum": ["global", "enabled", "disabled"],
    "default": "global",
    "description": "Workspace @lls-task enabled state. Use global, force enabled, or force disabled for this workspace.",
    "scope": "resource"
  },
  "openapicopilot.llsTask.workspaceProviderId": {
    "type": "string",
    "default": "",
    "description": "Workspace provider ID used by @lls-task workflow model. Empty means use global task model.",
    "scope": "resource"
  },
  "openapicopilot.llsTask.workspaceModelId": {
    "type": "string",
    "default": "",
    "description": "Workspace model ID used by @lls-task workflow model. Empty means use global task model.",
    "scope": "resource"
  }
}
```

说明：当前项目专家模式的 provider/model 配置已经使用 `machine-overridable`，任务流模型建议保持一致，便于复用现有配置管理与 UI 逻辑。

#### 类型设计

```ts
export interface LlsTaskConfig {
  enabled: boolean;
  providerId: string;
  modelId: string;
  autoContinue: boolean;
  autoContinueDelayMs: number;
  maxContinueCount: number;
  persistWorkspaceState: boolean;
}

export interface WorkspaceLlsTaskConfig {
  enabledState: 'global' | 'enabled' | 'disabled';
  providerId: string;
  modelId: string;
}
```

#### 生效配置合并规则

参考专家模式：

```text
全局配置：
  enabled + providerId + modelId + autoContinue + autoContinueDelayMs + maxContinueCount

项目配置：
  enabledState: global | enabled | disabled
  providerId + modelId 可选覆盖

生效配置：
  enabled:
    项目 enabledState=global   => 使用全局 enabled
    项目 enabledState=enabled  => 强制 true
    项目 enabledState=disabled => 强制 false

  provider/model:
    项目 providerId 和 modelId 都非空 => 使用项目任务流模型
    否则 => 使用全局任务流模型
```

#### 任务流模型使用位置

任务流模型主要在这些场景调用：

1. `@lls-task` 首次创建时：根据 `request.prompt` 规划任务流。
2. 自动续跑前：根据当前任务状态生成下一轮执行提示。
3. 主模型多次没有调用进度工具时：分析是否需要重新提示或暂停。
4. 用户执行 `openapicopilot.llsTask.replan` 时：根据当前完成情况重新规划剩余任务。

如果任务流模型未配置：

1. 首选降级使用当前主模型。
2. 如果无法调用当前主模型，则使用默认任务流模板。
3. 在状态栏 tooltip 和任务流详情中提示用户去全局设置配置任务流模型。

## 12. 命令设计

建议新增命令：

| 命令 | 说明 |
|---|---|
| `openapicopilot.llsTask.open` | 打开任务流详情 |
| `openapicopilot.llsTask.continue` | 手动继续当前任务流 |
| `openapicopilot.llsTask.pause` | 暂停自动续跑 |
| `openapicopilot.llsTask.resume` | 恢复自动续跑 |
| `openapicopilot.llsTask.cancel` | 取消当前任务流 |
| `openapicopilot.llsTask.clearCompleted` | 清理已完成任务流 |
| `openapicopilot.llsTask.replan` | 基于当前进度重新规划 |

## 13. 实施阶段规划

### 阶段一：验证 Chat Participant 捕获用户消息

第一阶段先不做完整任务流、模型规划、状态栏和自动续跑，只验证一个最小闭环：扩展能在 Chat 面板中注册自己的任务流智能体，用户输入 `@lls-task` 并发送消息后，回调能够拿到 `request.prompt`。

这是后续 `@lls-task` 的基础入口验证。

#### 13.1.1 `package.json` 关键配置

在 `package.json` 中增加 Chat Participant contribution 和激活事件：

```json
{
  "activationEvents": [
    "onChatParticipant:lls.task"
  ],
  "contributes": {
    "chatParticipants": [
      {
        "id": "lls.task",
        "name": "lls-task",
        "description": "LLS Task 任务流聊天参与者"
      }
    ]
  }
}
```

说明：

- `id` 必须和 `createChatParticipant` 中注册的 ID 一致。
- `name` 是用户在 Chat 输入框中看到和使用的 mention 名称，因此这里输入 `@lls-task` 触发。
- `activationEvents` 使用 `onChatParticipant:lls.task`，确保用户调用该 Chat Participant 时扩展被激活。

#### 13.1.2 扩展入口代码

在 `activate` 中注册最小 Chat Participant：

```ts
export function activate(context: vscode.ExtensionContext) {
  const p = vscode.chat.createChatParticipant(
    'lls.task',
    async (request, stream) => {
      // 用户点发送就进到这里
      console.log('用户发送内容：', request.prompt);
      stream.markdown(`收到：${request.prompt}`);
    }
  );

  p.description = 'LLS Task 任务流助手';
  context.subscriptions.push(p);
}
```

#### 13.1.3 生效步骤

1. 装好扩展，或按 F5 调试启动 Extension Development Host 新窗口。
2. 打开 VS Code Chat 面板。
3. 在输入框输入 `@`。
4. 列表里能看到 `@lls-task`。
5. 选中 `@lls-task` 并发送消息。
6. 扩展回调触发，控制台输出：

```text
用户发送内容：xxx
```

7. Chat 响应区显示：

```text
收到：xxx
```

#### 13.1.4 第一阶段验收标准

第一阶段只验收以下内容：

1. Chat 输入框 `@` 列表能看到 `@lls-task`。
2. 发送给 `@lls-task` 的内容能进入 `createChatParticipant` 回调。
3. 能通过 `request.prompt` 获取用户提交内容。
4. 能通过 `stream.markdown` 在 Chat 中返回测试内容。
5. 控制台能打印用户提交内容。

验收通过后，在当前 `lls.task` / `@lls-task` 基础上继续增加任务规划、状态栏、资源管理器进度和自动续跑能力。

### 阶段二：基础任务流与展示

1. 新增 `src/llsTask/types.ts`。
2. 新增 `src/llsTask/service.ts`。
3. 新增状态栏模块。
4. 新增资源管理器 TreeView。
5. 新增基础配置项和命令。
6. 支持手动创建/更新任务流，先不接入模型。

验收：可以在 VS Code 中看到 LLS Task 状态栏和任务树，并通过内部调用刷新进度。

### 阶段三：接入 `@lls-task` 捕获与任务规划

1. 将第一阶段验证通过的 Chat Participant 改造成正式 `@lls-task` 智能体。
2. 通过 `request.prompt` 提取用户提交内容。
3. 调用规划器生成任务流。
4. 将任务流写入 service。
5. 将任务流摘要注入主模型提示。

验收：用户提交 `@lls-task xxx` 后，状态栏和资源管理器出现模型规划出的任务列表。

### 阶段四：进度更新工具

1. 注入内置工具 `update_lls_task_progress`。
2. 拦截该工具调用，不交给 VS Code 外部工具系统。
3. 更新任务状态。
4. 刷新状态栏和资源管理器。
5. 持久化状态。

验收：主模型执行过程中调用工具后，资源管理器任务状态实时变化。

### 阶段五：模型活动追踪与延迟检测

1. 在 provider 请求开始/结束维护活动计数。
2. 主模型完成后调度 1 分钟检测。
3. 检测模型是否仍在执行。
4. 检测任务流是否完成。
5. 输出日志与状态栏提示。

验收：主模型完成后 1 分钟，扩展能够判断是否需要续跑。

### 阶段六：自动续跑

1. 实现 `LlsTaskSubmitter` 抽象。
2. 优先复用已有远程入站消息或 Chat API 能力自动提交。
3. 不可用时降级到手动继续。
4. 增加最大续跑次数和防抖。
5. 增加暂停/恢复/取消命令。

验收：任务未完成时可以自动或半自动继续提交给主模型。

### 阶段七：稳定性与安全

1. 防止无限续跑。
2. 防止重复创建任务流。
3. 处理模型不调用进度工具的情况。
4. 处理任务规划 JSON 解析失败。
5. 处理 VS Code 重启后的状态恢复。
6. 完善日志与错误提示。

## 14. 失败与降级策略

### 14.1 模型没有调用进度更新工具

如果主模型完成但没有调用 `update_lls_task_progress`：

1. 状态栏提示“等待进度更新”。
2. 自动续跑提示中强调必须调用工具。
3. 连续 N 次没有更新后暂停自动续跑，避免无限循环。

### 14.2 任务规划失败

降级为默认任务流：

```text
1. 分析需求和代码现状
2. 制定实现方案
3. 修改代码
4. 检查错误和验证
5. 总结结果
```

### 14.3 自动提交不可用

降级为手动继续：

- 状态栏显示 `LLS Task 需要继续`。
- 点击状态栏执行 `openapicopilot.llsTask.continue`。
- 命令将续跑提示复制/插入 Chat 输入框。

### 14.4 连续失败

当连续自动续跑失败超过配置阈值：

1. session 标记为 `paused` 或 `failed`。
2. 状态栏展示错误。
3. 用户可手动恢复。

## 15. 与现有功能的关系

### 15.1 与专家模式

`@lls-task` 不直接替代专家模式。专家模式仍用于复杂问题独立分析，`@lls-task` 用于长任务拆解、进度追踪和自动续跑。

可选增强：任务规划阶段或任务阻塞时可以调用专家模式分析。

### 15.2 与方案提供商

`@lls-task` 可以复用方案提供商生成任务流。方案提供商偏向输出计划，`@lls-task` 偏向执行计划并追踪状态。

### 15.3 与远程通知

远程通知可以订阅任务流事件，把任务开始、完成、失败、自动续跑等事件发送到外部系统。

### 15.4 与 Prompt Enhancement

从远端或自动续跑提交的 `@lls-task continue` 应避免被提示词优化重复改写，建议复用已有“跳过提示词优化”的内部发送标记。

## 16. 关键风险

1. VS Code Chat API 可能不允许扩展无用户动作自动提交消息。
2. 主模型可能不稳定调用内置进度工具。
3. 自动续跑如果没有上限，可能造成循环消耗。
4. 多个 Chat 请求并发时，活动状态判断需要准确。
5. 多工作区场景下，任务流 session 需要绑定 workspace。
6. 任务规划 JSON 需要严格解析和容错。
7. 状态栏信息空间有限，详细信息必须放到 TreeView 或 Webview。

## 17. 首版推荐边界

首版建议只做一个活跃任务流 session，降低复杂度：

- 同一工作区同一时间只允许一个 active `@lls-task`。
- 新的 `@lls-task` 默认询问是否覆盖旧任务流。
- 自动续跑默认开启，但最大续跑次数限制为 10。
- 自动提交不可用时允许降级为手动继续。
- 任务规划优先复用方案提供商，不可用时使用默认简易规划。

## 18. 最小可行实现清单

MVP 可以按以下最小闭环实现：

1. 识别用户输入中的 `@lls-task`。
2. 基于用户内容生成任务列表。
3. 状态栏显示 `LLS Task x/y`。
4. TreeView 展示任务列表。
5. 注入并拦截 `update_lls_task_progress` 工具。
6. 主模型调用工具后刷新状态。
7. 主模型完成后 1 分钟检测是否还有未完成任务。
8. 如果未完成，先通过命令或手动按钮继续。
9. 后续再升级为完全自动提交。

## 19. 建议最终效果

用户只需要提交一次：

```text
@lls-task 帮我实现远程通知管理功能并完成验证
```

扩展自动完成：

1. 获取用户提交内容。
2. 规划任务流。
3. 写入状态栏和资源管理器。
4. 指挥主模型按任务流执行。
5. 主模型每阶段调用工具更新进度。
6. 一轮结束后延迟 1 分钟检测。
7. 未完成则继续提交。
8. 全部完成后状态栏显示完成，并输出最终总结。
