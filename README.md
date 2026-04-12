# OpenAPI Compatible Provider for Copilot

A VS Code extension that integrates multiple OpenAI-compatible API providers into GitHub Copilot Chat.

## Features

- 🚀 **Multiple Provider Support** - Add and manage multiple OpenAI-compatible API providers
- 🔐 **Secure Key Storage** - API keys are stored securely using VS Code's secret storage
- 🎨 **Beautiful Configuration UI** - Easy-to-use webview interface for managing providers
- 📦 **No Extension Settings** - All configuration through the intuitive UI, no settings.json clutter
- 🔌 **Copilot Integration** - Seamlessly integrates with GitHub Copilot Chat
- 📤 **Import/Export** - Backup and restore your configurations

## Requirements

- VS Code 1.104.0 or higher
- GitHub Copilot Chat extension

## Getting Started

1. Install the extension
2. Click on the "LLS OAI" status bar item or use the command palette: `LLS OAI: Manage Providers`
3. Click "Add Provider" to configure your first provider
4. Fill in:
   - **Vendor Name/Flag**: A unique identifier for this provider (e.g., "MyOpenAI", "LocalLLM")
   - **Base URL**: The OpenAI-compatible API endpoint (e.g., `https://api.openai.com/v1`)
   - **API Key**: Your API key for authentication
   - **Models**: Add one or more models with their configurations
5. Save and start using your provider in Copilot Chat!

## Provider Configuration

Each provider requires:

- **Name**: Unique identifier shown in Copilot
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

## Development

### Setup

```bash
npm install
npm run compile
```

### Watch Mode

```bash
npm run watch
```

### Package Extension

```bash
npm run package
```

## License

MIT

## Support

For issues and feature requests, please open an issue on the repository.
