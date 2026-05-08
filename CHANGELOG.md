# Changelog

## 2.5.0

### Added

- **Solution Provider** — A new dual-model workflow that delegates solution design, implementation planning, architecture proposal, risk analysis, and step-by-step plan generation to a dedicated solution model. Configure globally or per-workspace with full provider/model override support.

  - **Solution Model Delegation** — The main model can call `ask_solution_provider` to delegate structured solution tasks. The solution model generates actionable plans with goals, constraints, phased steps, risks, validation plans, and rollback strategies.
  - **Expert Review for Solutions** — Optional checkbox to require the solution model to call `ask_llsoai` for expert review before finalizing. Expert review results are consumed by the solution model first, then the revised final solution is returned to the main model.
  - **Three-State Workspace Control** — Per-workspace enabled state (`global` / `enabled` / `disabled`) and expert review state (`global` / `enabled` / `disabled`) for fine-grained control over solution provider behavior in different projects.
  - **Solution Draft Persistence** — Auto-generated workspace-relative draft paths (` .LLSOAI/Solution/drafts/`) that the solution model can optionally persist as Markdown for traceability and expert review quality.
  - **Structured Solution Results** — Solution models return structured output with `writeStatus`, `solutionSummary`, `solutionFile`/`fullSolutionInline`, and optional error/reason fields for reliable downstream processing.
  - **Safety Guards** — Recursive delegation prevention (solution model never sees `ask_solution_provider`), expert review count limits, forced review reminder limits with graceful degradation, and tool call prefix isolation (`llsoai_solution:` vs `llsoai:`).

## 2.4.0

### Added

- **Timeline Snapshot System** — A comprehensive file history management system with the following features:

  - **Auto Snapshot on Save**: Automatically creates timestamped snapshots when files are saved. Stores raw content to `~/.LLSOAI/History/<file-path>/snapshots/` with metadata tracking SHA-256, line count, and timestamps. Smart trimming keeps max 20 snapshots per file. Automatically excludes `.git`, `node_modules`, build directories, and secret files.

  - **Git Integration**: Intelligent git-aware cleanup that monitors `.git/HEAD`, `packed-refs`, and `refs/heads/**` for commit changes. Detects when files are removed by `git clean` and cleans corresponding snapshots. Supports Git worktree scenarios. Cleans snapshots of modified files while preserving metadata for tracking.

  - **Provider Built-in Timeline Tools**: Three built-in tools available in every provider:
    - `timeline_list_by_file`: Lists all snapshots for a file path with timestamps and SHA-256
    - `timeline_restore_snapshot`: Restores a file to a previous snapshot with safety checks (validates against metadata, refuses git-protected files, creates beforeRestore backup)
    - `timeline_read_snapshot_lines`: Reads partial content from snapshots with 1-based line numbers, max 200 lines per request

  - **Internal Tool Continuation**: Timeline tools support seamless multi-turn interactions with max 3 continuation rounds per conversation turn. Tool results are automatically appended to the conversation for exploring file history without leaving Copilot Chat.

## 2.3.0

### Added
- **Project-level Session Saving** — Dual-save mechanism that saves chat history to both global path (`~/.LLSOAI/`) and project path (`.LLSOAI/` organized by date). Each save location can be independently enabled or disabled, giving you flexible control over where your conversation history is stored.
- **Expert Mode Chat History Saving** — Automatically saves Expert Mode conversations to chat history. When the expert model completes streaming (whether it returns text or makes tool calls), the complete expert conversation context is preserved, including the user's question, expert responses, and tool interactions.

## 2.2.3

### Fixed
- Fixed Expert Mode getting stuck when VS Code returns only part of a multi-tool-call result batch. Missing expert tool calls are now re-reported so VS Code continues executing the remaining tools instead of ending the turn with a waiting message.

## 2.2.2

### Fixed
- Fixed Expert Mode continuation when the expert model emits multiple tool calls in one turn. The extension now waits for all corresponding tool results, preserves the original tool-result order, and queues user follow-up messages until pending tool results are complete.
- Added the configured expert model name to the Expert Mode startup message so users can see which expert model is being used for the delegated run.

## 2.2.1

### Fixed
- Fixed an issue where disabled providers disappeared from the provider list after Expert Mode settings were loaded. Disabled providers now remain visible in provider management, while Expert Mode provider selectors still only show enabled providers with selectable models.

## 2.2.0

### Added
- **Expert Mode** — A dual-model workflow that combines a fast, cost-effective main model with a high-tier expert model for review and supplementation. Enable mid/low-tier models (e.g., GPT-4o-mini, Claude Haiku) for daily development work, and bring in high-tier models (e.g., GPT-4o, Claude Sonnet/Opus) as expert reviewers when deeper insight is needed. The main model intelligently decides when to invoke the expert tool based on task difficulty, or you can explicitly ask it to delegate to the expert. Includes customizable expert behavior hints
- **Expert Mode UI Localization** — Full internationalization support for Expert Mode UI strings across English, Simplified Chinese, Traditional Chinese, Korean, Japanese, French, and German

## 2.1.0

### Added
- **Multi-language UI**: Added language selector support for English, Simplified Chinese, Traditional Chinese, Korean, Japanese, French, and German
- **Auto Language Detection**: Added Auto language mode that follows the VS Code display language and falls back to English for unsupported languages
- **Localized Configuration UI**: Localized provider management, settings panels, modals, validation messages, dynamic provider/model text, and language selector labels

### Changed
- **Language Labels**: Renamed the Chinese language option to "Simplified Chinese" and added "Traditional Chinese" directly below it

## 2.0.0

### Added
- **Enhanced TODO Settings**: Renamed "Force TODO" to "Enhanced TODO" throughout the configuration UI for clearer terminology
- **Mandatory TODO Tool Usage**: When Enhanced TODO is enabled, the model is now strongly instructed to use the TODO tool before taking any action, with clear requirements that all TODO items must be detailed, specific, and include actionable steps
- **Global & Project System Prompt Settings**: Added global and workspace-scoped system prompt settings with dual input fields in the configuration UI. System prompts are appended to user messages for better model adherence

## 1.3.3

### Added
- **Custom System Prompt**: Global and workspace-scoped custom system prompts with dual input fields in configuration UI
- **System Prompt Merging**: Multiple system prompt sources (global, workspace, VS Code Copilot) are merged into a single system message
- **User Message Prompt Appendix**: Custom prompts are also appended to the last user message for better model adherence
- **Debug System Output**: Writes merged system message content to `~/.LLSOAI/system.txt` for verification

## 1.3.0

### Added
- **Anthropic API Support**: Full support for Anthropic Messages API (`/v1/messages`) alongside OpenAI-compatible endpoints
- **Automatic Format Conversion**: Bidirectional conversion between OpenAI chat format and Anthropic Messages format, including:
  - Messages conversion (system/user/assistant/tool roles)
  - Tool definitions (`type: 'function'` → `input_schema`)
  - Tool choice mapping (`auto/none/required` → `auto/none/any`)
  - Streaming SSE event translation (Anthropic → OpenAI-style chunks)
- **Tool Calling for Anthropic**: Complete tool calling support with proper handling of:
  - `content_block_start` / `content_block_delta` / `content_block_stop` events
  - Empty parameter tools (no-argument tool calls)
  - Multi-tool calls in a single response
- **Consecutive User Message Merging**: Automatically merges consecutive user messages from VS Code Copilot context to comply with API requirements
- **Cross-Platform Debug Logging**: Error and debug file saving with automatic directory creation, works on macOS, Linux, and Windows

## 1.0.0

### Added
- **Auto Save Chat History**: Automatically save chat conversations to local files with configurable save path
- **Chat History Settings**: Settings modal with toggle switch and custom save path configuration
- **Session Archiving**: When conversation compression is detected (system prompt contains "create a comprehensive"), automatically archives the full conversation with timestamp
- **Cross-Platform Support**: Default save paths for Windows (`%APPDATA%/LLSOAI`) and macOS/Linux (`~/.LLSOAI`)
- **Copilot Records Import/Export**: Import and export Copilot chat records for migration between different machines
- **Export Records**: Finds the current project's workspace in VS Code storage and copies to `.LLSOAI/timestamp` folder in the project
- **Import Records**: Detects the latest exported records from `.LLSOAI`, finds the matched workspaceStorage directory by reading workspace.json, and copies all contents
- **Chat Records Section**: New UI section with Import/Export buttons and description

### File Format
- **Normal save**: `chat_<sessionId>.json` - overwrites on each update, always keeps latest session state
- **Archive save**: `chat-session-<timestamp>.json` - created when conversation is compressed, preserves the full history at that point

## 0.9.0

### Added
- **Copilot Records**: Import and export Copilot chat records for migration between different machines
- **Export Records**: Finds the current project's workspace in VS Code storage and copies to `.LLSOAI/timestamp` folder in the project
- **Import Records**: Detects the latest exported records from `.LLSOAI`, updates `workspace.json` folder path to current project, and copies to VS Code workspace storage
- **Chat Records Section**: New UI section with Import/Export buttons and description

## 0.8.0

### Added
- **Auto Save Chat History**: New feature to automatically save chat conversations to local files
- **Chat History Settings**: Settings modal with toggle switch and custom save path configuration
- **Session Archiving**: When conversation compression is detected (`<conversation-summary>`), automatically archives the full conversation with timestamp
- **Cross-Platform Support**: Default save paths for Windows (`%APPDATA%/LLSOAI`) and macOS/Linux (`~/.LLSOAI`)
- **Chat History Section**: New "Auto Save Chat History" section in the provider management UI with settings button

### File Format
- **Normal save**: `chat_<sessionId>.json` - overwrites on each update, always keeps latest session state
- **Archive save**: `chat-session-<timestamp>.json` - created when conversation is compressed, preserves the full history at that point

## 0.7.0

### Added
- **Auto Fetch Models**: New toggle option in provider settings to automatically fetch available models when adding/editing a provider
- **Smart Button Logic**: Provider cards now show "Fetch Models" button for providers with Auto Fetch enabled, and "+ Add Model" button for manual model management
- **Enhanced Model Selection**: Model selector with toggle switches for easy enable/disable of individual models
- **Backend Toggle Handler**: New `toggleAutoFetchModels` handler for real-time toggling from provider cards

### Fixed
- **Event Handling**: Fixed conflict between click and change events on toggle switches - model toggles no longer affect the Auto Fetch Models toggle
- **API Key Preservation**: Fixed API key being cleared when editing a provider without entering a new key
- **Loading State Cleanup**: Fetch errors now properly clear the loading state

### Improved
- **User Experience**: Better visual distinction between auto-fetch and manual model management workflows
- **Modal Form**: Added Auto Fetch Models checkbox to Add/Edit provider modal for easy configuration

## 0.1.0

### Added
- Initial release
- Support for multiple OpenAI-compatible API providers
- Webview-based configuration UI
- Secure API key storage using VS Code secrets
- Import/Export configuration
- Integration with GitHub Copilot Chat
- Model configuration per provider
- Toggle providers on/off
