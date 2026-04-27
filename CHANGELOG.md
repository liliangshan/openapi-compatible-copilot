# Changelog

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
