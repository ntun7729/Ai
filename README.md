# AI Website Worker

A small AI chat website designed for Cloudflare Workers and deployed with Wrangler. The backend talks to an OpenAI-compatible `/v1/chat/completions` API, while the frontend is plain browser JavaScript.

The project is split into small files so each part is easy to debug and replace.

## Project structure

```text
public/
  index.html          Browser UI shell
  styles.css          Website styling
  js/
    api.js            Browser API client
    chat.js           Chat state and submit flow
    dom.js            UI rendering helpers
    main.js           Browser entrypoint
src/
  ai/
    chat-handler.ts   `/api/chat` request handler
    client.ts         OpenAI-compatible API client
    types.ts          Shared AI request/response types
    validation.ts     Request body validation
  config/
    env.ts            Worker environment config
  http/
    cors.ts           CORS helpers
    json.ts           JSON response helpers
    router.ts         Route dispatcher
  types/
    env.ts            Cloudflare Worker bindings
  index.ts            Worker entrypoint
```

## Setup

Install dependencies:

```bash
npm install
```

Create a local dev secret file from the example:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and add your API key:

```bash
AI_API_KEY=your_api_key_here
```

For deployed Workers, store the secret in Cloudflare:

```bash
npx wrangler secret put AI_API_KEY
```

## Configure provider

The default configuration in `wrangler.jsonc` points to OpenAI:

```jsonc
"vars": {
  "AI_BASE_URL": "https://api.openai.com",
  "AI_MODEL": "gpt-4.1-mini"
}
```

For another OpenAI-compatible provider, change `AI_BASE_URL` and `AI_MODEL`.

Examples:

```jsonc
"AI_BASE_URL": "https://api.example.com",
"AI_MODEL": "provider-model-name"
```

## Run locally

```bash
npm run dev
```

Then open the local Wrangler URL and test the chat page.

## Type-check

```bash
npm run check
```

## Deploy

```bash
npm run deploy
```

## Current MVP

- Static chat website served from `public/`
- `/api/health` endpoint
- `/api/chat` endpoint
- OpenAI-compatible Chat Completions request
- Small, separated files instead of one large implementation

## Next ideas

- Streaming responses
- Model picker
- Chat history with KV or D1
- Authentication
- Rate limits
- File upload and RAG
- Admin panel for provider/model settings
