# 提示词优化功能设置与实施方案

## 0. 当前全局与项目专家模式参考

本方案仅规划“提示词优化”（Prompt Enhancement / Prompt Optimizer）功能的第一阶段设置，不接入聊天转发链路，不改变当前模型请求行为。

实现方式需要完全参考当前已有的“全局 + 项目”专家模式与方案提供商设置方式，保持：

- 相同的配置分层方式。
- 相同的全局/项目合并规则。
- 相同的 provider/model 选择体验。
- 相同的多语言翻译覆盖策略。
- 相同的设置页保存、回显、项目覆盖逻辑。

当前项目里可参考的实现包括：

- `package.json`
  - `openapicopilot.expertMode.*`
  - `openapicopilot.solutionProvider.*`
- `src/types.ts`
  - `ExpertModeConfig`
  - `WorkspaceExpertModeConfig`
  - `SolutionProviderConfig`
  - `WorkspaceSolutionProviderConfig`
- `src/configManager.ts`
  - `getExpertModeConfig()`
  - `getWorkspaceExpertModeConfig()`
  - `getEffectiveExpertModeConfig()`
  - `getSolutionProviderConfig()`
  - `getWorkspaceSolutionProviderConfig()`
  - `getEffectiveSolutionProviderConfig()`
- `src/views/configView.ts`
  - 全局设置卡片。
  - 项目设置卡片。
  - `_collectSettings()`。
  - `saveGlobalSettings`。
  - `saveProjectSettings`。
  - `getSolutionProviderSettings` / `updateSolutionProviderSettings`。
- `assets/configView/configView.js`
  - 全语言 `translations`。
  - provider/model 下拉联动。
  - 全局设置保存。
  - 项目设置保存。
- `assets/configView/configView.css`
  - 复用已有设置卡片样式。

---

## 1. 功能定位

提示词优化功能用于让用户通过独立入口手动输入原始提示词，再使用一个可配置的优化模型对原始提示词进行改写、补全、结构化和约束增强。

第一阶段只实现设置能力，目标是让用户可以配置：

- 是否启用提示词优化。
- 使用哪个 provider 作为提示词优化提供商。
- 使用哪个 model 作为提示词优化模型。
- 当前项目是否跟随全局、强制启用或强制禁用。
- 当前项目是否覆盖全局提示词优化 provider/model。
- 是否在 VS Code 状态栏显示提示词优化入口。
- 状态栏入口点击后弹窗输入提示词，并使用配置的特定模型优化提示词。

第一阶段不实现：

- 不拦截 Copilot Chat 输入框。
- 不读取 Copilot Chat 输入框草稿。
- 不修改 Copilot Chat 原生输入框内容。
- 不接入 `LanguageModelChatProvider` 转发链路。
- 不实现 `/enhance` 触发。
- 不实现自定义 Chat Webview。
- 不在聊天转发链路中实现真实提示词优化请求。
- 第一阶段状态栏入口触发的是独立手动优化流程，需要使用配置的特定模型执行提示词优化，但不影响 Copilot Chat 或 `LanguageModelChatProvider` 的请求转发链路。

---

## 2. 建议命名

用户可见名称：

- 简体中文：提示词优化
- 繁體中文：提示詞最佳化
- English：Prompt Enhancement

内部命名建议：

- 配置前缀：`openapicopilot.promptEnhancement.*`
- 类型：
  - `PromptEnhancementConfig`
  - `WorkspacePromptEnhancementConfig`
- 启用状态类型：
  - `WorkspacePromptEnhancementEnabledState`
- 触发模式类型：
  - 第一阶段不需要触发模式类型。
- UI 变量前缀：
  - `promptEnhancementSettings`
  - `projectPromptEnhancementSettings`
  - `effectivePromptEnhancementSettings`

---

## 3. 第一阶段目标

第一阶段只做设置闭环：

1. 在 VS Code Settings 中注册 `openapicopilot.promptEnhancement.*` 配置项。
2. 在 `src/types.ts` 中增加提示词优化配置类型。
3. 在 `src/configManager.ts` 中增加全局、项目、生效配置读取与更新方法。
4. 在全局设置 UI 中增加“提示词优化”卡片。
5. 在项目设置 UI 中增加“提示词优化”卡片。
6. provider/model 下拉框完全复用专家模式筛选规则。
7. 在 VS Code 状态栏增加文字入口，点击后打开提示词优化菜单。
8. 状态栏菜单支持弹窗输入提示词，并预留调用特定模型优化提示词的流程。
9. UI 文案覆盖当前已有语言：
   - English
   - 简体中文
   - 繁體中文
   - 한국어
   - 日本語
   - Français
   - Deutsch
10. 设置保存后能正确回显。
11. 项目设置能正确覆盖全局启用状态和 provider/model。
12. 第一阶段不改变任何聊天转发行为。

---

## 4. 配置项设计

在 `package.json` 的 `contributes.configuration.properties` 增加以下配置项。

### 4.1 全局启用开关

```json
"openapicopilot.promptEnhancement.enabled": {
  "type": "boolean",
  "default": false,
  "description": "Enable prompt enhancement. When enabled, users can manually optimize prompts from the status bar using the selected enhancement model.",
  "scope": "application"
}
```

说明：

- 与 `openapicopilot.expertMode.enabled` 一致，作为全局开关。
- 使用 `application` scope。
- 默认关闭，避免改变用户现有行为。

### 4.2 项目启用状态

```json
"openapicopilot.promptEnhancement.enabledState": {
  "type": "string",
  "enum": ["global", "enabled", "disabled"],
  "default": "global",
  "description": "Workspace prompt enhancement enabled state. Use global, force enabled, or force disabled for this workspace.",
  "scope": "resource"
}
```

说明：

- 完全参考专家模式项目启用状态。
- `global`：跟随全局。
- `enabled`：当前项目强制开启。
- `disabled`：当前项目强制关闭。

### 4.3 全局/项目 Provider

```json
"openapicopilot.promptEnhancement.providerId": {
  "type": "string",
  "default": "",
  "description": "Provider ID used by prompt enhancement.",
  "scope": "machine-overridable"
}
```

说明：

- 与专家模式、方案提供商保持一致使用 `machine-overridable` scope。
- 全局设置写入 global target。
- 项目设置写入 workspace target。
- 项目 provider/model 两者都非空时覆盖全局。

### 4.4 全局/项目 Model

```json
"openapicopilot.promptEnhancement.modelId": {
  "type": "string",
  "default": "",
  "description": "Model ID used by prompt enhancement.",
  "scope": "machine-overridable"
}
```

### 4.5 状态栏入口开关

```json
"openapicopilot.promptEnhancement.statusBar.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Show the prompt enhancement entry in the VS Code status bar.",
  "scope": "application"
}
```

说明：

- 状态栏入口使用文字展示，并跟随配置页语言。
- 默认显示，降低用户发现成本。
- 如果用户不需要状态栏入口，可以在全局设置中关闭。

### 4.6 尝试填入 Chat 草稿开关

```json
"openapicopilot.promptEnhancement.insertIntoChatDraft": {
  "type": "boolean",
  "default": true,
  "description": "Try to insert the enhanced prompt into the VS Code Chat input as an unsent draft. This uses a best-effort VS Code built-in command and may not work in all versions.",
  "scope": "application"
}
```

说明：

- 该配置控制优化完成后是否尝试把结果填入 Chat 输入框草稿。
- 底层使用 `workbench.action.chat.open` 的 `{ query, isPartialQuery: true }` 参数，属于 best-effort 增强体验。
- 如果关闭，或填入失败，则直接复制到剪贴板。
- 该配置只影响状态栏手动优化结果的处理方式，不接入聊天转发链路。

---

## 5. 类型设计

在 `src/types.ts` 新增：

```ts
export interface PromptEnhancementConfig {
  enabled: boolean;
  providerId: string;
  modelId: string;
  statusBarEnabled: boolean;
  insertIntoChatDraft: boolean;
}

export type WorkspacePromptEnhancementEnabledState = 'global' | 'enabled' | 'disabled';

export interface WorkspacePromptEnhancementConfig extends PromptEnhancementConfig {
  enabledState: WorkspacePromptEnhancementEnabledState;
}
```

说明：

- `PromptEnhancementConfig` 表示全局配置或生效配置。
- `WorkspacePromptEnhancementConfig` 表示项目配置。
- 项目配置在基础配置上增加 `enabledState`。
- 第一阶段不增加运行状态类型，因为不接入转发链路。
- 第一阶段不增加 `mode`、`triggerPrefix`、`autoMinLength`、`showEnhancedPrompt`，避免产生“设置后已经会影响聊天转发”的误解。

---

## 6. ConfigManager 设计

在 `src/configManager.ts` 中参考专家模式新增常量。

### 6.1 配置 Key 常量

```ts
private static readonly PROMPT_ENHANCEMENT_CONFIG_KEY = 'openapicopilot.promptEnhancementConfig';
private static readonly PROMPT_ENHANCEMENT_ENABLED_CONFIG_KEY = 'promptEnhancement.enabled';
private static readonly PROMPT_ENHANCEMENT_PROVIDER_CONFIG_KEY = 'promptEnhancement.providerId';
private static readonly PROMPT_ENHANCEMENT_MODEL_CONFIG_KEY = 'promptEnhancement.modelId';
private static readonly PROMPT_ENHANCEMENT_STATUS_BAR_ENABLED_CONFIG_KEY = 'promptEnhancement.statusBar.enabled';
private static readonly PROMPT_ENHANCEMENT_INSERT_INTO_CHAT_DRAFT_CONFIG_KEY = 'promptEnhancement.insertIntoChatDraft';
private static readonly WORKSPACE_PROMPT_ENHANCEMENT_ENABLED_STATE_CONFIG_KEY = 'promptEnhancement.enabledState';
```

### 6.2 新增方法

```ts
getPromptEnhancementConfig(): PromptEnhancementConfig
getWorkspacePromptEnhancementConfig(): WorkspacePromptEnhancementConfig
getEffectivePromptEnhancementConfig(): PromptEnhancementConfig
updatePromptEnhancementConfig(settings: Partial<PromptEnhancementConfig>): Promise<PromptEnhancementConfig>
updateWorkspacePromptEnhancementConfig(settings: Partial<WorkspacePromptEnhancementConfig>): Promise<WorkspacePromptEnhancementConfig>
```

### 6.3 默认值

```ts
const defaultPromptEnhancementConfig: PromptEnhancementConfig = {
  enabled: false,
  providerId: '',
  modelId: '',
  statusBarEnabled: true,
  insertIntoChatDraft: true,
};
```

### 6.4 生效配置合并规则

合并规则完全参考专家模式。

```text
全局配置：
  enabled + providerId + modelId + statusBarEnabled + insertIntoChatDraft

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

  statusBarEnabled:
    使用全局配置。状态栏属于 VS Code 窗口级入口，不做项目级覆盖。

  insertIntoChatDraft:
    使用全局配置。该项属于全局交互偏好，不做项目级覆盖。
```

### 6.5 项目覆盖范围

为了完全符合“全局和项目专家模式”的理解成本，第一阶段项目设置只支持：

- `enabledState` 使用三态。
- `providerId/modelId` 两者都非空才覆盖。
- `statusBarEnabled` 仅作为全局设置，不在项目设置中覆盖。
- `insertIntoChatDraft` 仅作为全局设置，不在项目设置中覆盖。

第一阶段不提供项目级触发模式、前缀、自动增强和发送前确认设置，避免项目保存后意外固化全局行为配置。

如果后续阶段需要增加更多行为型项目覆盖，再单独设计三态或覆盖状态，例如：

```ts
promptEnhancement.modeState: 'global' | 'override'
promptEnhancement.showEnhancedPromptState: 'global' | 'enabled' | 'disabled'
```

---

## 7. UI 设计

### 7.1 全局设置卡片

在全局设置页的 Expert Mode / Solution Provider 附近增加 Prompt Enhancement 卡片。

建议排序：

```text
Expert Mode
Solution Provider
Prompt Enhancement
Enhanced TODO
```

卡片内容：

1. 标题：提示词优化 / Prompt Enhancement
2. 复选框：启用提示词优化
3. 帮助文本：启用后，可通过状态栏入口手动输入提示词，并使用所选优化模型生成优化后的提示词。
4. 下拉框：提示词优化提供商
5. 下拉框：提示词优化模型
6. 复选框：在状态栏显示提示词优化入口
7. 复选框：优化后尝试填入 Chat 草稿
8. 帮助文本：状态栏入口使用文字展示，点击后可输入提示词并调用所选模型优化；优化完成后可尝试填入 Chat 输入框草稿，失败时复制到剪贴板。

### 7.2 项目设置卡片

在项目设置页增加 Prompt Enhancement 卡片，完全参考专家模式项目设置。

卡片内容：

1. 标题：提示词优化 / Prompt Enhancement
2. 描述：配置当前项目如何使用提示词优化模型。
3. 启用状态单选：
   - 使用全局
   - 当前项目强制开启
   - 当前项目强制关闭
4. 提供商覆盖下拉框：项目提示词优化提供商
5. 模型覆盖下拉框：项目提示词优化模型
6. 帮助文本：同时选择 provider 和 model 才会覆盖全局提示词优化模型；任一为空则继续使用全局模型。

项目设置不提供状态栏开关。状态栏是窗口级入口，保持全局控制。

项目设置不提供触发模式和发送前确认设置。第一阶段提示词优化通过状态栏入口显式触发，不接入聊天转发链路。

### 7.3 provider/model 下拉规则

完全复用专家模式的 provider/model 选择逻辑：

- 只显示已启用 provider。
- 只显示 `isUserSelectable === true` 的模型。
- provider 变化时清空 model。
- model 下拉只显示当前 provider 的可选模型。
- 项目 provider/model 任一为空则使用全局模型。

建议将当前函数：

```ts
getExpertSelectableProviders()
```

逐步改名或抽象为：

```ts
getModelSelectableProviders()
```

第一阶段也可以继续复用原函数，降低改动风险。

---

## 8. Config View 前端改造

### 8.1 顶部状态变量

在 `assets/configView/configView.js` 增加：

```js
let promptEnhancementSettings = {
  enabled: false,
  providerId: '',
  modelId: '',
  statusBarEnabled: true,
  insertIntoChatDraft: true
};

let projectPromptEnhancementSettings = {
  enabled: false,
  enabledState: 'global',
  providerId: '',
  modelId: ''
};

let effectivePromptEnhancementSettings = {
  enabled: false,
  providerId: '',
  modelId: '',
  statusBarEnabled: true,
  insertIntoChatDraft: true
};

let promptEnhancementSelectableProviders = [];
```

### 8.2 Webview 消息

新增消息：

- `getPromptEnhancementSettings`
- `updatePromptEnhancementSettings`
- `promptEnhancementSettingsLoaded`

在扩展侧 `src/views/configView.ts` 的 `_handleMessage()` 中增加：

```ts
case 'getPromptEnhancementSettings':
  // 返回 settings/globalSettings/workspaceSettings/providers
  break;

case 'updatePromptEnhancementSettings':
  // 更新全局提示词优化配置
  break;
```

### 8.3 保存全局设置

扩展 `saveGlobalSettings` payload：

```ts
promptEnhancementEnabled
promptEnhancementProviderId
promptEnhancementModelId
promptEnhancementStatusBarEnabled
promptEnhancementInsertIntoChatDraft
```

在 `src/views/configView.ts` 的 `saveGlobalSettings` 处理中调用：

```ts
await this._configManager.updatePromptEnhancementConfig({
  enabled: message.promptEnhancementEnabled,
  providerId: message.promptEnhancementProviderId,
  modelId: message.promptEnhancementModelId,
  statusBarEnabled: message.promptEnhancementStatusBarEnabled,
  insertIntoChatDraft: message.promptEnhancementInsertIntoChatDraft,
});
```

### 8.4 保存项目设置

扩展 `saveProjectSettings` payload：

```ts
promptEnhancementEnabledState
promptEnhancementProviderId
promptEnhancementModelId
```

在 `saveProjectSettings` 中调用：

```ts
await this._configManager.updateWorkspacePromptEnhancementConfig({
  enabledState: message.promptEnhancementEnabledState,
  providerId: message.promptEnhancementProviderId,
  modelId: message.promptEnhancementModelId,
});
```

### 8.5 `_collectSettings()` 增加字段

```ts
const promptEnhancementSettings = this._configManager.getPromptEnhancementConfig();
const projectPromptEnhancementSettings = this._configManager.getWorkspacePromptEnhancementConfig();
const effectivePromptEnhancementSettings = this._configManager.getEffectivePromptEnhancementConfig();

return {
  ...,
  promptEnhancementSettings,
  projectPromptEnhancementSettings,
  effectivePromptEnhancementSettings,
};
```

---

## 9. 状态栏提示词优化入口设计

第一阶段新增 VS Code 状态栏入口，入口使用纯文字而不是图标，文字必须跟随扩展中的语言设置显示。

可以做到。状态栏运行在 Extension Host 侧，不能直接依赖 Webview 里的 `translations` 对象，但可以复用 `ConfigManager.getResolvedLanguage()` 的解析结果，在扩展侧维护同一套状态栏/命令/i18n 文案。

### 9.1 状态栏文案

状态栏建议显示：

```text
Prompt Enhancement
```

不同语言显示：

- English：`Prompt Enhancement`
- 简体中文：`提示词优化`
- 繁體中文：`提示詞最佳化`
- 한국어：`프롬프트 향상`
- 日本語：`プロンプト強化`
- Français：`Amélioration des prompts`
- Deutsch：`Prompt-Verbesserung`

不使用 `$(sparkle)` 等图标，避免与用户要求“状态栏直接使用文字”冲突。

### 9.2 与扩展语言设置联动

状态栏文字需要和扩展配置中的语言设置保持一致。

当前项目已有语言配置能力：

- `ConfigManager.getConfiguredLanguage()`：读取扩展语言设置。
- `ConfigManager.getResolvedLanguage()`：解析最终语言。
- 当语言设置为 `auto` 时，跟随 `vscode.env.language`。
- 支持语言：`en`、`zh-cn`、`zh-tw`、`ko`、`ja`、`fr`、`de`。

状态栏不应从 Webview 前端读取语言，而应在 Extension Host 中使用：

```ts
const language = configManager.getResolvedLanguage();
statusBarItem.text = getPromptEnhancementStatusBarText(language);
statusBarItem.tooltip = getPromptEnhancementMessage(language, 'promptEnhancementStatusBarHelp');
```

建议新增扩展侧提示词优化 i18n 映射：

```ts
const PROMPT_ENHANCEMENT_MESSAGES = {
  en: {
    statusBarText: 'Prompt Enhancement',
    openMenu: 'Prompt Enhancement',
    optimizeFromInput: 'Optimize Prompt from Input',
  },
  'zh-cn': {
    statusBarText: '提示词优化',
    openMenu: '提示词优化',
    optimizeFromInput: '从输入内容优化提示词',
  },
  'zh-tw': {
    statusBarText: '提示詞最佳化',
    openMenu: '提示詞最佳化',
    optimizeFromInput: '從輸入內容最佳化提示詞',
  },
  ko: {
    statusBarText: '프롬프트 향상',
    openMenu: '프롬프트 향상',
    optimizeFromInput: '입력에서 프롬프트 향상',
  },
  ja: {
    statusBarText: 'プロンプト強化',
    openMenu: 'プロンプト強化',
    optimizeFromInput: '入力からプロンプトを強化',
  },
  fr: {
    statusBarText: 'Amélioration des prompts',
    openMenu: 'Amélioration des prompts',
    optimizeFromInput: 'Optimiser le prompt depuis une saisie',
  },
  de: {
    statusBarText: 'Prompt-Verbesserung',
    openMenu: 'Prompt-Verbesserung',
    optimizeFromInput: 'Prompt aus Eingabe optimieren',
  },
};
```

后续如果希望避免 Webview 与 Extension Host 各维护一套翻译，可以把通用翻译抽到共享 TS 文件中，再由 Webview 注入 JSON。第一阶段可以先在扩展侧单独维护状态栏、QuickPick、InputBox 和提示消息所需的最小翻译集合。

### 9.3 状态栏刷新时机

状态栏文字需要在以下场景刷新：

1. 扩展激活时创建状态栏入口。
2. 用户修改扩展语言设置后。
3. 用户修改 `promptEnhancement.statusBar.enabled` 后。
4. 用户修改提示词优化启用状态或项目 `enabledState` 后。
5. 工作区切换导致生效配置变化时。

建议监听 VS Code 配置变化：

```ts
vscode.workspace.onDidChangeConfiguration(event => {
  if (
    event.affectsConfiguration('openapicopilot.language') ||
    event.affectsConfiguration('openapicopilot.promptEnhancement')
  ) {
    promptEnhancementStatusBar.refresh();
  }
});
```

刷新逻辑：

```ts
function refreshPromptEnhancementStatusBar() {
  const config = configManager.getEffectivePromptEnhancementConfig();
  const language = configManager.getResolvedLanguage();

  statusBarItem.text = getPromptEnhancementMessage(language, 'statusBarText');
  statusBarItem.tooltip = getPromptEnhancementMessage(language, 'statusBarTooltip');
  statusBarItem.command = 'openapicopilot.promptEnhancement.openMenu';

  if (config.statusBarEnabled) {
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}
```

### 9.4 状态栏显示规则

状态栏入口显示条件：

```text
global promptEnhancement.statusBar.enabled === true
```

建议行为：

- 如果 `statusBarEnabled=false`，隐藏状态栏入口。
- 如果提示词优化 `enabled=false`，状态栏仍可显示，但点击后提示用户先启用或打开设置。
- 如果提示词优化 `enabled=true` 但未配置 provider/model，点击后提示用户配置优化模型。
- 如果生效配置中 provider/model 可用，则允许进入优化流程。

需要区分两个判断：

```text
是否显示状态栏入口：只看全局 statusBarEnabled。
是否允许执行优化：读取 getEffectivePromptEnhancementConfig() 的 enabled/providerId/modelId。
```

因此如果全局 `enabled=false`，但当前项目 `enabledState=enabled`，状态栏点击后应允许优化；如果全局 `enabled=true`，但当前项目 `enabledState=disabled`，状态栏点击后应提示当前项目已禁用。

### 9.5 状态栏点击菜单

点击状态栏文字后显示 QuickPick 菜单：

```text
Optimize Prompt from Input
Open Prompt Enhancement Settings
```

后续可扩展：

```text
Optimize Selected Text
Optimize Clipboard Text
```

第一阶段用户明确要求的是“点击弹窗输入提示词”，因此核心入口只需要实现或规划：

```text
Optimize Prompt from Input
```

### 9.6 命令注册设计

建议新增命令：

```json
{
  "command": "openapicopilot.promptEnhancement.openMenu",
  "title": "Open Prompt Enhancement Menu"
},
{
  "command": "openapicopilot.promptEnhancement.enhanceFromInput",
  "title": "Optimize Prompt from Input"
}
```

状态栏 item 的 command 指向：

```ts
statusBarItem.command = 'openapicopilot.promptEnhancement.openMenu';
```

`openMenu` 负责显示 QuickPick；`enhanceFromInput` 负责弹出输入框并执行优化。

### 9.7 输入弹窗流程

点击 `Optimize Prompt from Input` 后：

1. 使用 `vscode.window.showInputBox()` 弹窗输入原始提示词。
2. 用户提交后读取生效提示词优化配置。
3. 使用配置的 provider/model 作为特定优化模型。
4. 调用优化模型生成优化后的提示词。
5. 优先尝试将优化后的提示词填入 VS Code Chat 输入框草稿，不自动发送。
6. 如果预填 Chat 草稿失败，则降级为复制到剪贴板，并用信息提示告知用户。

建议交互：

```ts
const rawPrompt = await vscode.window.showInputBox({
  title: t('promptEnhancementInputTitle'),
  prompt: t('promptEnhancementInputPrompt'),
  placeHolder: t('promptEnhancementInputPlaceholder'),
  ignoreFocusOut: true,
});

if (!rawPrompt?.trim()) {
  return;
}

const enhancedPrompt = await enhancePromptWithConfiguredModel(rawPrompt.trim());
await handleEnhancedPromptResult(enhancedPrompt);
```

### 9.8 优化结果处理：尝试填入 Chat 草稿

优化完成后，可以优先尝试调用 VS Code 内置命令 `workbench.action.chat.open`，传入 `{ query, isPartialQuery: true }`，将优化后的提示词作为未发送草稿填入 Chat 输入框。

```ts
await vscode.commands.executeCommand('workbench.action.chat.open', {
  query: enhancedPrompt,
  isPartialQuery: true,
});
```

预期效果：

- 打开 VS Code Chat / Copilot Chat 面板。
- 将优化后的提示词填入输入框。
- 不自动发送。
- 用户仍需手动确认并发送。

但该能力必须定义为 **best-effort 增强体验**，不能作为稳定 API 强依赖。

原因：

- `workbench.action.chat.open` 是 VS Code Workbench 内置命令，不是 `vscode.d.ts` 中面向扩展作者公开建模的稳定 API。
- `query` 和 `isPartialQuery` 参数在当前 VS Code Chat 实现中可用，但未作为公开 API 契约文档化。
- VS Code 版本升级后，参数名、语义或行为可能变化。
- 该方式不能读取 Chat 输入框已有草稿，也不能保证修改任意已有输入框内容。

因此方案中不能表述为“使用官方 API 修改 Copilot Chat 输入框”，只能表述为：

```text
通过 VS Code 内置 Chat 命令 best-effort 预填 Chat 输入框草稿。
```

### 9.9 优化结果降级策略

实现必须提供降级：

1. 首选：尝试填入 Chat 草稿。
2. 如果失败：复制到剪贴板。
3. 提示用户手动粘贴或手动发送。

伪代码：

```ts
async function handleEnhancedPromptResult(enhancedPrompt: string): Promise<void> {
  const inserted = await tryInsertIntoChatDraft(enhancedPrompt);

  if (inserted) {
    vscode.window.showInformationMessage(
      t('promptEnhancementInsertedIntoChatDraft')
    );
    return;
  }

  await vscode.env.clipboard.writeText(enhancedPrompt);

  vscode.window.showInformationMessage(
    t('promptEnhancementCopiedToClipboard')
  );
}

async function tryInsertIntoChatDraft(text: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: text,
      isPartialQuery: true,
    });
    return true;
  } catch {
    return false;
  }
}
```

### 9.10 可选配置：是否尝试填入 Chat 草稿

为了允许用户关闭该 best-effort 行为，可以增加一个全局设置：

```json
"openapicopilot.promptEnhancement.insertIntoChatDraft": {
  "type": "boolean",
  "default": true,
  "description": "Try to insert the enhanced prompt into the VS Code Chat input as an unsent draft. This uses a best-effort VS Code built-in command and may not work in all versions.",
  "scope": "application"
}
```

说明：

- 默认开启，提供更顺滑体验。
- 如果关闭，则优化完成后直接复制到剪贴板。
- 该配置只影响状态栏手动优化结果的处理方式，不接入聊天转发链路。

### 9.11 优化模型调用伪代码

第一阶段状态栏入口提交后需要真实调用配置的特定模型优化提示词，但该调用是独立手动命令流程，不接入聊天转发链路。调用逻辑建议复用现有 provider 请求能力，避免复制 OpenAI-compatible 请求代码。

允许抽取现有请求构造和请求发送能力为独立服务供状态栏命令使用，但不得在 `src/provider.ts` 的 `LanguageModelChatProvider` 请求处理主链路中插入提示词优化逻辑。

```ts
async function enhancePromptWithConfiguredModel(rawPrompt: string): Promise<string> {
  const config = configManager.getEffectivePromptEnhancementConfig();

  if (!config.enabled) {
    throw new Error('Prompt enhancement is disabled.');
  }

  if (!config.providerId || !config.modelId) {
    throw new Error('Prompt enhancement model is not configured.');
  }

  const modelContext = await resolveConfiguredPromptEnhancementModel(config);

  const messages = [
    {
      role: 'system',
      content: buildPromptEnhancementSystemPrompt(),
    },
    {
      role: 'user',
      content: rawPrompt,
    },
  ];

  const response = await requestConfiguredModel(modelContext, messages);
  return extractText(response).trim();
}
```

### 9.12 优化提示词 System Prompt 建议

```text
你是一个提示词优化器。
请在不改变用户原意的前提下优化提示词。
要求：
1. 保留用户的核心目标。
2. 补充必要的上下文、约束和输出格式。
3. 让提示词更清晰、具体、可执行。
4. 不要直接回答用户问题。
5. 只输出优化后的提示词。
```

后续可根据界面语言生成不同语言的系统提示词，但第一阶段可以先固定使用中文或英文内部提示词。

---

## 10. 多语言翻译要求

必须给当前配置页已有的所有语言增加完整 key，不能只加英文或中文。

当前语言包括：

- `en`
- `zh-cn`
- `zh-tw`
- `ko`
- `ja`
- `fr`
- `de`

### 10.1 新增翻译 Key

建议新增以下 key：

```js
promptEnhancement
promptEnhancementDescription
enablePromptEnhancement
promptEnhancementHelp
promptEnhancementProvider
promptEnhancementModel
promptEnhancementSelectProvider
promptEnhancementSelectModel
promptEnhancementStatusBar
promptEnhancementShowStatusBar
promptEnhancementStatusBarHelp
promptEnhancementInsertIntoChatDraft
promptEnhancementInsertIntoChatDraftHelp
promptEnhancementMenuOptimizeFromInput
promptEnhancementMenuOpenSettings
promptEnhancementInputTitle
promptEnhancementInputPrompt
promptEnhancementInputPlaceholder
promptEnhancementInsertedIntoChatDraft
promptEnhancementCopiedToClipboard
promptEnhancementNotConfigured
promptEnhancementDisabledMessage
promptEnhancementProjectDescription
promptEnhancementGlobalStatus
promptEnhancementUseGlobal
promptEnhancementFollowGlobalState
promptEnhancementForceEnabledDesc
promptEnhancementForceDisabledDesc
promptEnhancementUseGlobalProvider
promptEnhancementUseGlobalModel
promptEnhancementModelOverrideHelp
promptEnhancementSettingsUpdated
```

### 10.2 English

```js
promptEnhancement: 'Prompt Enhancement',
promptEnhancementDescription: 'Configure prompt enhancement before model requests.',
enablePromptEnhancement: 'Enable Prompt Enhancement',
promptEnhancementHelp: 'When enabled, you can manually optimize prompts from the status bar using the selected enhancement model.',
promptEnhancementProvider: 'Prompt Enhancement Provider',
promptEnhancementModel: 'Prompt Enhancement Model',
promptEnhancementSelectProvider: 'Select provider',
promptEnhancementSelectModel: 'Select model',
promptEnhancementStatusBar: 'Status Bar Entry',
promptEnhancementShowStatusBar: 'Show Prompt Enhancement in status bar',
promptEnhancementStatusBarHelp: 'Show a text entry in the VS Code status bar. Click it to enter a prompt and optimize it with the configured model.',
promptEnhancementInsertIntoChatDraft: 'Insert enhanced prompt into Chat draft',
promptEnhancementInsertIntoChatDraftHelp: 'After optimization, try to prefill the VS Code Chat input without sending. Falls back to copying to clipboard if unavailable.',
promptEnhancementMenuOptimizeFromInput: 'Optimize Prompt from Input',
promptEnhancementMenuOpenSettings: 'Open Prompt Enhancement Settings',
promptEnhancementInputTitle: 'Prompt Enhancement',
promptEnhancementInputPrompt: 'Enter the prompt to optimize.',
promptEnhancementInputPlaceholder: 'For example: Help me write a TypeScript function...',
promptEnhancementInsertedIntoChatDraft: 'Enhanced prompt inserted into Chat draft. Review it and send manually.',
promptEnhancementCopiedToClipboard: 'Enhanced prompt copied to clipboard.',
promptEnhancementNotConfigured: 'Prompt enhancement model is not configured.',
promptEnhancementDisabledMessage: 'Prompt enhancement is disabled.',
promptEnhancementProjectDescription: 'Configure how this project uses the prompt enhancement model.',
promptEnhancementGlobalStatus: 'Global {state}',
promptEnhancementUseGlobal: 'Use global',
promptEnhancementFollowGlobalState: 'Follow global state: {state}',
promptEnhancementForceEnabledDesc: 'Force prompt enhancement on for this project.',
promptEnhancementForceDisabledDesc: 'Force prompt enhancement off for this project.',
promptEnhancementUseGlobalProvider: 'Use global prompt enhancement provider ({value})',
promptEnhancementUseGlobalModel: 'Use global prompt enhancement model ({value})',
promptEnhancementModelOverrideHelp: 'Select both provider and model to override the global prompt enhancement model. Leave either empty to keep using the global prompt enhancement model.',
promptEnhancementSettingsUpdated: 'Prompt enhancement settings updated.',
```

### 10.3 简体中文

```js
promptEnhancement: '提示词优化',
promptEnhancementDescription: '配置模型请求前的提示词优化能力。',
enablePromptEnhancement: '启用提示词优化',
promptEnhancementHelp: '启用后，可通过状态栏入口手动输入提示词，并使用所选优化模型生成优化后的提示词。',
promptEnhancementProvider: '提示词优化提供商',
promptEnhancementModel: '提示词优化模型',
promptEnhancementSelectProvider: '选择提供商',
promptEnhancementSelectModel: '选择模型',
promptEnhancementStatusBar: '状态栏入口',
promptEnhancementShowStatusBar: '在状态栏显示提示词优化',
promptEnhancementStatusBarHelp: '在 VS Code 状态栏显示文字入口。点击后可输入提示词，并使用配置的模型进行优化。',
promptEnhancementInsertIntoChatDraft: '将优化后的提示词填入 Chat 草稿',
promptEnhancementInsertIntoChatDraftHelp: '优化完成后，尝试将结果填入 VS Code Chat 输入框但不发送；不可用时降级为复制到剪贴板。',
promptEnhancementMenuOptimizeFromInput: '从输入内容优化提示词',
promptEnhancementMenuOpenSettings: '打开提示词优化设置',
promptEnhancementInputTitle: '提示词优化',
promptEnhancementInputPrompt: '请输入需要优化的提示词。',
promptEnhancementInputPlaceholder: '例如：帮我写一个 TypeScript 函数...',
promptEnhancementInsertedIntoChatDraft: '优化后的提示词已填入 Chat 草稿，请确认后手动发送。',
promptEnhancementCopiedToClipboard: '优化后的提示词已复制到剪贴板。',
promptEnhancementNotConfigured: '尚未配置提示词优化模型。',
promptEnhancementDisabledMessage: '提示词优化未启用。',
promptEnhancementProjectDescription: '配置当前项目如何使用提示词优化模型。',
promptEnhancementGlobalStatus: '全局{state}',
promptEnhancementUseGlobal: '使用全局',
promptEnhancementFollowGlobalState: '跟随全局状态：{state}',
promptEnhancementForceEnabledDesc: '当前项目强制开启提示词优化。',
promptEnhancementForceDisabledDesc: '当前项目强制关闭提示词优化。',
promptEnhancementUseGlobalProvider: '使用全局提示词优化提供商（{value}）',
promptEnhancementUseGlobalModel: '使用全局提示词优化模型（{value}）',
promptEnhancementModelOverrideHelp: '同时选择提供商和模型才会覆盖全局提示词优化模型；任一为空则继续使用全局提示词优化模型。',
promptEnhancementSettingsUpdated: '提示词优化设置已更新。',
```

### 10.4 繁體中文

```js
promptEnhancement: '提示詞最佳化',
promptEnhancementDescription: '設定模型請求前的提示詞最佳化能力。',
enablePromptEnhancement: '啟用提示詞最佳化',
promptEnhancementHelp: '啟用後，可透過狀態列入口手動輸入提示詞，並使用所選最佳化模型產生最佳化後的提示詞。',
promptEnhancementProvider: '提示詞最佳化提供商',
promptEnhancementModel: '提示詞最佳化模型',
promptEnhancementSelectProvider: '選擇提供商',
promptEnhancementSelectModel: '選擇模型',
promptEnhancementStatusBar: '狀態列入口',
promptEnhancementShowStatusBar: '在狀態列顯示提示詞最佳化',
promptEnhancementStatusBarHelp: '在 VS Code 狀態列顯示文字入口。點擊後可輸入提示詞，並使用設定的模型進行最佳化。',
promptEnhancementInsertIntoChatDraft: '將最佳化後的提示詞填入 Chat 草稿',
promptEnhancementInsertIntoChatDraftHelp: '最佳化完成後，嘗試將結果填入 VS Code Chat 輸入框但不送出；不可用時降級為複製到剪貼簿。',
promptEnhancementMenuOptimizeFromInput: '從輸入內容最佳化提示詞',
promptEnhancementMenuOpenSettings: '開啟提示詞最佳化設定',
promptEnhancementInputTitle: '提示詞最佳化',
promptEnhancementInputPrompt: '請輸入需要最佳化的提示詞。',
promptEnhancementInputPlaceholder: '例如：幫我寫一個 TypeScript 函式...',
promptEnhancementInsertedIntoChatDraft: '最佳化後的提示詞已填入 Chat 草稿，請確認後手動送出。',
promptEnhancementCopiedToClipboard: '最佳化後的提示詞已複製到剪貼簿。',
promptEnhancementNotConfigured: '尚未設定提示詞最佳化模型。',
promptEnhancementDisabledMessage: '提示詞最佳化未啟用。',
promptEnhancementProjectDescription: '設定目前專案如何使用提示詞最佳化模型。',
promptEnhancementGlobalStatus: '全域{state}',
promptEnhancementUseGlobal: '使用全域',
promptEnhancementFollowGlobalState: '跟隨全域狀態：{state}',
promptEnhancementForceEnabledDesc: '目前專案強制開啟提示詞最佳化。',
promptEnhancementForceDisabledDesc: '目前專案強制關閉提示詞最佳化。',
promptEnhancementUseGlobalProvider: '使用全域提示詞最佳化提供商（{value}）',
promptEnhancementUseGlobalModel: '使用全域提示詞最佳化模型（{value}）',
promptEnhancementModelOverrideHelp: '同時選擇提供商和模型才會覆寫全域提示詞最佳化模型；任一為空則繼續使用全域提示詞最佳化模型。',
promptEnhancementSettingsUpdated: '提示詞最佳化設定已更新。',
```

### 10.5 한국어

```js
promptEnhancement: '프롬프트 향상',
promptEnhancementDescription: '모델 요청 전에 프롬프트 향상 기능을 구성합니다.',
enablePromptEnhancement: '프롬프트 향상 활성화',
promptEnhancementHelp: '활성화하면 상태 표시줄 항목에서 프롬프트를 수동으로 입력하고 선택한 향상 모델로 향상된 프롬프트를 생성할 수 있습니다.',
promptEnhancementProvider: '프롬프트 향상 공급자',
promptEnhancementModel: '프롬프트 향상 모델',
promptEnhancementSelectProvider: '공급자 선택',
promptEnhancementSelectModel: '모델 선택',
promptEnhancementStatusBar: '상태 표시줄 항목',
promptEnhancementShowStatusBar: '상태 표시줄에 프롬프트 향상 표시',
promptEnhancementStatusBarHelp: 'VS Code 상태 표시줄에 텍스트 항목을 표시합니다. 클릭하면 프롬프트를 입력하고 구성된 모델로 향상할 수 있습니다.',
promptEnhancementInsertIntoChatDraft: '향상된 프롬프트를 Chat 초안에 삽입',
promptEnhancementInsertIntoChatDraftHelp: '향상 후 VS Code Chat 입력창에 보내지 않은 초안으로 미리 채우기를 시도합니다. 사용할 수 없으면 클립보드에 복사합니다.',
promptEnhancementMenuOptimizeFromInput: '입력에서 프롬프트 향상',
promptEnhancementMenuOpenSettings: '프롬프트 향상 설정 열기',
promptEnhancementInputTitle: '프롬프트 향상',
promptEnhancementInputPrompt: '향상할 프롬프트를 입력하세요.',
promptEnhancementInputPlaceholder: '예: TypeScript 함수를 작성해 주세요...',
promptEnhancementInsertedIntoChatDraft: '향상된 프롬프트가 Chat 초안에 삽입되었습니다. 확인 후 수동으로 보내세요.',
promptEnhancementCopiedToClipboard: '향상된 프롬프트가 클립보드에 복사되었습니다.',
promptEnhancementNotConfigured: '프롬프트 향상 모델이 구성되지 않았습니다.',
promptEnhancementDisabledMessage: '프롬프트 향상이 비활성화되어 있습니다.',
promptEnhancementProjectDescription: '이 프로젝트가 프롬프트 향상 모델을 사용하는 방식을 구성합니다.',
promptEnhancementGlobalStatus: '전역 {state}',
promptEnhancementUseGlobal: '전역 사용',
promptEnhancementFollowGlobalState: '전역 상태 따르기: {state}',
promptEnhancementForceEnabledDesc: '이 프로젝트에서 프롬프트 향상을 강제로 켭니다.',
promptEnhancementForceDisabledDesc: '이 프로젝트에서 프롬프트 향상을 강제로 끕니다.',
promptEnhancementUseGlobalProvider: '전역 프롬프트 향상 공급자 사용({value})',
promptEnhancementUseGlobalModel: '전역 프롬프트 향상 모델 사용({value})',
promptEnhancementModelOverrideHelp: '전역 프롬프트 향상 모델을 재정의하려면 공급자와 모델을 모두 선택하세요. 둘 중 하나라도 비워 두면 전역 프롬프트 향상 모델을 계속 사용합니다.',
promptEnhancementSettingsUpdated: '프롬프트 향상 설정이 업데이트되었습니다.',
```

### 10.6 日本語

```js
promptEnhancement: 'プロンプト強化',
promptEnhancementDescription: 'モデルリクエスト前のプロンプト強化機能を構成します。',
enablePromptEnhancement: 'プロンプト強化を有効化',
promptEnhancementHelp: '有効にすると、ステータスバー項目から手動でプロンプトを入力し、選択した強化モデルで強化後のプロンプトを生成できます。',
promptEnhancementProvider: 'プロンプト強化プロバイダー',
promptEnhancementModel: 'プロンプト強化モデル',
promptEnhancementSelectProvider: 'プロバイダーを選択',
promptEnhancementSelectModel: 'モデルを選択',
promptEnhancementStatusBar: 'ステータスバー項目',
promptEnhancementShowStatusBar: 'ステータスバーにプロンプト強化を表示',
promptEnhancementStatusBarHelp: 'VS Code のステータスバーにテキスト項目を表示します。クリックするとプロンプトを入力し、設定済みモデルで強化できます。',
promptEnhancementInsertIntoChatDraft: '強化後のプロンプトを Chat 下書きに挿入',
promptEnhancementInsertIntoChatDraftHelp: '強化後、VS Code Chat 入力欄に未送信の下書きとして入力を試みます。利用できない場合はクリップボードにコピーします。',
promptEnhancementMenuOptimizeFromInput: '入力からプロンプトを強化',
promptEnhancementMenuOpenSettings: 'プロンプト強化設定を開く',
promptEnhancementInputTitle: 'プロンプト強化',
promptEnhancementInputPrompt: '強化するプロンプトを入力してください。',
promptEnhancementInputPlaceholder: '例: TypeScript 関数を書いてください...',
promptEnhancementInsertedIntoChatDraft: '強化後のプロンプトを Chat 下書きに挿入しました。確認して手動で送信してください。',
promptEnhancementCopiedToClipboard: '強化後のプロンプトをクリップボードにコピーしました。',
promptEnhancementNotConfigured: 'プロンプト強化モデルが構成されていません。',
promptEnhancementDisabledMessage: 'プロンプト強化は無効です。',
promptEnhancementProjectDescription: 'このプロジェクトでプロンプト強化モデルを使用する方法を構成します。',
promptEnhancementGlobalStatus: 'グローバル {state}',
promptEnhancementUseGlobal: 'グローバルを使用',
promptEnhancementFollowGlobalState: 'グローバル状態に従う: {state}',
promptEnhancementForceEnabledDesc: 'このプロジェクトでプロンプト強化を強制的にオンにします。',
promptEnhancementForceDisabledDesc: 'このプロジェクトでプロンプト強化を強制的にオフにします。',
promptEnhancementUseGlobalProvider: 'グローバルプロンプト強化プロバイダーを使用（{value}）',
promptEnhancementUseGlobalModel: 'グローバルプロンプト強化モデルを使用（{value}）',
promptEnhancementModelOverrideHelp: 'グローバルプロンプト強化モデルを上書きするには、プロバイダーとモデルの両方を選択してください。どちらかが空の場合はグローバルプロンプト強化モデルを引き続き使用します。',
promptEnhancementSettingsUpdated: 'プロンプト強化設定が更新されました。',
```

### 10.7 Français

```js
promptEnhancement: 'Amélioration des prompts',
promptEnhancementDescription: 'Configure l’amélioration des prompts avant les requêtes au modèle.',
enablePromptEnhancement: 'Activer l’amélioration des prompts',
promptEnhancementHelp: 'Une fois activé, vous pouvez saisir manuellement un prompt depuis la barre d’état et générer un prompt amélioré avec le modèle sélectionné.',
promptEnhancementProvider: 'Fournisseur d’amélioration des prompts',
promptEnhancementModel: 'Modèle d’amélioration des prompts',
promptEnhancementSelectProvider: 'Sélectionner un fournisseur',
promptEnhancementSelectModel: 'Sélectionner un modèle',
promptEnhancementStatusBar: 'Entrée de barre d’état',
promptEnhancementShowStatusBar: 'Afficher l’amélioration des prompts dans la barre d’état',
promptEnhancementStatusBarHelp: 'Affiche une entrée texte dans la barre d’état de VS Code. Cliquez dessus pour saisir un prompt et l’optimiser avec le modèle configuré.',
promptEnhancementInsertIntoChatDraft: 'Insérer le prompt amélioré dans le brouillon Chat',
promptEnhancementInsertIntoChatDraftHelp: 'Après optimisation, tente de préremplir l’entrée VS Code Chat sans envoyer. En cas d’échec, copie le résultat dans le presse-papiers.',
promptEnhancementMenuOptimizeFromInput: 'Optimiser le prompt depuis une saisie',
promptEnhancementMenuOpenSettings: 'Ouvrir les paramètres d’amélioration des prompts',
promptEnhancementInputTitle: 'Amélioration des prompts',
promptEnhancementInputPrompt: 'Saisissez le prompt à optimiser.',
promptEnhancementInputPlaceholder: 'Par exemple : Aide-moi à écrire une fonction TypeScript...',
promptEnhancementInsertedIntoChatDraft: 'Prompt amélioré inséré dans le brouillon Chat. Vérifiez-le puis envoyez-le manuellement.',
promptEnhancementCopiedToClipboard: 'Prompt amélioré copié dans le presse-papiers.',
promptEnhancementNotConfigured: 'Le modèle d’amélioration des prompts n’est pas configuré.',
promptEnhancementDisabledMessage: 'L’amélioration des prompts est désactivée.',
promptEnhancementProjectDescription: 'Configure la façon dont ce projet utilise le modèle d’amélioration des prompts.',
promptEnhancementGlobalStatus: 'Global {state}',
promptEnhancementUseGlobal: 'Utiliser le global',
promptEnhancementFollowGlobalState: 'Suivre l’état global : {state}',
promptEnhancementForceEnabledDesc: 'Forcer l’activation de l’amélioration des prompts pour ce projet.',
promptEnhancementForceDisabledDesc: 'Forcer la désactivation de l’amélioration des prompts pour ce projet.',
promptEnhancementUseGlobalProvider: 'Utiliser le fournisseur global d’amélioration des prompts ({value})',
promptEnhancementUseGlobalModel: 'Utiliser le modèle global d’amélioration des prompts ({value})',
promptEnhancementModelOverrideHelp: 'Sélectionnez à la fois un fournisseur et un modèle pour remplacer le modèle global d’amélioration des prompts. Laissez l’un des deux vide pour continuer à utiliser le modèle global.',
promptEnhancementSettingsUpdated: 'Paramètres d’amélioration des prompts mis à jour.',
```

### 10.8 Deutsch

```js
promptEnhancement: 'Prompt-Verbesserung',
promptEnhancementDescription: 'Konfiguriert die Prompt-Verbesserung vor Modellanfragen.',
enablePromptEnhancement: 'Prompt-Verbesserung aktivieren',
promptEnhancementHelp: 'Wenn aktiviert, können Sie Prompts manuell über den Statusleisteneintrag eingeben und mit dem ausgewählten Verbesserungsmodell optimieren.',
promptEnhancementProvider: 'Prompt-Verbesserungsanbieter',
promptEnhancementModel: 'Prompt-Verbesserungsmodell',
promptEnhancementSelectProvider: 'Anbieter auswählen',
promptEnhancementSelectModel: 'Modell auswählen',
promptEnhancementStatusBar: 'Statusleisteneintrag',
promptEnhancementShowStatusBar: 'Prompt-Verbesserung in der Statusleiste anzeigen',
promptEnhancementStatusBarHelp: 'Zeigt einen Texteintrag in der VS Code-Statusleiste an. Klicken Sie darauf, um einen Prompt einzugeben und ihn mit dem konfigurierten Modell zu optimieren.',
promptEnhancementInsertIntoChatDraft: 'Verbesserten Prompt in Chat-Entwurf einfügen',
promptEnhancementInsertIntoChatDraftHelp: 'Versucht nach der Optimierung, den VS Code Chat-Eingabebereich ohne Senden vorzufüllen. Falls nicht verfügbar, wird der Text in die Zwischenablage kopiert.',
promptEnhancementMenuOptimizeFromInput: 'Prompt aus Eingabe optimieren',
promptEnhancementMenuOpenSettings: 'Prompt-Verbesserungseinstellungen öffnen',
promptEnhancementInputTitle: 'Prompt-Verbesserung',
promptEnhancementInputPrompt: 'Geben Sie den zu optimierenden Prompt ein.',
promptEnhancementInputPlaceholder: 'Zum Beispiel: Hilf mir, eine TypeScript-Funktion zu schreiben...',
promptEnhancementInsertedIntoChatDraft: 'Verbesserter Prompt wurde in den Chat-Entwurf eingefügt. Prüfen Sie ihn und senden Sie ihn manuell.',
promptEnhancementCopiedToClipboard: 'Verbesserter Prompt in die Zwischenablage kopiert.',
promptEnhancementNotConfigured: 'Prompt-Verbesserungsmodell ist nicht konfiguriert.',
promptEnhancementDisabledMessage: 'Prompt-Verbesserung ist deaktiviert.',
promptEnhancementProjectDescription: 'Konfiguriert, wie dieses Projekt das Prompt-Verbesserungsmodell verwendet.',
promptEnhancementGlobalStatus: 'Global {state}',
promptEnhancementUseGlobal: 'Global verwenden',
promptEnhancementFollowGlobalState: 'Globalem Status folgen: {state}',
promptEnhancementForceEnabledDesc: 'Prompt-Verbesserung für dieses Projekt erzwingen.',
promptEnhancementForceDisabledDesc: 'Prompt-Verbesserung für dieses Projekt deaktivieren.',
promptEnhancementUseGlobalProvider: 'Globalen Prompt-Verbesserungsanbieter verwenden ({value})',
promptEnhancementUseGlobalModel: 'Globales Prompt-Verbesserungsmodell verwenden ({value})',
promptEnhancementModelOverrideHelp: 'Wählen Sie sowohl Anbieter als auch Modell aus, um das globale Prompt-Verbesserungsmodell zu überschreiben. Lassen Sie eines von beiden leer, um weiterhin das globale Modell zu verwenden.',
promptEnhancementSettingsUpdated: 'Prompt-Verbesserungseinstellungen aktualisiert.',
```

---

## 11. 设置页 DOM 建议

### 11.1 全局设置 DOM ID

```text
modalPromptEnhancementEnabled
modalPromptEnhancementProvider
modalPromptEnhancementModel
modalPromptEnhancementStatusBarEnabled
modalPromptEnhancementInsertIntoChatDraft
```

Panel 页面对应：

```text
panelPromptEnhancementEnabled
panelPromptEnhancementProvider
panelPromptEnhancementModel
panelPromptEnhancementStatusBarEnabled
panelPromptEnhancementInsertIntoChatDraft
```

### 11.2 项目设置 DOM ID

```text
projectPromptEnhancementEnabledStateGlobal
projectPromptEnhancementEnabledStateEnabled
projectPromptEnhancementEnabledStateDisabled
projectPromptEnhancementProvider
projectPromptEnhancementModel
```

---

## 12. 第一阶段不接入转发链路

第一阶段明确不修改以下逻辑：

- 不修改 `src/provider.ts` 的请求转发主流程。
- 不向主模型 system prompt 注入提示词优化说明。
- 不向任何模型注入提示词优化工具。
- 不在 provider 层调用优化模型。
- 不处理 `/enhance` 前缀。
- 不处理 auto 模式。
- 不处理聊天发送前确认弹窗。

第一阶段允许新增状态栏入口和状态栏入口触发的输入弹窗。该流程是独立手动功能，不属于聊天转发链路。

第一阶段允许状态栏手动流程调用配置的提示词优化模型，并在优化完成后 best-effort 尝试预填 Chat 草稿；该行为不修改 Copilot Chat 输入框读取能力，也不接入聊天请求转发主链路。

第一阶段目标是“配置可见、可保存、可回显、可合并”，并提供状态栏手动优化入口。

---

## 13. 后续阶段预留

第一阶段的配置需要为后续阶段预留能力。

以下内容仅为后续阶段可能方向，不在第一阶段注册配置项，不在第一阶段设置页展示，也不影响当前聊天转发链路。

### 13.1 阶段二：手动命令增强

后续新增命令：

- `openapicopilot.promptEnhancement.enhanceFromInput`
- `openapicopilot.promptEnhancement.enhanceSelection`
- `openapicopilot.promptEnhancement.enhanceClipboard`

其中 `enhanceFromInput` 可与第一阶段状态栏菜单共用同一套实现。

### 13.2 阶段三：可选 Provider 前缀触发

当 `mode === 'prefix'` 时，在 provider 转发前识别最后一条 user message：

```text
/enhance 原始提示词
```

然后调用提示词优化模型，替换最后一条 user message 后再转发。

### 13.3 阶段四：可选 Provider 自动增强

当 `mode === 'auto'` 时，对“看起来像用户请求”的最后一条 user message 做启发式增强。

需要跳过：

- tool call 相关请求。
- tool result 回流请求。
- 内部模型调用。
- 已经增强过的请求。
- 过短请求。

### 13.4 阶段五：自定义 Chat Webview

如果后续实现完整 Webview 聊天界面，可以直接使用本阶段配置的 provider/model 作为提示词优化模型。

---

## 14. 第一阶段验收标准

1. `npm run compile` 通过。
2. VS Code Settings 中能看到以下配置项：
   - `openapicopilot.promptEnhancement.enabled`
   - `openapicopilot.promptEnhancement.enabledState`
   - `openapicopilot.promptEnhancement.providerId`
   - `openapicopilot.promptEnhancement.modelId`
  - `openapicopilot.promptEnhancement.statusBar.enabled`
  - `openapicopilot.promptEnhancement.insertIntoChatDraft`
3. 全局设置 UI 能保存并回显提示词优化配置。
4. 项目设置 UI 能保存并回显提示词优化配置。
5. 项目 `enabledState` 能正确覆盖全局启用状态。
6. 项目 provider/model 同时非空时覆盖全局 provider/model。
7. 项目 provider/model 任一为空时继续使用全局 provider/model。
8. 状态栏入口开关能保存并回显。
9. “优化后尝试填入 Chat 草稿”开关能保存并回显。
10. 状态栏入口使用文字显示，并能跟随当前语言展示。
11. 点击状态栏入口后能打开提示词优化菜单。
12. 菜单中的“从输入内容优化提示词”能弹出输入框。
13. 提交输入后能使用配置的提示词优化 provider/model 生成优化后的提示词。
14. 当 `insertIntoChatDraft=true` 时，优先 best-effort 尝试将优化结果填入 Chat 草稿且不自动发送。
15. 如果填入 Chat 草稿失败，或 `insertIntoChatDraft=false`，优化结果会复制到剪贴板。
16. 所有 UI 文案在 `en`、`zh-cn`、`zh-tw`、`ko`、`ja`、`fr`、`de` 中都有翻译。
17. 第一阶段不改变任何聊天转发行为。
18. 不引入读取 Copilot Chat 输入框内容的非公开能力；Chat 草稿填入只作为 best-effort 内置命令增强体验。

---

## 15. 专家审查关注点

请专家重点审查：

1. 是否完全复用了全局/项目专家模式的设计心智。
2. 配置项 scope 是否合理。
3. 第一阶段是否控制住范围，没有提前接入转发链路。
4. 移除触发模式和发送前确认设置后，配置是否更清晰。
5. 状态栏入口使用文字是否符合 VS Code 状态栏交互习惯。
6. 点击状态栏后弹窗输入提示词并使用特定模型优化的流程是否合理。
7. 多语言 key 是否完整覆盖当前已有语言。
8. 后续阶段是否有足够扩展空间。
