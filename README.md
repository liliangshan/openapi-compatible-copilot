# LLS OAI - OpenAI-compatible & Anthropic for Copilot Chat

A VS Code extension that integrates multiple OpenAI-compatible and Anthropic API providers into GitHub Copilot Chat.

## Features

- 🚀 **Multiple Provider Support** - Add and manage multiple OpenAI-compatible and Anthropic API providers
- 🦙 **Local LLM Friendly** - OpenAI-compatible and Responses API providers can be used without an API key, making local runtimes such as llama.cpp, LM Studio, Ollama-compatible endpoints, vLLM, and LocalAI easy to connect
- 🔐 **Secure Key Storage** - API keys are stored securely using VS Code's secret storage
- 🎨 **Beautiful Configuration UI** - Easy-to-use webview interface for managing providers
- 🔌 **Copilot Integration** - Seamlessly integrates with GitHub Copilot Chat
- 📤 **Import/Export Config** - Backup and restore your provider configurations
- 💾 **Auto Save Chat History** - Automatically save chat conversations to local files with **dual-path support** (global + project-level)
- 🔄 **Expert Mode Chat History** - Automatically saves Expert Mode conversations including tool calls and multi-turn expert interactions
- 🔄 **Copilot Records Migration** - Import and export Copilot chat records between machines
- 🌐 **Multi-language UI** - Supports English, Simplified Chinese, Traditional Chinese, Korean, Japanese, French, and German. Auto mode follows the VS Code display language and falls back to English for unsupported languages
- 🖥️ **Global & Project System Prompt Settings** - Dual system prompt inputs (global + workspace-scoped) appended to user messages for better model adherence
- ✅ **Enhanced TODO Settings** - When enabled, the model is strongly instructed to create, track, and update all tasks through the TODO tool before taking any action
- 🎯 **Expert Mode** - Use mid/low-tier models for development tasks and high-tier models as expert reviewers for supplementation and quality assurance
- 🧭 **Solution Provider** - Delegate solution design, implementation planning, and architecture proposals to a dedicated solution model, with optional expert review before finalizing
- ✨ **Prompt Enhancement** - Optimize prompts with a dedicated provider/model before sending or saving them. Supports global and workspace configuration, provider/model overrides, auto-submit behavior, and system prompt optimization buttons
- 🖼️ **Vision/Multimodal Input Support** - Supports image input forwarding across OpenAI-compatible Chat Completions, Responses API, and Anthropic Messages API providers
- 🛡️ **Hardened Multimodal Conversion** - Validates model vision capability, supported image MIME types, mixed text/image message merging, Anthropic tool results, Responses API image conversion, and safe placeholders for unsupported binary content
- 🧠 **Strict Reasoning Compatibility** - Preserves and replays `reasoning_content` for tool-call turns, improving compatibility with DeepSeek Reasoner and other strict OpenAI-compatible providers
- 📊 **Status Bar Context Compaction** - The token usage status bar tracks remaining context capacity and shows a localized “click to compact” action when the remaining budget is low. Click it to send `/compact` and compress the current Copilot Chat context
- 🛠️ **VS Code Problems Diagnostics Fix** - The `get_errors` tool is handled locally so models can reliably receive VS Code Problems diagnostics, including warnings, with up to 10 sorted diagnostics returned per call
- ✅ **LLS Task Workflow** - Use the built-in `@lls-task` chat participant to turn a dragged-in planning Markdown document or your own prompt into a workspace task workflow. The workflow is shown in the status bar, injected into main-model chats, and updated through a restricted `update_lls_task_workflow` tool that only changes task status. The extension can automatically continue unfinished workflows after the main model becomes idle
- 📡 **Remote Work** - Connect the extension to a remote server via WebSocket and/or Webhook to receive `server.chat_message` events that are automatically injected into the active Chat Input and submitted, and to forward all `model.*` lifecycle events (request, deltas, tool results, completion, errors) back to the server with the original server-issued `requestId` preserved for request-response correlation. WebSocket and Webhook channels are fully decoupled and can be enabled independently. Includes a localized settings panel with a Usage section covering self-hosted deployment (<https://github.com/liliangshan/llsoai-websocket>) and our hosted services (Mainland China / Overseas), plus a clear privacy notice that we do not store or back up your data

## Latest Updates

### 3.0.2

- **LLS Task custom prompts** — The `@lls-task` workflow assistant can now generate workflows from custom prompt text when no planning file is dragged in. Dragged planning documents still take priority, while the unchanged localized placeholder is ignored as empty guidance.
- **Clearer LLS Task start guidance** — The status bar start prompt now tells users they can drag a planning document or delete the inserted hint and write their own workflow prompt, with localized wording across supported languages.
- **Max output token enforcement** — Model `maxTokens` settings are now treated explicitly as max output tokens and propagated to OpenAI-compatible, Responses API, and Anthropic requests.
- **Max output token UI wording** — The model configuration modal now labels the field as max output tokens to avoid confusing it with context length.

### 3.0.0

- **LLS Task Workflow** — Added the `@lls-task` workflow assistant. Drag a solution planning Markdown document into the `@lls-task` chat participant and the configured task model will analyze it into a structured task workflow.
- **Status bar workflow progress** — The LLS Task status bar shows localized workflow status, progress counts, hover task lists, setup guidance, and completed-workflow guidance for starting a new workflow.
- **Main-model workflow context** — Active workflows are automatically injected into the main model context, including the generated task list and the original planning document path.
- **Restricted workflow updates** — Added the local `update_lls_task_workflow` tool so the main model can update only task IDs and statuses (`pending`, `in_progress`, `completed`, `blocked`) without modifying task titles, descriptions, ordering, or summary.
- **Automatic continuation** — After a main-model turn finishes, unfinished workflows are checked after 15 seconds. If the main model is idle and tasks remain incomplete, the extension auto-submits a localized continue prompt back into Chat.
- **Localized workflow UX** — LLS Task settings, status bar text, hover messages, start prompts, error messages, and auto-continue prompts are localized across the supported UI languages.

### 2.7.5

- **Status bar context compaction** — The token usage status bar now detects when the remaining context budget is low and shows a localized “click to compact” action beside the percentage.
- **One-click `/compact`** — Clicking the low-context status bar action sends `/compact` directly to Copilot Chat so you can compress the current conversation context before continuing.

### 2.7.0

- **Remote Work module** — New WebSocket + Webhook integration. Connect VS Code to a remote server to receive chat messages and forward all model lifecycle events back in real time.
- **Server-issued `requestId` preserved end-to-end** — All `model.*` events emitted for a given inbound `server.chat_message` reuse the original `requestId`, matching `protocol.Envelope.RequestID` request-response semantics.
- **Auto inbound submission** — Incoming chat messages from the connected WebSocket are automatically injected into the active Chat Input and submitted; the prior `inboundEnabled` / `inboundAutoSend` settings have been removed for a simpler workflow.
- **Independent channels** — WebSocket forwarding is gated only by Remote Work / WebSocket toggles and online status; Webhook forwarding is gated by its own toggles and the global cache, so each channel can be enabled separately.
- **Localized settings panel** — Added a fully localized Remote Work settings panel (EN / 简中 / 繁中 / 한국어 / 日本語 / Français / Deutsch) with a redesigned card-style Usage section.
- **Usage entries** — The Usage section documents two ways to use Remote Work:
  - Self-hosted deployment: <https://github.com/liliangshan/llsoai-websocket>
  - Use our service: Mainland China <https://oai.hlwidc.com> · Overseas <https://oai.zhineng.dev> (`lang` is auto-filled from the active UI language)
  - Privacy notice: *We do not store or back up any of your data.*
- **Diagnostic logs** — Added `[websocket-queued]` and `[websocket-sent]` entries to the `LLS OAI Remote Work` output channel for easier troubleshooting.

### 2.6.7

- Hardened multimodal and vision forwarding across OpenAI-compatible Chat Completions, Responses API, and Anthropic Messages API providers.
- Fixed mixed text/image user message merging so multimodal content is preserved during request construction.
- Improved Anthropic `tool_result` conversion with strict text/image block handling, safe consecutive tool-result merging, and readable placeholders for unsupported tool output.
- Improved Responses API image conversion for OpenAI-style `image_url` parts and Anthropic-style image blocks.
- Replaced unsupported binary tool result content with compact placeholders instead of serializing raw data into prompts.
- Added safer request diagnostics by masking URL query values and sanitizing session-derived cache/TODO filenames.

## 📡 Remote Work

The Remote Work module lets you drive Copilot Chat from a remote server, and stream the resulting model activity back. It is designed for team automation, monitoring dashboards, agent orchestrators, and custom front-ends that need bidirectional integration with VS Code.

### How It Works

1. The extension opens a WebSocket connection to your configured server (and optionally a Webhook URL).
2. The server sends a `server.chat_message` envelope containing the prompt text and a `requestId`.
3. The extension automatically injects the prompt into the active Chat Input and submits it.
4. As the model runs, the extension emits `model.*` events (request started, streamed deltas, tool calls and results, completion, errors) back over WebSocket and/or Webhook.
5. Every emitted event reuses the original server-issued `requestId`, matching `protocol.Envelope.RequestID` so the server can correlate the full lifecycle of each request.

### Key Features

- **Two Independent Channels** — WebSocket (real-time, bidirectional) and Webhook (HTTP callback). Each is enabled separately and gated by its own toggle.
- **Auto Inbound Submission** — Inbound messages are always submitted into Chat automatically; no extra confirmation is required.
- **Request-Response Correlation** — The server's `requestId` is preserved across every related outbound `model.*` event for the entire request lifecycle, including tool calls and final completion.
- **Optional Chat History Requests** — When `Allow remote history requests` is enabled, authorized remote clients can request session history through the connected channel.
- **Diagnostic Logging** — Outbound traffic is logged to the `LLS OAI Remote Work` output channel with `[websocket-queued]` and `[websocket-sent]` markers.
- **Localized Settings UI** — Fully localized panel with a card-style Usage section linking to self-hosted and hosted options.

### Settings

Open the **Remote Work Settings** panel from the status bar or command palette:

- **Enable Remote Work** — Master toggle for the module.
- **WebSocket** — Enable WebSocket, set the WebSocket URL (e.g. `wss://example.com/ws?token=...`), and use the **Connect** button to (re)connect.
- **Webhook** — Enable the Webhook callback channel and set the Webhook URL.
- **Chat History Request** — Toggle whether remote clients can request chat history.

### Usage Options

The Usage section in the Remote Work settings panel offers two ways to get started:

1. **Self-hosted Deployment** — Run your own server using the open-source reference implementation:
   <https://github.com/liliangshan/llsoai-websocket>
2. **Use Our Service** — Use the hosted endpoints. The current UI language is automatically appended as a `lang` query parameter:
   - Mainland China: <https://oai.hlwidc.com>
   - Overseas: <https://oai.zhineng.dev>

> 🔒 **Privacy Notice** — When using our hosted service, we do not store or back up any of your data.

## ✅ LLS Task Workflow

LLS Task Workflow turns a planning document into an executable task flow for Copilot Chat. It is designed for longer implementation work where you want the model to follow a plan, expose progress in the status bar, and keep moving until the workflow is complete.

### How It Works

1. Configure the **LLS Task** provider and model in Global Settings.
2. Click the LLS Task status bar item, or type `@lls-task` in Chat.
3. Drag a solution planning Markdown document from Explorer into the `@lls-task` chat window, or delete the inserted hint and write your own workflow prompt directly.
4. The task model analyzes the document or custom prompt and generates a structured workflow.
5. The workflow appears in the status bar with progress counts and a hover task list.
6. The extension sends a continue prompt to the main model. The current workflow and planning document path are automatically injected into the main-model context.
7. As work progresses, the main model updates task status through the local `update_lls_task_workflow` tool.
8. If the workflow is not complete after a main-model turn, the extension waits 15 seconds and auto-submits a localized continue prompt when the main model is idle.

### Key Features

- **Dedicated `@lls-task` participant** — Captures planning documents through VS Code Chat Participant integration, or uses custom prompt text when no document is attached.
- **Planning-document analysis** — Supports Markdown and common text planning files, converting actionable content into workflow JSON internally.
- **Status bar progress** — Displays completed/total task counts. Hovering shows the task list and statuses; completed workflows include guidance for starting a new workflow.
- **Main-model context injection** — The active workflow and original planning document path are included automatically when the main model runs.
- **Safe status-only updates** — The main model can only update task status via `update_lls_task_workflow`; task content, titles, order, and summary are protected.
- **Automatic continuation** — Unfinished workflows are resumed automatically after the main model becomes idle, reducing manual “continue” prompts.
- **Localized experience** — Setup hints, status bar labels, generated prompts, and workflow messages follow the configured UI language.

### Configuration

Open **Global Settings** and choose:

- **LLS Task Provider** — The provider used to analyze planning documents.
- **LLS Task Model** — The model used to generate the workflow.

There is no separate enable switch: once a provider and model are selected, the `@lls-task` workflow is ready to use.

## ✨ Prompt Enhancement

Prompt Enhancement lets you use a selected model to rewrite, clarify, and structure prompts before they are used. It is useful when you want a lightweight or specialized model to turn a rough request into a more precise instruction for Copilot Chat or for your custom system prompts.

### Key Features

- **Dedicated Optimization Model** — Choose a Prompt Enhancement provider and model independently from your normal chat model.
- **Global and Workspace Settings** — Enable Prompt Enhancement globally, or use workspace-level `Use global` / `Enabled` / `Disabled` controls for project-specific behavior.
- **Provider/Model Overrides** — Workspace settings can override the global Prompt Enhancement provider/model when both values are selected.
- **System Prompt Optimization** — Global and project system prompt editors include an Optimize button that rewrites the current prompt using the selected Prompt Enhancement model.
- **Uses Current Dropdown Selection** — System prompt optimization uses the provider/model currently selected in the settings dropdowns, even before you save the settings.
- **Optional Auto-submit** — Prompt Enhancement can insert the optimized prompt into Chat as a draft or submit it automatically, depending on your configuration.
- **Localized UI** — Prompt Enhancement controls are localized across English, Simplified Chinese, Traditional Chinese, Korean, Japanese, French, and German.

### Configuration

Prompt Enhancement is configured in the settings UI:

- **Global Settings** — Enable/disable Prompt Enhancement, select the optimization provider/model, and configure auto-submit behavior.
- **Project Settings** — Follow global settings or force Prompt Enhancement on/off for the current workspace. You can also override the optimization provider/model for that project.

If a project provider/model override is incomplete, the extension falls back to the global Prompt Enhancement provider/model.

## 🧠 Strict Reasoning Content Compatibility

Some OpenAI-compatible reasoning models, such as DeepSeek Reasoner, require the original assistant `reasoning_content` to be included again when a conversation continues after tool results. LLS OAI preserves this content for tool-call turns and restores it to the matching assistant tool-call message by tool call ID.

Reasoning cache files are stored locally per chat session:

```text
~/.LLSOAI/reasoning/<session-id>.json
```

This compatibility layer helps avoid strict-provider errors when using tools, Expert Mode, or Solution Provider flows with models that validate reasoning-content continuity.

## 🦙 Local LLMs Without API Keys

OpenAI-compatible and Responses API providers support an optional API key. This makes it possible to connect local model servers that do not require authentication, such as llama.cpp, LM Studio, Ollama-compatible OpenAI endpoints, vLLM, and LocalAI.

Example local llama.cpp-style configuration:

| Field | Example |
|-------|---------|
| **API Type** | `OpenAI-Compatible` |
| **Base URL** | `http://127.0.0.1:8080/v1` |
| **API Key** | Leave empty |

When the API key is empty, the extension does not send an empty `Authorization: Bearer` header. If your provider does require authentication, simply enter the API key and the normal `Authorization: Bearer <key>` header will be sent.

Notes:

- Anthropic providers still require an API key.
- Expert Mode and Solution Provider selectors intentionally show only providers with a configured API key. No-key local providers are supported for normal chat models.
- If a local server does not expose `/models`, you can disable auto-fetch and add models manually in the provider UI.

## 🎯 Expert Mode

> Use **mid/low-tier models** for daily development work, and bring in **high-tier models** as expert reviewers when you need deeper insight — fast, cost-effective, and powerful.

Expert Mode enables a **dual-model workflow** that maximizes both efficiency and quality. Your primary model handles the bulk of development tasks at high speed and low cost, while a high-tier expert model is called in to review, supplement, and elevate the output.

### How It Works

- **Main Model** — Your configured primary model (e.g., GPT-4o-mini, Claude Haiku) takes on all development tasks. It's fast, affordable, and capable for the majority of day-to-day coding work.
- **Expert Model** — A high-tier model (e.g., GPT-4o, Claude 3.5/3.7 Sonnet/Opus) that reviews the main model's output and adds expert-level corrections, improvements, and additional context.

### The Workflow

```
[User Request]
       ↓
[Main Model — Mid/Low-tier]
  Fast, affordable development
       ↓
[Expert Model — High-tier]
  Expert review & supplement
       ↓
[Enhanced Response → Copilot Chat]
```

### When to Use

| Scenario | Main Model | Expert Model |
|----------|-----------|-------------|
| Routine coding, refactoring, bug fixes | ✅ | Optional |
| Complex architecture decisions | ✅ | ✅ Recommended |
| Security-sensitive or critical code | ✅ | ✅ Recommended |
| Deep reasoning or edge-case analysis | ✅ | ✅ Recommended |

### Configuration

Expert Mode is configured in the provider settings:

- **Main Model Tool Name** — The tool name (e.g., `ask_llsoai`) that triggers the main model in Copilot Chat
- **Expert Model Tool Name** — The tool name for the expert model (e.g., `ask_llsoai_expert`)
- **Expert Tool Invocation** — The main model is guided by a system prompt to call the expert tool (`ask_llsoai`) when it cannot confidently solve a task, needs independent verification, requires deeper investigation, or when you explicitly ask it to delegate to the expert. The expert model can use the same VS Code tools as the main model and returns its findings for the main model to incorporate into the final response.
- **Expert Settings Hint** — A custom hint displayed in the Expert Mode settings panel to guide the expert model's behavior

### Benefits

- 💰 **Cost Efficiency** — Handle the majority of tasks with affordable mid/low-tier models
- ⚡ **Speed** — Main model responses are fast, reducing wait time during development
- 🧠 **Quality Assurance** — Expert model reviews catch issues that smaller models might miss
- 🔧 **Flexible** — Choose how often the expert model is involved based on your needs
- 🔗 **Seamless** — Expert model output is automatically integrated into the Copilot Chat conversation
- 💾 **Chat History** — Expert Mode conversations are automatically saved to chat history, including tool calls and multi-turn interactions

## 🧭 Solution Provider

> Delegate solution design, implementation planning, and architecture proposals to a dedicated solution model — with optional expert review before finalizing.

Solution Provider enables a **three-layer collaboration workflow** that maximizes planning quality:

```
[User Request]
       ↓
[Main Model]
  Decides whether to delegate solution design
       ↓
[Solution Provider Model]
  Generates structured solution: goals, constraints, phased steps, risks, validation plan
       ↓
[Expert Model — Optional Review]
  Independent review of the proposed solution
       ↓
[Solution Model Absorbs Review → Final Solution → Main Model]
  Enhanced Response → Copilot Chat
```

### How It Works

- **Main Model** — Your primary model that decides whether a task requires structured solution design. If so, it calls `ask_solution_provider` with a self-contained task description.
- **Solution Model** — A dedicated model configured for solution design, implementation planning, architecture proposals, risk analysis, and phased roadmaps. It uses VS Code tools to inspect the workspace and ground the plan in the actual project.
- **Expert Model (Optional)** — When "expert review" is enabled, the solution model must call `ask_llsoai` at least once before finalizing. The expert independently reviews the proposed solution, and the solution model absorbs the review feedback before returning the final result.

### Configuration

Solution Provider is configured in the provider settings:

- **Global Settings** — Enable/disable, select solution provider, select solution model, and toggle expert review.
- **Workspace Settings** — Override global with `Use global` / `Force enabled` / `Force disabled` for both solution provider and expert review independently.
- **Project Provider/Model Override** — Leave blank to use global solution model, or set workspace-specific provider/model.

### Key Features

- 📋 **Structured Output** — Solution models return structured results with `writeStatus`, `solutionSummary`, `solutionFile`/`fullSolutionInline`, and error/reason fields.
- 📝 **Auto Draft Persistence** — Solution models can optionally persist solutions as Markdown in `.LLSOAI/Solution/drafts/` for traceability and better expert review quality.
- 🔒 **Safety Guards** — Recursive delegation prevention (solution model never sees `ask_solution_provider`), expert review count limits, forced review reminder limits with graceful degradation.
- 🔀 **Tool Call Prefix Isolation** — Solution model tools use `llsoai_solution:` prefix, expert model tools use `llsoai:` prefix — no interference when both run concurrently.

## 💾 Chat History

### Dual-Path Saving

Chat history can be saved to two locations simultaneously:

| Location | Default Path | Description |
|----------|-------------|-------------|
| **Global** | `~/.LLSOAI/chat_*.json` | Centralized storage for all conversations |
| **Project** | `<project>/.LLSOAI/YYYY-MM-DD/` | Date-organized per-project storage |

Each save location can be independently enabled or disabled:

- **Global** — Always overwrites the latest session, keeping a single up-to-date record
- **Project** — Organized by date, creating a new file each day for historical tracking

### Expert Mode Chat History

Expert Mode conversations are automatically saved when the expert model completes streaming:

- ✅ Saves after each expert response (text or tool calls)
- ✅ Includes user's question, expert responses, and tool interactions
- ✅ Both global and project-level saves apply to Expert Mode
- ✅ Saves the complete expert context for review and continuity

## 📸 Timeline Snapshot

Timeline is an intelligent file history management system that automatically tracks file changes and provides powerful restoration capabilities:

### Auto Snapshot on Save

When you save any file, the extension automatically creates a timestamped snapshot:

| Feature | Description |
|---------|-------------|
| **Automatic Backup** | Files are snapshotted on every save |
| **Location** | `~/.LLSOAI/History/<mapped-file-path>/` |
| **Metadata** | `metadata.json` tracks all snapshots with SHA-256, line count, timestamps |
| **Smart Trimming** | Keeps max 20 snapshots per file to save space |
| **Exclusion** | Automatically excludes `.git`, `node_modules`, build dirs, and secret files |

### Git Integration

Timeline intelligently integrates with Git to keep snapshots clean:

| Feature | Description |
|---------|-------------|
| **Git Clean Detection** | When a file is removed by `git clean`, its snapshots are automatically cleaned |
| **Commit Change Tracking** | Watches `.git/HEAD`, `packed-refs`, `refs/heads/**` for commit changes |
| **Worktree Support** | Handles Git worktree scenarios correctly |
| **Safe Cleanup** | On git operations, snapshots of modified files are cleaned while preserving metadata |

### Provider Built-in Timeline Tools

Three built-in tools are available in every provider for file history exploration:

#### `timeline_list_by_file`
Lists all snapshots for a given file path:
- Returns snapshot records with timestamps, SHA-256, line counts
- Shows which snapshots have been git-cleaned

#### `timeline_restore_snapshot`
Restores a file to a previous snapshot state:
- Validates snapshot ID against metadata
- Refuses to restore files protected by Git HEAD
- Creates automatic `beforeRestore` backup before restoration
- Safety checks ensure you can always recover

#### `timeline_read_snapshot_lines`
Reads partial content from any snapshot:
- Supports 1-based line numbers
- Maximum 200 lines per request
- Returns `totalLines` for pagination
- Handles out-of-range requests gracefully

### Internal Tool Continuation

Timeline tools support seamless multi-turn interactions:
- When you call a timeline tool, the model can continue making timeline calls
- Maximum 3 continuation rounds per conversation turn
- Tool results are automatically appended to the conversation
- Perfect for exploring file history without leaving Copilot Chat

### Snapshot Format

```
~/.LLSOAI/History/<file-absolute-path>/
├── metadata.json          # Snapshot index and metadata
└── snapshots/
    └── <snapshot-id>      # Raw file content (no JSON wrapper)
```

### Benefits

- 🛡️ **Safety Net** — Every save creates a recoverable backup
- 🔍 **Easy Exploration** — List and read historical versions without leaving Copilot
- ♻️ **Smart Restoration** — Restore any snapshot with automatic safety backups
- 🧹 **Git-Aware** — Automatically cleans stale snapshots on git operations
- 🔧 **Non-blocking** — Snapshot failures don't interfere with file operations

## Supported APIs

| API Type | Endpoint | Notes |
|----------|----------|-------|
| **OpenAI-compatible** | `/v1/chat/completions` | Any OpenAI-compatible API |
| **Anthropic** | `/v1/messages` | Claude models with automatic format conversion |

### Anthropic API Features

When using Anthropic API type, the extension automatically handles:
- ✅ Message format conversion (system/user/assistant/tool roles)
- ✅ Tool definitions conversion (`input_schema` ↔ `parameters`)
- ✅ Tool choice mapping (`auto/none/required` ↔ `auto/none/any`)
- ✅ Streaming response translation
- ✅ Full tool calling support (including no-argument tools)

## Requirements

- VS Code 1.104.0 or higher
- GitHub Copilot Chat extension

## Getting Started

1. Install the extension
2. Click on the "LLS OAI" status bar item or use the command palette: `LLS OAI: Manage Providers`
3. Click "Add Provider" to configure your first provider
4. Fill in:
   - **Name**: A unique identifier for this provider (e.g., "MyOpenAI", "Claude")
   - **API Type**: Select "OpenAI-compatible" or "Anthropic"
   - **Base URL**: The API endpoint (e.g., `https://api.openai.com/v1` or `https://api.anthropic.com`)
   - **API Key**: Your API key for authentication
   - **Models**: Add one or more models with their configurations
5. Save and start using your provider in Copilot Chat!

## ⚠️ Important: Base URL Format

When configuring the Base URL, **do NOT include the API endpoint path suffix**:

| ✅ Correct | ❌ Incorrect |
|------------|-------------|
| `https://api.openai.com/v1` | `https://api.openai.com/v1/chat/completions` |
| `https://api.anthropic.com/v1` | `https://api.anthropic.com/v1/messages` |
| `https://your-proxy.com/v1` | `https://your-proxy.com/v1/chat/completions` |

The extension automatically appends the correct endpoint based on the API type:
- **OpenAI-compatible** → appends `/chat/completions`
- **Anthropic** → appends `/messages`

## Provider Configuration

Each provider requires:

- **Name**: Unique identifier shown in Copilot
- **API Type**: `OpenAI-compatible` or `Anthropic`
- **Base URL**: API endpoint URL
- **API Key**: Authentication key (stored securely)
- **Models**: List of models with:
  - Model ID (API identifier)
  - Display Name (shown in Copilot UI)
  - Context Length
  - Max Tokens
  - Temperature & Top-P settings
  - Vision support flag

## Commands

- `LLS OAI: Manage Providers` - Open the provider management UI
- `LLS OAI: Open Configuration UI` - Open configuration panel

## Import/Export

You can backup and restore your provider configurations:

1. Click "Export" to save all configurations to a JSON file
2. Click "Import" to restore from a previously exported file

**Note**: API keys are not included in exports for security reasons. You'll need to re-enter them after importing.

## Multi-language UI

The configuration UI supports multiple display languages:

- English
- Simplified Chinese
- Traditional Chinese
- Korean
- Japanese
- French
- German

Use the language selector above the Global Settings and Project Settings buttons to switch languages. The `Auto (VS Code)` option follows the VS Code display language. Unsupported or unknown languages fall back to English.

## Auto Save Chat History

You can configure automatic chat history saving:

1. Open the LLS OAI configuration panel
2. Scroll to "Save Chat History" section
3. Click "Settings" to configure:
   - **Auto Save Chat History**: Toggle to enable/disable
   - **Save Path**: Custom directory for saved chats (Default: Windows `%APPDATA%/LLSOAI`, macOS/Linux `~/.LLSOAI`)

Chat sessions are automatically saved as JSON files. When a conversation is compressed, an archive file is created with a timestamp.

## Custom System Prompt

Customize the system prompt that is sent with every chat request. This is useful for adding persistent instructions, coding style preferences, or project-specific context.

### Features

- **Global System Prompt**: Applies to all VS Code projects (user settings)
- **Workspace System Prompt**: Applies only to the current project (workspace settings)
- **Dual Input**: Both prompts can be used simultaneously — they are merged into a single system message
- **User Message Appendix**: Custom prompts are also appended to the last user message for better model adherence

### How to Configure

1. Open the LLS OAI configuration panel
2. Scroll to **System Prompt** section
3. Click **Edit** to open the modal
4. Fill in:
   - **Global System Prompt**: Your personal default instructions (applies everywhere)
   - **Workspace System Prompt**: Project-specific instructions (applies only to this workspace)
5. Click **Save**

### Debug

The merged system message content is written to `~/.LLSOAI/system.txt` for verification.

## Copilot Records Migration

Migrate your Copilot chat records between different machines:

### Export
1. Click "Export" in the Copilot Records section
2. The extension will find your current project's chat records in VS Code storage
3. Records are saved to `.LLSOAI/<timestamp>/` folder in your project

### Import
1. Place the exported `.LLSOAI/<timestamp>/` folder into your project's `.LLSOAI/` directory
2. Click "Import" in the Copilot Records section
3. The extension will find the latest exported records and copy them to VS Code storage
4. Close and reopen VS Code to load the migrated chat records

## Changelog

### 2.1.0

- **Multi-language UI**: Added UI language selection with English, Simplified Chinese, Traditional Chinese, Korean, Japanese, French, and German support
- **Auto Language Detection**: The Auto option follows the VS Code display language and falls back to English when the language is unsupported
- **Localized Configuration UI**: Provider management, settings panels, modals, validation messages, and dynamic UI text are localized

### 2.0.0

- **Enhanced TODO Settings**: Renamed "Force TODO" to "Enhanced TODO" throughout the configuration UI for clearer terminology
- **Mandatory TODO Tool Usage**: When Enhanced TODO is enabled, the model is now strongly instructed to use the TODO tool before taking any action, with clear requirements that all TODO items must be detailed, specific, and include actionable steps
- **Global & Project System Prompt Settings**: Added global and workspace-scoped system prompt settings with dual input fields in the configuration UI. System prompts are appended to user messages for better model adherence

### 1.3.3

- **Custom System Prompt**: Global and workspace-scoped custom system prompts with dual input fields in configuration UI
- **System Prompt Merging**: Multiple system prompt sources (global, workspace, VS Code Copilot) are merged into a single system message
- **User Message Prompt Appendix**: Custom prompts are also appended to the last user message for better model adherence

### 1.3.0

- **Anthropic API Support**: Full support for Anthropic Messages API (`/v1/messages`) alongside OpenAI-compatible endpoints
- **Automatic Format Conversion**: Bidirectional conversion between OpenAI and Anthropic formats

## License

MIT

## Support

For issues and feature requests, please open an issue on the repository.
