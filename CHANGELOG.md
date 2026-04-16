# Changelog

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
