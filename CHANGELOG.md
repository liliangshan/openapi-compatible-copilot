# Changelog

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
