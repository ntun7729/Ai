# Memory storage plan

This project now supports long-term memory with a local-first path.

## Local development

Local fallback server uses:

```text
data/ai-local.db
```

The server tries Node's built-in SQLite module first. If that is unavailable, it falls back to:

```text
data/ai-local-memory.json
```

Both are ignored by Git.

Run local as usual:

```bash
git pull
npm run check
npm run dev:local
```

The local server prints the active memory storage mode:

```text
Memory storage: sqlite
```

or:

```text
Memory storage: json
```

## Memory API

The same API shape is used for local and future Worker/D1 storage:

```text
GET    /api/memory
POST   /api/memory
DELETE /api/memory/:id
POST   /api/memory/clear
```

Example manual add:

```bash
curl -X POST http://127.0.0.1:8787/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"content":"User prefers moonshotai/kimi-k2.6","type":"preference"}'
```

Example list:

```bash
curl http://127.0.0.1:8787/api/memory
```

## Chat memory behavior

When the Memory toggle is enabled:

1. The backend checks the latest user message.
2. If the message looks like a memory command, it saves it.
3. Existing memories are injected into the next model request as system context.

Examples that save memory:

```text
Remember that my favorite model is moonshotai/kimi-k2.6
My name is Tun
We are building an AI website on Cloudflare Worker
```

Examples that clear memory:

```text
Forget memory
Clear all memories
Delete remembered memory
```

## Cloudflare D1 later

The Worker-side code already has a D1 memory store. To enable it after local testing:

```bash
npx wrangler d1 create ai-memory
```

Add the returned database id to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ai-memory",
    "database_id": "PASTE_ID_HERE"
  }
]
```

Apply migration locally and remotely:

```bash
npx wrangler d1 migrations apply ai-memory --local
npx wrangler d1 migrations apply ai-memory --remote
```

Then deploy:

```bash
npm run deploy
```

## Files

```text
migrations/0001_memories.sql      D1 schema
scripts/memory-local.mjs          local SQLite/JSON memory store
src/memory/store.ts               Worker D1 memory store
src/memory/handler.ts             Worker memory API endpoints
public/js/memory.js               memory toggle and clear button
```
