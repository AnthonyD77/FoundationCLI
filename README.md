# Foundation CLI 

## About

This project is a fork of [Gemini CLI](https://github.com/google-gemini/gemini-cli) with extended multi-model support.

## Features

- 🚀 Support for any OpenAI API-compatible models (Qwen, DeepSeek, etc.)
- 📁 File reading and writing capabilities
- 💻 Shell command execution
- 🔧 Simple configuration via JSON

## Quickstart

### Prerequisites

- Node.js 18 or higher
- OpenAI SDK installed

### Installation

1. **Clone the repository to local**
2. **Configuration** \
Edit the `custom-model-config.json` in the project root
```json
{
  "apiEndpoint": "https://your-custom-endpoint.com/v1",
  "apiKey": "your-api-key",
  "modelCode": "your-model-name"
}
```
3. **Build and run:**
```bash
> npm run build
> npm start
```