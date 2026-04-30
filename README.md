# LLS OAI - OpenAI-compatible & Anthropic for Copilot Chat

A VS Code extension that integrates multiple OpenAI-compatible and Anthropic API providers into GitHub Copilot Chat.

## Features

- 🚀 **Multiple Provider Support** - Add and manage multiple OpenAI-compatible and Anthropic API providers
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
