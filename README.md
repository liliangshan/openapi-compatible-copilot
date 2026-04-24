# LLS OAI - OpenAI-compatible & Anthropic for Copilot Chat

A VS Code extension that integrates multiple OpenAI-compatible and Anthropic API providers into GitHub Copilot Chat.

## Features

- 🚀 **Multiple Provider Support** - Add and manage multiple OpenAI-compatible and Anthropic API providers
- 🔐 **Secure Key Storage** - API keys are stored securely using VS Code's secret storage
- 🎨 **Beautiful Configuration UI** - Easy-to-use webview interface for managing providers
- 🔌 **Copilot Integration** - Seamlessly integrates with GitHub Copilot Chat
- 📤 **Import/Export Config** - Backup and restore your provider configurations
- 💾 **Auto Save Chat History** - Automatically save chat conversations to local files
- 🔄 **Copilot Records Migration** - Import and export Copilot chat records between machines
- 🌐 **Multi-language UI** - Supports English, Simplified Chinese, Traditional Chinese, Korean, Japanese, French, and German. Auto mode follows the VS Code display language and falls back to English for unsupported languages
- 🖥️ **Global & Project System Prompt Settings** - Dual system prompt inputs (global + workspace-scoped) appended to user messages for better model adherence
- ✅ **Enhanced TODO Settings** - When enabled, the model is strongly instructed to create, track, and update all tasks through the TODO tool before taking any action

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
