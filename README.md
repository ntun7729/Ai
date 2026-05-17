# AI Website Worker

A mobile-friendly AI chat website built for Cloudflare Workers and Wrangler. The backend calls an OpenAI-compatible `/v1/chat/completions` provider, and the frontend is plain browser JavaScript split into small files so each part is easy to debug.

The current default provider configuration points to NVIDIA's OpenAI-compatible endpoint, but the app can work with any provider that follows the Chat Completions API shape.

## Current features

- ChatGPT-like dark mobile UI
- Cloudflare Worker backend
- OpenAI-compatible chat completion calls
- Dynamic model list from the provider `/models` endpoint
- Custom **Intelligence** model picker with search, suggested models, and selected-model checkmark
- Thinking toggle for models that support reasoning/thinking parameters
- Worker-side web search toggle
- Image upload support for vision-capable models
- Code block rendering with language labels and copy buttons
- Copy response button for assistant messages
- Persistent browser chat history using `localStorage`
- Manual conversation delete from the sidebar
- Local fallback server for environments where `wrangler dev` cannot start
- Small, separated files instead of one large implementation

## Project structure

```text
public/
  index.html              Browser UI shell
  styles.css              Base layout and chat styling
  controls.css            Model picker, toggles, and sidebar controls
  mobile.css              Mobile responsive behavior
  attachments.css         Attachments, Markdown cards, code blocks, copy buttons
  js/
    api.js                Browser API client
    chat.js               Chat state, model picker, persistence, submit flow
    dom.js                UI rendering helpers
    main.js               Browser entrypoint
    markdown.js           Safe Markdown, table cards, and code block renderer
    markdown-patch.js     Renders assistant Markdown and copy actions
scripts/
  dev-local.mjs           Local fallback server
  search-local.mjs        Local web-search helper
src/
  ai/
    chat-handler.ts       `/api/chat` request handler
    client.ts             OpenAI-compatible provider client
    title-handler.ts      Conversation title helper
    types.ts              Shared AI request/response types
    validation.ts         Request body validation
  config/
    env.ts                Worker environment config
  http/
    cors.ts               CORS helpers
    json.ts               JSON response helpers
    router.ts             Route dispatcher
  search/
    web-search.ts         Worker-side search context builder
  types/
    env.ts                Cloudflare Worker bindings
  index.ts                Worker entrypoint
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

Edit `.dev.vars` and add your provider key:

```bash
AI_API_KEY=your_api_key_here
```

The app also accepts `NVIDIA_API_KEY` as an alternative secret name.

Optional local overrides:

```bash
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_MODEL=openai/gpt-oss-120b
SEARCH_PROXY_URL=https://your-search-proxy.example.com/search
```

`SEARCH_PROXY_URL` is optional. The Worker first tries direct search fetches. If direct search fetches fail, this URL can be used as a proxy/fallback endpoint.

## Configure provider

The default Worker configuration is in `wrangler.jsonc`:

```jsonc
"vars": {
  "AI_BASE_URL": "https://integrate.api.nvidia.com/v1",
  "AI_MODEL": "z-ai/glm-5.1"
}
```

For another OpenAI-compatible provider, update:

```jsonc
"AI_BASE_URL": "https://api.example.com/v1",
"AI_MODEL": "provider-model-name"
```

The code automatically builds these provider endpoints:

```text
{AI_BASE_URL}/chat/completions
{AI_BASE_URL}/models
```

## Run locally

Recommended normal Wrangler dev server:

```bash
npm run dev
```

If `wrangler dev` fails in your Android/Linux/container environment, use the fallback Node server:

```bash
npm run dev:local
```

Then open:

```text
http://127.0.0.1:8787
```

For testing from another device on the same network, use:

```bash
npm run dev:open
```

Then open the host machine's LAN IP with port `8787`.

## Type-check

```bash
npm run check
```

## Deploy

Store the provider API key in Cloudflare:

```bash
npx wrangler secret put AI_API_KEY
```

Then deploy:

```bash
npm run deploy
```

## How chat history works

Conversation history is stored in the browser's `localStorage`.

This means:

- refreshing the page keeps conversations
- closing and reopening the same browser keeps conversations
- deleting must be done manually with the sidebar delete button
- history is local to that browser/device
- clearing browser data removes saved conversations
- image conversations are saved safely; after refresh, attached images become text placeholders instead of storing large base64 images forever

Future improvement: export/import chat history or store history in Cloudflare KV/D1 for sync across devices.

## Web search behavior

When the **Web search** toggle is enabled, the app tries to fetch search results inside the Worker before calling the AI model. The search context is then added to the model prompt so the model can summarize recent results instead of inventing current facts.

Current search flow:

1. Google News RSS search
2. DuckDuckGo Lite search
3. Optional `SEARCH_PROXY_URL` fallback

The model is instructed to summarize results, explain why they matter, and avoid dumping long raw URLs.

## Image support

The composer has a `+` menu for image/file actions. Image upload sends OpenAI-compatible multimodal content:

```json
[
  { "type": "text", "text": "Describe this image" },
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
]
```

Use a vision-capable model such as:

```text
mistralai/mistral-small-4-119b-2603
```

If a model does not support images, the provider may return an error.

## Thinking toggle

Some provider models accept reasoning/thinking parameters, while others reject them. Keep **Thinking** off by default unless the selected model supports it.

If you see errors like tokenizer/template/function errors after enabling thinking, disable the toggle and retry.

## Development workflow

Use this loop while building:

```bash
git pull
npm run check
npm run dev:local
```

On mobile, refresh with a cache-busting query when UI files change:

```text
http://127.0.0.1:8787/?v=latest
```

## Roadmap ideas

- Streaming responses
- Export/import conversations
- Cloudflare KV or D1 synced chat history
- Rename conversations manually
- Better model filtering by capability: chat, vision, coding, embedding, audio
- Provider settings screen
- Authentication
- Rate limits
- File upload and RAG
- Admin panel for provider/model settings
