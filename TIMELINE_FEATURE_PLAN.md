# 时间线功能设计方案（AI Agent 内部使用版）

## 1. 目标

为本 VS Code 扩展增加一个面向 **AI agent 内部使用** 的本地时间线/快照能力：当 agent 或用户保存本地文件时，将当前文本内容保存到本地历史目录；当 Git 已经保护该文件当前内容后，自动删除该文件对应的本地快照。

本功能不是普通用户可视化时间线 UI，第一版主要服务于：

- agent 批量修改文件时提供短期恢复点；
- Git 尚未提交当前内容时提供本地兜底；
- Git 已保护当前文件后自动清理备份；
- 不依赖远程服务；
- 方便 agent 在需要时查询、读取、恢复历史快照。

第一版不实现：

- VS Code 原生 Timeline Provider；
- TreeView / Webview 时间线 UI；
- 复杂隐私确认 UI；
- VS Code 系统设置项；
- JSON snapshot 文件；
- 全局配额、保留天数、后台全局清理；
- 未保存 dirty document 的周期备份。

## 2. 存储路径规则

历史文件保存在用户主目录下：

```text
~/.LLSOAI/History/<文件绝对路径映射>/
```

其中 `<文件绝对路径映射>` 由原始文件绝对路径转换得到。

### 2.1 macOS / Linux 示例

原始文件：

```text
/Users/lls/project/src/provider.ts
```

历史目录：

```text
~/.LLSOAI/History/Users/lls/project/src/provider.ts/
```

> 说明：去掉开头的 `/`，把绝对路径作为目录层级保存。

### 2.2 Windows 示例

原始文件：

```text
C:\Users\lls\project\src\provider.ts
```

路径映射：

```text
C~~~~~/Users/lls/project/src/provider.ts
```

历史目录：

```text
~/.LLSOAI/History/C~~~~~/Users/lls/project/src/provider.ts/
```

> 说明：Windows 盘符中的 `:` 替换为 `~~~~~`，路径分隔符统一转换为 `/`。

### 2.3 最低路径安全要求

虽然该能力主要供 agent 内部使用，仍需避免路径逃逸：

- 使用 `path.resolve` / `path.normalize` 规范化 storageRoot 和源文件路径；
- 生成 history path 后必须校验其仍位于 storageRoot 内；
- 路径分隔符统一为 `/`；
- Windows 盘符 `:` 替换为 `~~~~~`；
- 不允许通过 `..`、空路径片段、控制字符逃逸到 storageRoot 外。

## 3. 历史文件结构

第一版快照文件直接保存文件原始内容，不使用 JSON snapshot。修改记录列表统一保存在 `metadata.json` 中。

每个源文件对应一个目录：

```text
~/.LLSOAI/History/<mapped-absolute-file-path>/
  metadata.json
  snapshots/
    2026-05-08T10-20-30-123Z.abcd1234
    2026-05-08T10-25-41-456Z.ef567890
```

### 3.1 snapshot 文件内容

snapshot 文件名格式：

```text
<ISO时间戳安全格式>.<sha256短hash>
```

示例：

```text
2026-05-08T10-20-30-123Z.abcd1234
```

snapshot 文件内容就是源文件保存时的原始内容：

```text
<原始文件内容>
```

说明：

- snapshot 不包裹 JSON；
- snapshot 不额外写入 metadata；
- 第一版仅支持文本文件；
- 二进制文件、无法解码文件、超过大小限制的文件直接跳过；
- `sha256` 基于保存后的文件内容计算，用于去重和生成文件名；
- `lineCount` 记录该快照原始内容的总行数，便于 agent 后续按行读取和规划恢复；
- 文件名包含时间戳和短 hash，便于排序与排查。

`lineCount` 计算规则固定为：

```ts
function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r\n|\r|\n/).length;
}
```

补充规则：

- 空文件 `lineCount = 0`；
- 文件末尾存在换行时，最后的空行会按上述 split 规则计入；
- `eol` 记录主要换行类型：`lf | crlf | cr | mixed | none`；
- `hasTrailingNewline` 记录原始内容是否以换行结尾；
- `timeline_read_snapshot_lines` 使用 1-based 行号；
- 当 `startLine > totalLines` 时返回空内容和 `returnedLineCount = 0`。

### 3.2 metadata.json

`metadata.json` 保存文件级元信息、最新快照指针和完整修改记录列表：

```json
{
  "version": 1,
  "sourcePath": "/Users/lls/project/src/provider.ts",
  "canonicalPath": "/Users/lls/project/src/provider.ts",
  "mappedPath": "Users/lls/project/src/provider.ts",
  "workspaceFolder": "/Users/lls/project",
  "createdAt": "2026-05-08T10:20:30.123Z",
  "updatedAt": "2026-05-08T10:25:41.456Z",
  "latest": {
    "id": "2026-05-08T10-25-41-456Z.ef567890",
    "path": "snapshots/2026-05-08T10-25-41-456Z.ef567890",
    "sha256": "...",
    "size": 12345,
    "lineCount": 320,
    "savedAt": "2026-05-08T10:25:41.456Z"
  },
  "records": [
    {
      "id": "2026-05-08T10-20-30-123Z.abcd1234",
      "path": "snapshots/2026-05-08T10-20-30-123Z.abcd1234",
      "savedAt": "2026-05-08T10:20:30.123Z",
      "reason": "onDidSaveTextDocument",
      "sha256": "...",
      "size": 12345,
      "lineCount": 320,
      "eol": "lf",
      "hasTrailingNewline": true,
      "encoding": "utf8",
      "isText": true,
      "languageId": "typescript",
      "git": {
        "repoRoot": "/Users/lls/project",
        "head": "...",
        "isTracked": true,
        "status": "modified"
      }
    }
  ]
}
```

## 4. 触发时机

第一版仅监听：

```ts
vscode.workspace.onDidSaveTextDocument
```

原因：

- 保存后磁盘内容已经稳定；
- Git status 判定更可靠；
- agent 内部使用不需要捕捉保存前版本；
- 实现更简单，误判更少。

第一版不备份 dirty documents，不做定时 debounce 备份。

### 4.1 保存时处理流程

```text
onDidSaveTextDocument(document)
  -> 如果 document.uri.scheme !== "file"，返回
  -> 如果命中 excludeGlobs，返回
  -> 读取磁盘文件 Buffer
  -> 如果超过 maxFileSizeMB，返回
  -> 判断是否为文本
  -> 计算 sha256
  -> 计算 lineCount
  -> 如果与 metadata.latest.sha256 相同，返回
  -> 写入 snapshots/<timestamp>.<hash> 原始内容
  -> 更新 metadata.json 中的 latest 和 records，包括 lineCount
  -> pruneOldSnapshots(filePath, maxSnapshotsPerFile)
  -> isCurrentFileCommitted(filePath)
     如果 true:
       cleanCommittedFileHistory(filePath)
```

## 5. Git 集成策略

核心规则：

> 如果 Git 已经保护该文件当前内容，则删除该文件对应的本地快照目录。

第一版将“当前文件已被 Git 提交/保护”定义为：

```text
文件在 Git 仓库内 &&
文件被 Git 跟踪 &&
仓库存在 HEAD &&
git status --porcelain=v1 --untracked-files=no -- <relativePath> 为空
```

满足以上条件时，说明工作区中该文件相对于 HEAD 没有未提交变化，可以清理该文件历史目录中的所有 snapshots，并保留或新增 `metadata.json` 记录清理事件。

### 5.1 推荐 Git 命令

实现中通过 Node `child_process` 调用 Git，必须使用参数数组，避免 shell 拼接。

识别仓库：

```bash
git -C <fileDir> rev-parse --show-toplevel
```

确认仓库存在 HEAD：

```bash
git -C <repoRoot> rev-parse --verify HEAD
```

检查文件是否被跟踪：

```bash
git -C <repoRoot> ls-files --error-unmatch -- <relativePath>
```

检查文件状态：

```bash
git -C <repoRoot> status --porcelain=v1 --untracked-files=no -- <relativePath>
```

### 5.2 重要约束

- 不使用 `sha256(document.getText()) === sha256(git show HEAD:path)` 作为核心判定；
- 内容 hash 只用于 snapshot 去重；
- Git 命令必须设置超时，例如 2-3 秒；
- 初始仓库没有 HEAD 时不清理；
- untracked 文件不清理；
- modified 文件不清理；
- Git 命令失败不影响用户保存，只记录日志。

### 5.3 清理策略

MVP 固定采用：

```text
cleanMode = all
```

即：当 `isCurrentFileCommitted(filePath) === true` 时，保留该源文件对应的历史目录和 `metadata.json`，删除 `snapshots/` 下所有快照文件，并在 metadata 中记录 `lastGitCleanup`。

理由：

- 该功能主要给 agent 内部使用，不需要保留面向用户的完整快照内容；
- Git 已保护后，本地快照只作为临时兜底，继续保留意义不大；
- 保留 metadata 可以让 agent 知道该文件曾经被快照过、何时因 Git 提交被清理；
- 符合“如果 Git 提交了这个文件，把当前保存的备份删除，同时保留 metadata 记录”的需求。

### 5.4 Git 提交后监听与按变动文件清理

除了在文件保存后调用 `isCurrentFileCommitted(filePath)` 做单文件清理，还可以监听 Git 仓库 `HEAD` 变化，在提交操作完成后获取本次提交涉及的文件列表，然后按文件清理对应快照。

该能力用于覆盖以下场景：

- agent 或用户批量修改多个文件后执行 Git 提交；
- 部分文件保存后没有再次触发 `onDidSaveTextDocument`；
- 提交由 VS Code Git 面板、终端、外部 Git 工具完成；
- 希望提交完成后立即清理所有已被 Git 保护的文件快照。

#### 5.4.1 监听方式

不建议拦截 `git commit` 命令本身，而是监听仓库 `.git/HEAD` 和相关 ref 文件变化。

推荐策略：

```text
扩展启动时扫描 workspace 中的 Git 仓库
  -> 记录每个 repoRoot 当前 HEAD commit
  -> 使用 FileSystemWatcher 监听：
       <repo>/.git/HEAD
       <repo>/.git/refs/heads/**
       <repo>/.git/packed-refs
  -> 发生变化后 debounce
  -> 重新读取 HEAD commit
  -> 如果 HEAD commit 变化：
      getCommittedChangedPaths(repoRoot, oldHead, newHead)
      对每个 changed path 执行 cleanCommittedFileHistory
```

注意：

- `.git` 可能是目录，也可能是 worktree/submodule 中的 gitfile，需要解析 `.git` 文件中的 `gitdir: ...`；
- 监听 ref 文件要 debounce，避免一次 commit 触发多次事件；
- 扩展未运行期间发生的提交无法实时监听，但下次启动可以通过记录的 repo HEAD 做补偿扫描。

#### 5.4.2 获取提交变动文件列表

如果已记录旧 HEAD：

```bash
git -C <repoRoot> diff-tree --no-commit-id --name-status -r -M -z <oldHead> <newHead>
```

如果没有旧 HEAD，例如首次启动或首次检测到仓库：

```bash
git -C <repoRoot> diff-tree --root --no-commit-id --name-status -r -M -z <newHead>
```

对 merge commit，建议使用：

```bash
git -C <repoRoot> diff-tree --no-commit-id --name-status -r -M -m -z <newHead>
```

说明：

- 使用 `--name-status` 而不是 `--name-only`，便于识别新增、修改、删除、rename；
- 使用 `-M` 识别 rename；
- 使用 `-z` 以 NUL 分隔路径，避免文件名包含空格、tab、换行时解析错误；
- root commit 需要 `--root`；
- merge commit 使用 `-m` 后需要对结果去重。

得到的相对路径转换为绝对路径：

```text
absolutePath = path.join(repoRoot, relativePath)
```

然后对每个路径执行一次二次确认：

```text
isPathSafeToCleanAfterCommit(repoRoot, relativePath) === true
```

只有确认该路径当前安全时，才清理对应历史，避免提交后用户又立刻修改或新建同名文件导致误删。

`isPathSafeToCleanAfterCommit` 需要覆盖普通修改、删除文件、rename 旧路径：

- 路径仍存在于 HEAD 且工作区 clean：可以清理；
- 路径已从 HEAD 删除，且磁盘文件也不存在：可以清理旧路径 snapshots；
- 路径已从 HEAD 删除，但磁盘文件存在：不清理；
- 路径存在 modified、deleted、conflict 或 untracked 状态：不清理。

#### 5.4.3 清理行为

提交后针对每个 changed file 的处理：

```text
cleanCommittedFileHistory(filePath, commitInfo)
  -> historyDir = getHistoryDirectory(storageRoot, filePath)
  -> 如果 historyDir 不存在：
       可选择跳过
       或创建 metadata.json 记录 committed 清理事件
  -> 读取或创建 metadata.json
  -> 删除 snapshots/ 下所有快照文件
    -> 更新 metadata.json：
      latest = null
       records = []
       lastGitCleanup = {
         cleanedAt,
         repoRoot,
         commit,
         reason: "gitCommit",
         changedPath
       }
  -> 原子写回 metadata.json
```

用户提出的“在对应的文件的文件夹中新增 metadata 并删除所有快照”建议按以下规则实现：

- 如果该文件已有 historyDir：保留目录，更新 `metadata.json`，删除 `snapshots/` 下所有快照；
- 如果该文件没有 historyDir：可以创建目录和 `metadata.json`，记录一次 `gitCommit` 清理事件，但不创建 snapshots；
- 不删除文件目录本身，因为 metadata 可作为 agent 后续判断“该文件已被 Git 提交并清理过”的依据。

#### 5.4.4 metadata 清理事件示例

```json
{
  "version": 1,
  "sourcePath": "/Users/lls/project/src/provider.ts",
  "canonicalPath": "/Users/lls/project/src/provider.ts",
  "mappedPath": "Users/lls/project/src/provider.ts",
  "workspaceFolder": "/Users/lls/project",
  "createdAt": "2026-05-08T10:20:30.123Z",
  "updatedAt": "2026-05-08T11:00:00.000Z",
  "latest": null,
  "records": [],
  "lastGitCleanup": {
    "cleanedAt": "2026-05-08T11:00:00.000Z",
    "repoRoot": "/Users/lls/project",
    "commit": "abcdef1234567890",
    "reason": "gitCommit",
    "changedPath": "src/provider.ts"
  }
}
```

#### 5.4.5 边界情况

- 文件在提交中被删除：可以清理该文件历史目录中的 snapshots，并保留 metadata 的 `lastGitCleanup`；
- 文件 rename：使用 `diff-tree --name-status -M -z` 获取旧路径和新路径，并对旧路径和新路径都尝试清理；
- merge commit：使用 `-m` 获取各父提交视角的变动文件，并去重；
- rebase / reset / checkout：HEAD 也会变化，但不一定是普通 commit，需要仍然通过 `isPathSafeToCleanAfterCommit` 二次确认后再清理；
- 扩展未运行时的提交：可在启动时读取上次记录的 repo HEAD，与当前 HEAD 比较，补偿清理区间内变动文件。

#### 5.4.6 持久化 repo HEAD 状态

为了支持扩展重启后的补偿清理，需要记录每个仓库上次处理过的 HEAD：

```text
~/.LLSOAI/History/.repos/<repoHash>.json
```

示例：

```json
{
  "repoRoot": "/Users/lls/project",
  "repoHash": "...",
  "lastProcessedHead": "abcdef1234567890",
  "updatedAt": "2026-05-08T11:00:00.000Z"
}
```

当检测到 HEAD 从 `oldHead` 变为 `newHead` 且清理完成后，再更新 `lastProcessedHead`。

## 6. 内置策略

该能力主要给 AI agent 使用，不需要暴露 VS Code 系统设置项，不在 `package.json` 中增加 configuration。

MVP 使用固定内置策略：

```ts
const TIMELINE_POLICY = {
  enabled: true,
  storageRoot: "~/.LLSOAI/History",
  maxFileSizeMB: 2,
  maxSnapshotsPerFile: 20,
  cleanWhenCommitted: true,
  excludeGlobs: [
    "**/.git/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**",
    "**/build/**",
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/.ssh/**",
    "**/.aws/**",
    "**/.azure/**",
    "**/.kube/**",
    "**/secrets/**"
  ]
} as const;
```

说明：

- 默认启用，不需要用户设置；
- storageRoot 固定为 `~/.LLSOAI/History`；
- `cleanMode` 固定为 `all`；
- 不提供 `pathMode`、`maxTotalSizeMB`、`retentionDays`、`backupDirtyDocuments` 等配置；
- 后续如果 agent 需要临时关闭或调整策略，应通过内部代码接口实现，不通过 VS Code 设置系统。

## 7. 模块拆分建议

建议新增文件：

```text
src/timeline/
  pathMapper.ts
  storage.ts
  git.ts
  repoWatcher.ts
  service.ts
  types.ts
  commands.ts        # 可选，仅用于调试/手动恢复
```

### 7.1 pathMapper.ts

职责：

- 将文件绝对路径转换为历史目录路径；
- Windows `:` 替换为 `~~~~~`；
- 统一路径分隔符；
- 校验最终路径仍在 storageRoot 内。

关键函数：

```ts
export function mapAbsolutePathToHistoryKey(filePath: string): string;
export function getHistoryDirectory(storageRoot: string, filePath: string): string;
```

### 7.2 storage.ts

职责：

- 写入原始内容 snapshot；
- 维护 `metadata.json` 中的 latest 和 records；
- 读取历史列表；
- 读取某个 snapshot；
- 清理 snapshots 并保留/更新 metadata；
- 按 `maxSnapshotsPerFile` 裁剪旧快照；
- 原子写入，避免中途崩溃导致 snapshot 或 metadata 损坏。

关键接口：

```ts
export class TimelineStorage {
  saveSnapshot(input: SaveSnapshotInput): Promise<SnapshotRecord>;
  getLatest(filePath: string): Promise<SnapshotRecord | undefined>;
  listSnapshots(filePath: string): Promise<SnapshotSummary[]>;
  readSnapshot(filePath: string, snapshotId: string): Promise<SnapshotRecord | undefined>;
  cleanSnapshots(filePath: string, cleanupInfo: GitCommitCleanupInfo): Promise<void>;
  pruneOldSnapshots(filePath: string, maxSnapshots: number): Promise<void>;
}
```

### 7.3 git.ts

职责：

- 判断文件是否在 Git 仓库内；
- 判断仓库是否存在 HEAD；
- 判断文件是否被 Git 跟踪；
- 判断当前工作区文件是否 clean；
- 暴露 `isCurrentFileCommitted`。

关键函数：

```ts
export async function getGitInfo(filePath: string): Promise<GitInfo | undefined>;
export async function isCurrentFileCommitted(filePath: string): Promise<boolean>;
export async function resolveGitDirectories(repoRoot: string): Promise<GitDirectories>;
export async function getCommittedChangedPaths(repoRoot: string, oldHead: string | undefined, newHead: string): Promise<ChangedPath[]>;
export async function isPathSafeToCleanAfterCommit(repoRoot: string, relativePath: string): Promise<boolean>;
```

### 7.4 repoWatcher.ts

职责：

- 扫描 workspace 中的 Git 仓库；
- 记录每个仓库当前 HEAD；
- 监听 `.git/HEAD`、refs 和 `packed-refs` 变化；
- debounce 后识别 HEAD commit 是否变化；
- 获取提交涉及的变动文件列表；
- 调用 service 清理对应文件的 snapshots 并更新 metadata。

关键类：

```ts
export class GitRepositoryWatcher implements vscode.Disposable {
  constructor(private readonly service: TimelineService) {}
  register(): vscode.Disposable;
  dispose(): void;

  // 可选：响应 workspace folder 动态变化时重新扫描仓库。
  refresh(): Promise<void>;
}
```

### 7.5 service.ts

职责：

- 注册 `onDidSaveTextDocument`；
- 注册 Git repository watcher；
- 应用配置；
- 调用 storage 与 git；
- 控制同一文件保存事件串行化；
- 处理 hash 去重和错误日志。

关键类：

```ts
export class TimelineService {
  constructor(private readonly context: vscode.ExtensionContext) {}
  register(): vscode.Disposable;

  saveDocumentSnapshot(document: vscode.TextDocument, reason: TimelineSaveReason): Promise<void>;
  listSnapshots(filePath: string): Promise<SnapshotSummary[]>;
  readSnapshot(filePath: string, snapshotId: string): Promise<SnapshotRecord | undefined>;
  restoreSnapshot(filePath: string, snapshotId: string): Promise<void>;
  cleanIfCommitted(filePath: string): Promise<void>;
  cleanCommittedFileHistory(filePath: string, commitInfo: GitCommitCleanupInfo): Promise<void>;
}
```

### 7.6 commands.ts（可选）

该功能主要给 agent 内部使用，MVP 不需要完整 UI。但为方便调试和手动救援，可选注册少量命令：

```text
openapicopilot.timeline.showCurrentFileHistory
openapicopilot.timeline.restoreLatestForCurrentFile
openapicopilot.timeline.cleanCurrentFileHistory
```

这些命令可以使用简单 QuickPick，不实现 TreeView / Webview / Timeline Provider。

## 8. 不接入 VS Code Timeline Provider

第一版不接入 VS Code Timeline Provider。

原因：

- 该功能定位为 AI agent 内部本地快照服务；
- 原生 Timeline 是面向用户展示的 UI，不是 MVP 核心；
- 不接入可以减少 API 兼容性、UI、测试复杂度；
- agent 可直接通过内部服务 API 查询、读取和恢复快照。

## 8.1 需要使用的 VS Code API

第一版虽然不接入 VS Code Timeline Provider，但仍需要以下稳定 VS Code API：

| API | 用途 |
|---|---|
| `vscode.workspace.onDidSaveTextDocument` | 监听本地文件保存事件，触发快照保存 |
| `vscode.TextDocument.uri` | 判断文档 scheme 是否为 `file` |
| `vscode.TextDocument.uri.fsPath` / `document.fileName` | 获取本地文件绝对路径 |
| `vscode.workspace.workspaceFolders` | 扫描当前打开的 workspace folder，发现 Git 仓库 |
| `vscode.workspace.onDidChangeWorkspaceFolders` | 可选：workspace folder 增删时刷新 Git watcher |
| `vscode.workspace.createFileSystemWatcher` | 监听 `.git/HEAD`、refs、`packed-refs` 变化 |
| `vscode.RelativePattern` | 针对指定 `.git` 或 gitdir 目录创建 watcher |
| `vscode.FileSystemWatcher.onDidChange/onDidCreate/onDidDelete` | 接收 Git ref 文件变化事件 |
| `vscode.Disposable` | 管理异步创建的 watcher、事件监听器和 timer 生命周期 |
| `vscode.ExtensionContext.subscriptions` | 统一管理 disposable，扩展停用时释放监听器 |
| `vscode.window.createOutputChannel` | 输出调试和错误日志，避免弹窗干扰 |
| `vscode.window.activeTextEditor` | 可选调试命令中获取当前文件 |
| `vscode.window.showQuickPick` | 可选调试命令中展示当前文件历史 |
| `vscode.commands.registerCommand` | 可选调试命令：查看历史、恢复 latest、清理当前文件历史 |
| `vscode.Uri.file` | 将本地路径转换为 VS Code Uri，供 watcher 或文件 API 使用 |
| `vscode.workspace.fs` | 可选：用于 VS Code Uri 风格的文件读写；MVP 优先使用 Node `fs/promises` |

注意：

- `onDidSaveTextDocument` 在文档保存到磁盘后触发，适合本方案；
- `onWillSaveTextDocument` 有保存前时间预算和误用风险，MVP 不使用；
- `createFileSystemWatcher` 的递归监听成本较高，应尽量监听明确的 `.git` 文件和 refs 目录，而不是大范围 `**`；
- `.git` 目录可能被 VS Code 的 `files.watcherExclude` 或系统事件优化影响，因此提交后清理还需要启动时 HEAD 补偿扫描。
- 避免对整个 workspace 或整个 `.git/**` 做大范围递归监听；对 `refs/heads/**` 的小范围递归监听可以接受，因为 Git 分支名可能包含 `/`。

## 8.2 VS Code API 示例

### 8.2.1 在 extension.ts 注册 TimelineService

```ts
import * as vscode from "vscode";
import { TimelineService } from "./timeline/service";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("OpenAPI Copilot Timeline");
  const timeline = new TimelineService(context, output);

  context.subscriptions.push(output);
  context.subscriptions.push(timeline.register());
}
```

### 8.2.2 监听文件保存事件

```ts
import * as vscode from "vscode";

export class TimelineService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  register(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        void this.handleDidSave(document);
      })
    );

    const repoWatcher = new GitRepositoryWatcher(this, this.output);
    disposables.push(repoWatcher.register());

    return vscode.Disposable.from(...disposables);
  }

  private async handleDidSave(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== "file") {
      return;
    }

    const filePath = document.uri.fsPath;

    try {
      await this.saveDocumentSnapshot(document, "onDidSaveTextDocument");
      await this.cleanIfCommitted(filePath);
    } catch (error) {
      this.output.appendLine(`[timeline] save failed: ${String(error)}`);
    }
  }
}
```

### 8.2.3 扫描 workspace folder 并发现 Git 仓库

```ts
import * as vscode from "vscode";
import * as path from "path";

export function getWorkspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.fsPath);
}

export async function discoverGitRepos(): Promise<string[]> {
  const repos = new Set<string>();

  for (const folder of getWorkspaceFolders()) {
    const repoRoot = await tryGitRevParse(folder);
    if (repoRoot) {
      repos.add(path.resolve(repoRoot));
    }
  }

  return [...repos];
}
```

`tryGitRevParse` 使用 Node `child_process` 执行：

```bash
git -C <folder> rev-parse --show-toplevel
```

### 8.2.4 使用 FileSystemWatcher 监听 Git HEAD/ref 变化

```ts
import * as vscode from "vscode";
import * as path from "path";

export class GitRepositoryWatcher {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(
    private readonly service: TimelineService,
    private readonly output: vscode.OutputChannel
  ) {}

  register(): vscode.Disposable {
    void this.initialize().catch((error) => {
      this.output.appendLine(`[timeline] repo watcher init failed: ${String(error)}`);
    });

    return this;
  }

  dispose(): void {
    this.disposed = true;

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    vscode.Disposable.from(...this.disposables).dispose();
    this.disposables.length = 0;
  }

  private addDisposable(disposable: vscode.Disposable): void {
    if (this.disposed) {
      disposable.dispose();
      return;
    }

    this.disposables.push(disposable);
  }

  private async initialize(): Promise<void> {
    const repoRoots = await discoverGitRepos();

    for (const repoRoot of repoRoots) {
      if (this.disposed) {
        return;
      }

      const gitDirs = await resolveGitDirectories(repoRoot);
      this.watchGitDirs(repoRoot, gitDirs);
    }
  }

  private watchGitDirs(repoRoot: string, gitDirs: GitDirectories): void {
    // worktree git dir: HEAD 通常在这里
    this.watch(repoRoot, gitDirs.gitDir, "HEAD");

    // common git dir: refs/heads 和 packed-refs 通常在这里
    this.watch(repoRoot, gitDirs.commonGitDir, "packed-refs");
    this.watch(repoRoot, gitDirs.commonGitDir, "refs/heads/**");

    // 如果 gitDir 与 commonGitDir 不同，也监听 worktree gitDir 下可能存在的 refs
    if (path.resolve(gitDirs.gitDir) !== path.resolve(gitDirs.commonGitDir)) {
      this.watch(repoRoot, gitDirs.gitDir, "packed-refs");
      this.watch(repoRoot, gitDirs.gitDir, "refs/heads/**");
    }
  }

  private watch(repoRoot: string, base: string, pattern: string): void {
    if (this.disposed) {
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(base), pattern),
      false,
      false,
      false
    );

    const schedule = () => this.scheduleRepoRefresh(repoRoot);

    this.addDisposable(watcher);
    this.addDisposable(watcher.onDidCreate(schedule));
    this.addDisposable(watcher.onDidChange(schedule));
    this.addDisposable(watcher.onDidDelete(schedule));
  }

  private scheduleRepoRefresh(repoRoot: string): void {
    if (this.disposed) {
      return;
    }

    const oldTimer = this.timers.get(repoRoot);
    if (oldTimer) {
      clearTimeout(oldTimer);
    }

    const timer = setTimeout(() => {
      this.timers.delete(repoRoot);

      if (!this.disposed) {
        void this.handleRepoMaybeChanged(repoRoot);
      }
    }, 300);

    this.timers.set(repoRoot, timer);
  }
}

interface GitDirectories {
  gitDir: string;
  commonGitDir: string;
}
```

说明：

- `RelativePattern(vscode.Uri.file(base), pattern)` 可以监听 workspace 外的具体目录；
- 不建议对整个 workspace 用 `**/.git/**` 做全局递归 watcher；
- 每个 watcher、事件监听器和 timer 必须能被 dispose；
- `register()` 中异步初始化后再追加 disposable，因此不能返回创建时展开的 `Disposable.from(...this.disposables)`，应由 watcher 自身实现动态 `dispose()`；
- worktree 场景需要同时考虑 `gitDir` 和 `commonGitDir`；
- `RelativePattern(vscode.Uri.file(base), pattern)` 可以监听 workspace 外的具体目录，但仍需要启动时 HEAD 补偿扫描，不能只依赖 watcher 事件。

### 8.2.5 解析 Git 目录和 common git dir

worktree/submodule 场景下 `.git` 可能不是目录，而是一个包含 `gitdir: ...` 的文件。并且 worktree 的 `HEAD` 可能在 worktree git dir 中，而 `refs/heads/**`、`packed-refs` 可能位于 common git dir。

推荐通过 Git 命令解析：

```bash
git -C <repoRoot> rev-parse --git-dir
git -C <repoRoot> rev-parse --git-common-dir
```

示例接口：

```ts
export async function resolveGitDirectories(repoRoot: string): Promise<GitDirectories> {
  const gitDirRaw = await runGit(repoRoot, ["rev-parse", "--git-dir"]);
  const commonGitDirRaw = await runGit(repoRoot, ["rev-parse", "--git-common-dir"]);

  return {
    gitDir: path.resolve(repoRoot, gitDirRaw.trim()),
    commonGitDir: path.resolve(repoRoot, commonGitDirRaw.trim())
  };
}
```

### 8.2.6 HEAD 变化后获取变动文件并清理

```ts
private async handleRepoMaybeChanged(repoRoot: string): Promise<void> {
  try {
    const oldHead = await this.readLastProcessedHead(repoRoot);
    const newHead = await getCurrentHead(repoRoot);

    if (!newHead || oldHead === newHead) {
      return;
    }

    const changedPaths = await getCommittedChangedPaths(repoRoot, oldHead, newHead);

    for (const changedPath of changedPaths) {
      const paths = [changedPath.path, changedPath.oldPath].filter(Boolean) as string[];

      for (const relativePath of paths) {
        try {
          if (await isPathSafeToCleanAfterCommit(repoRoot, relativePath)) {
            await this.service.cleanCommittedFileHistory(path.join(repoRoot, relativePath), {
              repoRoot,
              commit: newHead,
              changedPath: relativePath,
              reason: "gitCommit",
              cleanedAt: new Date().toISOString()
            });
          }
        } catch (error) {
          this.output.appendLine(
            `[timeline] cleanup failed for ${relativePath}: ${String(error)}`
          );
        }
      }
    }

    // 清理是 best-effort。即使个别文件失败，也记录日志后推进 lastProcessedHead，避免重复处理同一批提交。
    await this.writeLastProcessedHead(repoRoot, newHead);
  } catch (error) {
    this.output.appendLine(`[timeline] repo watcher failed: ${String(error)}`);
  }
}
```

### 8.2.7 获取提交变动路径

普通 `--name-only` 不足以可靠处理 rename。推荐使用 `--name-status -M -z`，以便识别新增、修改、删除、重命名，并安全处理带空格、tab、换行的文件名。

有 oldHead 时：

```bash
git -C <repoRoot> diff-tree --no-commit-id --name-status -r -M -z <oldHead> <newHead>
```

root commit 或没有 oldHead 时：

```bash
git -C <repoRoot> diff-tree --root --no-commit-id --name-status -r -M -z <newHead>
```

merge commit 可使用 `-m` 并对结果去重：

```bash
git -C <repoRoot> diff-tree --no-commit-id --name-status -r -M -m -z <newHead>
```

示例解析结果类型：

```ts
interface ChangedPath {
  status: "A" | "M" | "D" | "R" | "C" | string;
  path: string;
  oldPath?: string;
}
```

rename 示例：

```text
R100\0src/old.ts\0src/new.ts\0
```

应解析为：

```ts
{
  status: "R100",
  oldPath: "src/old.ts",
  path: "src/new.ts"
}
```

清理时旧路径和新路径都要尝试处理。

### 8.2.8 提交后清理的二次确认函数

普通 `isCurrentFileCommitted(filePath)` 不适合删除文件和 rename 旧路径场景。提交后按 changed files 清理时，应使用更宽的确认函数：

```ts
export async function isPathSafeToCleanAfterCommit(
  repoRoot: string,
  relativePath: string
): Promise<boolean> {
  const absolutePath = path.join(repoRoot, relativePath);

  // 需要包含 untracked，避免提交删除后用户又新建同名未跟踪文件时误清理。
  const status = await gitStatusPorcelain(repoRoot, relativePath, {
    untrackedFiles: "all"
  });

  if (status.trim() !== "") {
    return false;
  }

  const existsInHead = await gitPathExistsInHead(repoRoot, relativePath);
  if (existsInHead) {
    return true;
  }

  const fileExists = await existsOnDisk(absolutePath);
  return !fileExists;
}
```

语义：

- 路径仍存在于 HEAD 且工作区 clean：可以清理；
- 路径已从 HEAD 删除，且磁盘文件也不存在：可以清理旧路径 snapshots；
- 路径已从 HEAD 删除，但磁盘文件存在：保守起见不清理；
- 路径仍 modified、deleted、conflict 或 untracked：不清理。

对应 Git 命令：

```bash
git -C <repoRoot> status --porcelain=v1 --untracked-files=all -- <relativePath>
git -C <repoRoot> cat-file -e HEAD:<relativePath>
```

所有 Git 命令必须使用参数数组调用，不能 shell 拼接。

### 8.2.9 可选调试命令注册示例

```ts
context.subscriptions.push(
  vscode.commands.registerCommand(
    "openapicopilot.timeline.restoreLatestForCurrentFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== "file") {
        return;
      }

      await timeline.restoreLatest(editor.document.uri.fsPath);
    }
  )
);
```

如果需要展示当前文件历史，可使用 `vscode.window.showQuickPick`：

```ts
const picked = await vscode.window.showQuickPick(
  snapshots.map((item) => ({
    label: item.savedAt,
    description: item.sha256.slice(0, 8),
    snapshotId: item.id
  })),
  { placeHolder: "选择要恢复的时间线快照" }
);
```

### 8.2.10 workspace folder 变化监听（可选）

MVP 可以只在扩展启动时扫描 workspace folder。后续可通过以下 API 支持动态增删 workspace folder：

```ts
context.subscriptions.push(
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void repoWatcher.refresh();
  })
);
```

### 8.2.11 文件写入 API 选择

本方案保存路径固定在本地 `~/.LLSOAI/History`，因此实现可优先使用 Node.js：

```ts
import { promises as fs } from "fs";

await fs.mkdir(historyDir, { recursive: true, mode: 0o700 });
await fs.writeFile(tmpPath, contentBuffer, { mode: 0o600 });
await fs.rename(tmpPath, snapshotPath);
```

如果希望统一使用 VS Code Uri API，也可以使用：

```ts
const dir = vscode.Uri.file(historyDir);
await vscode.workspace.fs.createDirectory(dir);
await vscode.workspace.fs.writeFile(vscode.Uri.file(snapshotPath), contentBuffer);
```

考虑到需要设置权限、原子 rename、处理本地路径，本方案 MVP 推荐使用 Node `fs/promises`。

## 9. AI agent 内部使用的最低安全边界

本功能不面向普通用户提供复杂隐私 UI，但仍保留最低安全边界：

- 仅保存本地 `file` scheme 文本文件；
- 仅写入 `~/.LLSOAI/History`；
- 不上传快照内容到模型、远端服务或日志；
- OutputChannel 日志只记录路径、hash、状态，不记录文件内容；
- 默认排除依赖目录、构建目录、Git 目录和明显密钥文件；
- 文件大小超过限制时跳过；
- macOS/Linux 尽量使用目录 `0o700`、文件 `0o600`。

默认排除规则采用第 6 节中的内置 `excludeGlobs`。

## 9.1 第二阶段：模型请求工具集成

第二阶段需要把时间线能力暴露给模型请求中的工具调用，让 AI agent 可以在模型对话中主动查询和恢复未提交到 Git 的快照。

### 9.1.1 当前项目关联文件与本次修改范围

当前项目中模型请求和工具调用主要关联以下文件：

| 文件 | 现状职责 | 第二阶段处理方式 |
|---|---|---|
| `src/provider.ts` | 实现 `OpenAPIChatModelProvider`；构建 OpenAI-style requestBody；将 `options.tools` 转成 OpenAI `tools`；收集模型返回的 `tool_calls`；通过 `LanguageModelToolCallPart` 把工具调用回传给 VS Code；处理内置 `ask_llsoai` 和 `manage_todo_list` 特殊逻辑 | **本次第二阶段唯一需要修改的模型请求文件**：注入时间线内置工具定义；识别并执行时间线工具调用；处理内部 continuation；非时间线工具仍按现有逻辑回传 |
| `src/utils/anthropicConverter.ts` | 将 OpenAI-style `tools` 转成 Anthropic `tools`；将 Anthropic tool_use 流转回 OpenAI-style `tool_calls` | 本次不修改。时间线工具保持 OpenAI function tool 格式，复用现有转换逻辑即可 |
| `src/utils/v1ResponseConverter.ts` | 将 Chat Completions tools 转成 Responses API tools；将 Responses function_call 流转回 OpenAI-style tool_calls | 本次不修改。时间线工具保持 OpenAI function tool 格式，复用现有转换逻辑即可 |
| `src/utils/openaiChunk.ts` | 定义 OpenAI streaming chunk 和 `tool_calls` delta 类型 | 本次不修改。现有 `tool_calls` delta 类型已经够用 |
| `src/statusBar.ts` | 统计 `options.tools` token 用量 | 本次不修改。MVP 仍只统计外部 `options.tools`，不统计 provider 内置工具 |
| `src/extension.ts` | 注册 chat provider 和命令 | 第一阶段注册 `TimelineService` 时会修改；第二阶段模型工具接入本身不需要再改转换器文件 |

结论：

> 第二阶段“模型请求中的时间线工具接入”主要改 `src/provider.ts`。`anthropicConverter.ts`、`v1ResponseConverter.ts`、`openaiChunk.ts` 作为通用转发/转换层，本次方案不要求修改，只做回归验证。

第二阶段建议调整 `OpenAPIChatModelProvider` 构造函数：

```ts
constructor(
  private readonly _configManager: ConfigManager,
  statusBarItem: vscode.StatusBarItem,
  private readonly _timelineService?: TimelineService
) {}
```

`src/extension.ts` 中注册顺序：

```ts
const timelineOutput = vscode.window.createOutputChannel('OpenAPI Copilot Timeline');
const timeline = new TimelineService(context, timelineOutput);
context.subscriptions.push(timelineOutput, timeline.register());

const chatProvider = new OpenAPIChatModelProvider(configManager, statusBarItem, timeline);
```

### 9.1.2 provider.ts 当前工具链位置

`src/provider.ts` 中当前关键逻辑：

```ts
const ASK_LLSOAI_TOOL_NAME = 'ask_llsoai';
const TODO_TOOL_NAME = 'manage_todo_list';

const apiTools = expertEnabled
  ? [...(options.tools ?? []), this._buildAskLlsoaiTool()]
  : options.tools;

if (apiTools && apiTools.length > 0) {
  requestBody.tools = apiTools.map((tool: any) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema && Object.keys(tool.inputSchema).length > 0
        ? tool.inputSchema
        : { type: 'object', properties: {} },
    }
  }));
}
```

模型返回工具调用后，当前会：

```ts
progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, finalArgs));
```

第二阶段建议把时间线工具设计为 provider 内部工具：

- 在构建 `requestBody.tools` 前追加时间线工具定义；
- 当模型返回时间线工具调用时，直接在 provider 内部执行；
- 执行结果通过 `LanguageModelToolResultPart` 返回给 VS Code / agent；
- 非时间线工具仍按现有逻辑 `LanguageModelToolCallPart` 交给外部工具系统。

### 9.1.3 第二阶段新增时间线工具

新增三个内置工具：

```ts
const TIMELINE_LIST_TOOL_NAME = 'timeline_list_by_file';
const TIMELINE_RESTORE_TOOL_NAME = 'timeline_restore_snapshot';
const TIMELINE_READ_LINES_TOOL_NAME = 'timeline_read_snapshot_lines';
```

#### 工具 1：通过文件名获取时间线列表

工具名：

```text
timeline_list_by_file
```

用途：根据源文件绝对路径或 workspace 相对路径，读取该文件对应 `metadata.json`，返回时间线快照列表。

输入 schema：

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "filePath": {
      "type": "string",
      "description": "源文件路径。可以是绝对路径，也可以是当前 workspace 下的相对路径。相对路径必须能由扩展内部唯一解析到一个 workspace 文件。"
    },
    "includeCommittedCleaned": {
      "type": "boolean",
      "description": "是否返回 lastGitCleanup 信息。默认 true。"
    }
  },
  "required": ["filePath"]
}
```

返回示例：

```json
{
  "ok": true,
  "filePath": "/Users/lls/project/src/provider.ts",
  "sourceExists": true,
  "metadataExists": true,
  "metadataPath": "~/.LLSOAI/History/Users/lls/project/src/provider.ts/metadata.json",
  "latest": {
    "id": "2026-05-08T10-25-41-456Z.ef567890",
    "sha256": "...",
    "savedAt": "2026-05-08T10:25:41.456Z",
    "lineCount": 320
  },
  "records": [
    {
      "id": "2026-05-08T10-25-41-456Z.ef567890",
      "path": "snapshots/2026-05-08T10-25-41-456Z.ef567890",
      "savedAt": "2026-05-08T10:25:41.456Z",
      "sha256": "...",
      "size": 12345,
      "lineCount": 320,
      "languageId": "typescript"
    }
  ],
  "recordCount": 1,
  "restorable": true,
  "lastGitCleanup": null
}
```

说明：

- `metadataPath` 仅用于调试展示，后续工具不能把它作为可操作入参；
- 后续工具只接受 `filePath + snapshotId`；
- `restorable=false` 表示没有可恢复快照，常见于 `records=[]` 或 Git 提交后已清理。

#### 工具 2：使用 metadata 中的路径恢复未提交快照

工具名：

```text
timeline_restore_snapshot
```

用途：根据 `metadata.records[].path` 指向的 snapshot 恢复源文件。

限制：

- 只能恢复仍未被 Git 提交清理的快照；
- 如果 `metadata.records` 为空或 `latest` 为 `null`，表示快照已被 Git 提交清理，不能恢复；
- 恢复前必须确认目标源文件当前不是 tracked clean 状态；
- 恢复前如果目标文件存在且可作为文本读取，应先创建一次 `reason: "beforeRestore"` 的快照，避免恢复操作本身造成不可逆覆盖；
- 恢复操作写入源文件后会触发 `onDidSaveTextDocument` 或后续保存事件，可能产生新快照。

允许恢复的情况：

1. 文件不在 Git 仓库；
2. 文件在 Git 仓库但 untracked；
3. 文件 tracked 且有未提交修改；
4. 文件不存在，但 metadata 中 `sourcePath` 指向该文件，且其父目录在 workspace 内。

拒绝恢复的情况：

1. 文件 tracked 且工作区 clean，即 Git 已保护当前内容；
2. 文件存在 conflict 状态；
3. `metadata.latest` 为 `null` 或 `records` 为空；
4. snapshot 文件不存在，说明已被 Git 清理或损坏；
5. 目标文件是二进制或超过 restore 限制；
6. 目标路径为 symlink 且 realpath 不在 workspace 内。MVP 可以直接拒绝恢复 symlink 文件。

输入 schema：

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "filePath": {
      "type": "string",
      "description": "源文件路径。可以是绝对路径，也可以是当前 workspace 下的相对路径。"
    },
    "snapshotId": {
      "type": "string",
      "description": "要恢复的快照 id。可来自 timeline_list_by_file 返回的 records[].id。"
    },
    "expectedSha256": {
      "type": "string",
      "description": "可选。调用方期望的快照 sha256；如果与 metadata 中记录不一致则拒绝恢复。"
    }
  },
  "required": ["filePath", "snapshotId"]
}
```

返回示例：

```json
{
  "ok": true,
  "restored": true,
  "filePath": "/Users/lls/project/src/provider.ts",
  "snapshotId": "2026-05-08T10-25-41-456Z.ef567890",
  "sha256": "...",
  "bytesWritten": 12345,
  "lineCount": 320,
  "createdPreRestoreSnapshot": true
}
```

#### 工具 3：读取快照的第 n 行开始的 n+若干行内容

工具名：

```text
timeline_read_snapshot_lines
```

用途：按行读取某个 snapshot 的局部内容，避免一次性把大快照全部塞进上下文。

输入 schema：

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "filePath": {
      "type": "string",
      "description": "源文件路径。可以是绝对路径，也可以是当前 workspace 下的相对路径。"
    },
    "snapshotId": {
      "type": "string",
      "description": "快照 id。可来自 timeline_list_by_file 返回的 records[].id。"
    },
    "startLine": {
      "type": "integer",
      "minimum": 1,
      "description": "起始行号，1-based。"
    },
    "lineCount": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200,
      "description": "要读取的行数，最大 200。"
    }
  },
  "required": ["filePath", "snapshotId", "startLine", "lineCount"]
}
```

返回示例：

```json
{
  "ok": true,
  "filePath": "/Users/lls/project/src/provider.ts",
  "snapshotId": "2026-05-08T10-25-41-456Z.ef567890",
  "startLine": 10,
  "endLine": 30,
  "requestedLineCount": 50,
  "returnedLineCount": 21,
  "totalLines": 320,
  "truncated": false,
  "content": "..."
}
```

说明：

- 如果 `lineCount > 200`，截断为 200 并返回 `truncated=true`；
- 如果 `startLine > totalLines`，返回 `content=""`、`returnedLineCount=0`；
- 工具返回的 `content` 统一使用 `\n` 作为换行；snapshot 恢复仍写回原始内容。

### 9.1.4 工具注入建议

新增工具构建函数：

```ts
private _buildTimelineTools(): any[] {
  return [
    this._buildTimelineListTool(),
    this._buildTimelineRestoreTool(),
    this._buildTimelineReadLinesTool(),
  ];
}
```

构建请求工具时改为：

```ts
const builtInTools = [
  ...this._buildTimelineTools(),
  ...(expertEnabled ? [this._buildAskLlsoaiTool()] : []),
];

const apiTools = [
  ...(options.tools ?? []),
  ...builtInTools,
];
```

注意：

- 需要避免与 `options.tools` 中同名工具冲突；
- 如果冲突，内置时间线工具名应保留，外部同名工具应跳过或加日志；
- Anthropic / Responses API 转换器继续复用现有 `tools` 转换逻辑，本次不修改转换器文件。

工具去重策略：

```ts
private _mergeToolsWithBuiltIns(externalTools: readonly any[], builtIns: any[]): any[] {
  const builtInNames = new Set(builtIns.map(t => t.name));
  const filteredExternal = externalTools.filter(t => !builtInNames.has(t.name));
  return [...filteredExternal, ...builtIns];
}
```

如果外部工具与内置时间线工具重名，跳过外部同名工具并记录日志：

```text
[timeline] skipped external tool with reserved built-in name: timeline_list_by_file
```

状态栏 token 统计 MVP 保持现状，只统计 `options.tools` 中的外部工具，不统计 provider 内置的 `ask_llsoai` 和时间线工具，避免状态栏显示突变。

### 9.1.5 工具调用处理建议

在处理 `result.toolCalls` 时，新增时间线工具分支：

```ts
if (this._isTimelineTool(toolCall.name)) {
  const resultText = await this._executeTimelineTool(toolCall.name, toolCall.input);
  progress.report(new vscode.LanguageModelToolResultPart(toolCall.id, [
    new vscode.LanguageModelTextPart(resultText)
  ]));
  continue;
}
```

这样时间线工具由 provider 内部执行，不需要外部 VS Code tool provider 参与。

但仅上报 `LanguageModelToolResultPart` 不足以保证模型继续基于工具结果生成回答。第二阶段推荐实现 provider 内部二次请求循环：provider 将 assistant tool_call 消息和 tool result 消息追加到 requestBody.messages 后再次请求模型，直到模型返回普通文本或达到最大轮数。

内部循环伪代码：

```ts
const MAX_TIMELINE_TOOL_ROUNDS = 3;
let messagesForRequest = requestBody.messages;

for (let round = 0; round <= MAX_TIMELINE_TOOL_ROUNDS; round++) {
  const result = await this._requestModel({
    ...mainContext,
    requestBody: {
      ...requestBody,
      messages: messagesForRequest,
      tools: requestBody.tools
    },
    requestLabel: round === 0 ? 'main' : `main-timeline-continuation-${round}`,
    progress,
    token,
    reportText: true
  });

  const timelineCalls = result.toolCalls.filter(tc => this._isTimelineTool(tc.name));
  const externalCalls = result.toolCalls.filter(tc => !this._isTimelineTool(tc.name));

  if (timelineCalls.length === 0) {
    // 外部工具仍按现有逻辑 report ToolCallPart。
    this._reportExternalToolCalls(externalCalls, progress);
    break;
  }

  messagesForRequest.push({
    role: 'assistant',
    content: result.text || null,
    tool_calls: timelineCalls.map(call => this._toOpenAIToolCall(call))
  });

  for (const call of timelineCalls) {
    const resultText = await this._executeTimelineToolAsJson(call.name, call.input);
    messagesForRequest.push({
      role: 'tool',
      tool_call_id: call.id,
      content: resultText
    });

    progress.report(new vscode.LanguageModelToolResultPart(call.id, [
      new vscode.LanguageModelTextPart(resultText)
    ]));
  }
}
```

要求：

- 最大内部轮数固定为 3；
- 超过轮数时返回 `TOO_MANY_INTERNAL_TOOL_ROUNDS` 错误 JSON；
- 内部工具失败时，把错误 JSON 作为 tool result 反馈给模型，不直接 throw 中断整个请求；
- 如果同一轮同时出现时间线工具和外部工具，优先处理时间线工具并进行 continuation，外部工具等待下一轮模型重新决定。

### 9.1.6 TimelineService 需要新增的方法

```ts
export class TimelineService {
  listSnapshotsByFile(filePath: string): Promise<TimelineListResult>;
  restoreSnapshotById(filePath: string, snapshotId: string): Promise<TimelineRestoreResult>;
  readSnapshotLines(filePath: string, snapshotId: string, startLine: number, lineCount: number): Promise<TimelineReadLinesResult>;
}
```

内部实现要点：

- `filePath` 需要先解析为绝对路径；
- 工具入口的 `filePath` 解析后必须满足：位于当前 VS Code workspace folder 内，或已有 metadata 且 metadata.canonicalPath 与解析后的 canonical path 完全一致；
- 相对路径由扩展内部基于 `vscode.workspace.workspaceFolders` 自动解析；如果无法唯一解析，工具返回 `FILE_NOT_IN_WORKSPACE`，提示 agent 改用绝对路径；
- `snapshotId` 只能从 `metadata.records[].id` 中匹配，不能直接信任用户传入路径；
- `snapshotId` 不能被当作路径使用，必须先通过正则校验，再从 metadata.records 精确匹配；
- 读取 snapshot 时使用 `metadata.records[].path` 拼接 historyDir；
- 校验最终 snapshot path 必须位于该文件 historyDir 内；
- read/restore 执行时必须重新读取 metadata 并检查 snapshot 文件仍存在，防止 list 后 Git watcher 清理导致 stale 结果；
- `readSnapshotLines` 使用 1-based 行号，返回 `totalLines`；
- `lineCount` 应设置最大上限，例如 200 行，避免大段内容进入上下文；
- `restoreSnapshotById` 只允许恢复 metadata 中仍存在的记录；如果记录已因 Git 提交清理，则返回不可恢复。

推荐 `snapshotId` 正则：

```ts
/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.[a-f0-9]{8,16}$/
```

工具错误统一返回紧凑 JSON：

```json
{
  "ok": false,
  "error": {
    "code": "SNAPSHOT_NOT_FOUND",
    "message": "Snapshot does not exist or has been cleaned by Git.",
    "retryable": false
  }
}
```

推荐错误码：

- `INVALID_ARGUMENT`
- `PATH_NOT_ALLOWED`
- `FILE_NOT_IN_WORKSPACE`
- `METADATA_NOT_FOUND`
- `SNAPSHOT_NOT_FOUND`
- `SNAPSHOT_CLEANED_BY_GIT`
- `GIT_PROTECTED_CLEAN_FILE`
- `RANGE_OUT_OF_BOUNDS`
- `TOO_MANY_LINES`
- `TOO_MANY_INTERNAL_TOOL_ROUNDS`
- `INTERNAL_ERROR`

### 9.1.7 第二阶段请求循环注意事项

当前 `provider.ts` 在收到工具调用后会把 `LanguageModelToolCallPart` 回传给 VS Code。对于 provider 内部执行的时间线工具，需要确认 VS Code 是否会自动把 `LanguageModelToolResultPart` 注入下一轮模型请求。

MVP 建议：

- provider 内部执行时间线工具，并实现最多 3 轮内部 continuation；
- `LanguageModelToolResultPart` 仅作为进度/可视化上报，不依赖 VS Code 自动 continuation；
- 时间线工具结果必须是紧凑 JSON 字符串，不返回超大内容；
- Anthropic / Responses API 转换器本次不修改，但需要回归测试时间线工具 schema 经过现有转换逻辑后是否仍能正常工作。

## 10. 性能与可靠性

- 使用 SHA-256 内容 hash 去重；
- metadata records 记录每个 snapshot 的 `lineCount`；
- 单文件大小限制默认 2MB；
- 每个文件最多保留 20 个快照；
- 写入 snapshot 原始内容和 `metadata.json` 使用临时文件 + rename 原子替换；
- Git 检查使用超时，例如 2-3 秒；
- Git HEAD 监听事件需要 debounce，避免一次提交触发多次清理；
- 提交后清理按变动文件列表逐个处理，并使用 `isPathSafeToCleanAfterCommit` 二次确认；
- 对同一文件的保存事件做串行化，避免并发写入；
- AI agent 可能连续批量修改文件，因此保存处理必须异步、快速失败，不阻塞 VS Code 保存流程；
- 失败不影响用户正常保存；
- 错误写入扩展 OutputChannel，但不输出文件内容。
- 第二阶段工具读取快照时必须限制最大返回行数，避免把大文件一次性放入模型上下文。
- 第二阶段 provider 内部时间线工具 continuation 最多 3 轮，避免工具循环。

## 11. 实现步骤建议

1. 新增 `src/timeline/types.ts` 定义数据结构；
2. 新增 `src/timeline/pathMapper.ts`，实现绝对路径到 `~/.LLSOAI/History/...` 的映射；
3. 新增 `src/timeline/storage.ts`，实现原始内容 snapshot 保存、metadata 记录列表维护、hash 去重、清理 snapshots 并保留 metadata、按文件裁剪旧快照；
4. 新增 `src/timeline/git.ts`，实现 Git repo/tracked/HEAD/status 判定；
5. 新增 `src/timeline/repoWatcher.ts`，监听 Git HEAD/ref 变化并获取提交变动文件列表；
6. 新增 `src/timeline/service.ts`，监听 `onDidSaveTextDocument`，并注册 repository watcher；
7. 在 `src/extension.ts` 激活时注册 `TimelineService`；
8. 可选新增调试命令：查看当前文件历史、恢复 latest、清理当前文件历史；
9. 第二阶段在 `provider.ts` 中注入时间线内置工具：列表、恢复、按行读取；
10. 第二阶段在 `TimelineService` 中实现工具调用所需 API；
11. 编写路径映射、存储、Git 判定、提交后清理测试；
12. 编写保存事件、Git HEAD watcher 和时间线工具集成测试。

## 12. 测试计划

### 12.1 路径映射测试

- macOS/Linux 绝对路径；
- Windows 盘符路径，确认 `:` 替换为 `~~~~~`；
- 含空格、中文、特殊字符路径；
- 防止 `..` 路径穿越；
- 最终 history path 必须位于 storageRoot 内。

### 12.2 存储测试

- 首次保存创建目录；
- 重复保存相同内容不生成重复 snapshot；
- 内容变化生成新 snapshot；
- `metadata.json` 中 latest 正确更新；
- `metadata.json` 中 records 正确追加和裁剪；
- `metadata.json` 中 records[].lineCount 正确记录快照总行数；
- snapshot 原始内容正确写入；
- metadata 原子写入；
- `cleanSnapshots` 删除所有 snapshots，并保留/更新 `metadata.json`；
- `pruneOldSnapshots` 保留最近 N 个快照。

### 12.3 Git 测试

- 文件不在 Git 仓库：不清理；
- 仓库没有 HEAD：不清理；
- 文件在仓库但未跟踪：不清理；
- 文件已跟踪且有修改：不清理；
- 文件已跟踪且 clean：清理 snapshots 并保留/更新 `metadata.json`；
- Git 命令超时或不可用：不清理，只记录日志。
- HEAD 变化后能获取 changed files；
- 提交后对 changed files 删除 snapshots 并更新 metadata；
- merge commit 变动文件去重；
- rebase/reset/checkout 导致 HEAD 变化时必须二次确认 clean 后才清理；
- 扩展重启后根据上次 repo HEAD 做补偿清理。

### 12.4 VS Code 集成测试

- 保存文本文件生成备份；
- 非 `file` scheme 跳过；
- 排除规则生效；
- 超大文件跳过；
- 二进制或非 UTF-8 文件跳过；
- 同一文件连续保存不会并发破坏索引；
- Git 提交后对应文件目录保留 metadata，并删除 snapshots；
- Git 提交来自终端或 VS Code Git 面板时都能通过 HEAD/ref 变化触发清理；
- 扩展停用时释放监听器。

### 12.5 第二阶段工具测试

- `timeline_list_by_file` 能通过绝对路径返回 metadata records；
- `timeline_list_by_file` 能通过 workspace 相对路径解析到正确文件；
- `timeline_restore_snapshot` 只能恢复 metadata 中存在且未被 Git 清理的 snapshot；
- `timeline_restore_snapshot` 拒绝路径穿越或伪造 snapshotId；
- `timeline_restore_snapshot` 拒绝 tracked clean 文件，并在恢复前创建 `beforeRestore` 快照；
- `timeline_read_snapshot_lines` 按 1-based 行号读取正确范围；
- `timeline_read_snapshot_lines` 返回 `totalLines`，并遵守最大返回行数限制；
- `timeline_read_snapshot_lines` 在 `startLine > totalLines` 时返回空内容；
- 时间线工具通过 OpenAI、Anthropic、Responses API 三种请求转换路径时工具 schema 仍正确，且不需要修改转换器文件；
- provider 内部执行时间线工具后能返回 `LanguageModelToolResultPart` 并进行内部二次请求；
- 时间线工具和现有 `ask_llsoai`、`manage_todo_list` 不发生名称冲突。
- 时间线工具拒绝 workspace 外路径，除非 metadata.canonicalPath 精确匹配；
- 工具错误统一返回 `{ ok:false, error:{ code,message,retryable } }` JSON。

## 13. MVP 已决策事项

1. 第一版主要供 AI agent 内部使用；
2. 第一版不接入 VS Code Timeline Provider；
3. 第一版不实现 TreeView / Webview；
4. 第一版 snapshot 直接保存原始文本内容，不使用 JSON；
5. 第一版仅监听 `onDidSaveTextDocument`；
6. 第一版不备份 dirty documents；
7. Git committed 后默认删除该文件所有 snapshots，并保留/新增 `metadata.json`；
8. Git 提交完成后监听 HEAD/ref 变化，获取变动文件列表，逐个清理对应 snapshots；
9. 提交清理后保留或新增 `metadata.json`，并记录 `lastGitCleanup`；
10. 保留最小默认排除规则、单文件大小限制和每文件快照数限制；
11. 不实现复杂全局配额、保留天数和后台全局清理；
12. 不使用 VS Code 系统设置，默认启用；
13. 修改记录列表保存在 `metadata.json` 中；
14. `metadata.records[]` 记录每个快照总行数 `lineCount`；
15. 第二阶段给模型请求增加时间线内置工具：按文件获取列表、恢复快照、按行读取快照；
16. 可选保留少量调试命令，核心能力通过内部服务 API 给 agent 使用。

## 14. 与专家复核后的结论

用户明确说明：第 2、6、7、8 类建议不需要，因为该时间线主要给 AI agent 使用。与专家复核后，最终结论如下：

| 项目 | 最终取舍 | MVP 处理 |
|---|---:|---|
| VS Code Timeline Provider | 不做 | agent 内部服务即可 |
| 完整 QuickPick/UI | 弱化 | 仅保留可选调试命令 |
| JSON snapshot | 不做 | 快照文件直接保存原始内容 |
| VS Code 系统设置 | 不做 | 默认启用，使用内置策略 |
| 隐私确认 UI | 不做 | 保留最低本地安全边界 |
| 全局配额/保留天数 | 不做 | 只保留文件大小和每文件快照数 |
| Git committed 清理 | 保留 | 保存后判定，committed 后清理 snapshots 并更新 metadata |
| Git 提交后清理 | 保留 | 监听 HEAD/ref 变化，按 changed files 清理 snapshots 并更新 metadata |
| 路径安全 | 保留最低要求 | 防路径逃逸、Windows `:` 替换、限制在 storageRoot 内 |
| hash 去重 | 保留 | 防重复保存 |
| 原子写入 | 保留 | 防 snapshot / metadata 损坏 |
| metadata lineCount | 保留 | 便于 agent 按行读取快照 |
| 第二阶段工具 | 保留 | provider 内置 `timeline_list_by_file` / `timeline_restore_snapshot` / `timeline_read_snapshot_lines` |

最终推荐 MVP：

```text
onDidSaveTextDocument
+ 原始内容 snapshot
+ metadata 记录列表
+ hash 去重
+ Git committed 后清理 snapshots 并保留 metadata
+ Git 提交后按变动文件清理 snapshots 并保留 metadata
+ metadata 记录 snapshot 总行数
+ 第二阶段模型请求注入时间线工具
+ 最小排除规则
+ 单文件大小限制
+ 每文件快照数限制
+ 可选调试命令
```
