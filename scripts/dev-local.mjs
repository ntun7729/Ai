import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const publicDir = join(root, "public");
const env = await loadDevVars(join(root, ".dev.vars"));
const port = Number(process.env.PORT || env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === "OPTIONS") {
      send(res, 204, "", corsHeaders());
      return;
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, getHealthInfo(env));
      return;
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      await handleChat(req, res, env);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown local server error";
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, host, () => {
  const health = getHealthInfo(env);
  console.log(`Local fallback server running at http://${host}:${port}`);
  console.log("Use this only when wrangler dev cannot start in your environment.");
  console.log(`AI_BASE_URL: ${health.aiBaseUrl}`);
  console.log(`AI_CHAT_URL: ${health.aiChatUrl}`);
  console.log(`AI_MODEL: ${health.aiModel}`);
  console.log(`AI_API_KEY loaded: ${health.hasApiKey ? "yes" : "no"}`);
});

async function handleChat(req, res, env) {
  const body = await readJsonBody(req);

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    sendJson(res, 400, { error: "Request body must include a non-empty messages array" });
    return;
  }

  const baseUrl = getBaseUrl(env);
  const apiKey = String(env.AI_API_KEY || "").trim();
  const model = getModel(env);
  const chatUrl = getChatCompletionsUrl(baseUrl);

  if (!apiKey) {
    sendJson(res, 500, { error: "Missing AI_API_KEY in .dev.vars" });
    return;
  }

  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      temperature: 0.7,
    }),
  });

  const text = await response.text();
  const data = parseProviderJson(text, chatUrl, model);

  if (!response.ok) {
    sendJson(res, response.status, {
      error: data?.error?.message || `AI provider returned HTTP ${response.status}`,
      provider: {
        baseUrl,
        chatUrl,
        model,
      },
    });
    return;
  }

  sendJson(res, 200, {
    answer: data?.choices?.[0]?.message?.content || "",
    model: data?.model,
    usage: data?.usage,
  });
}

function parseProviderJson(text, chatUrl, model) {
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.slice(0, 500) || "empty response body";
    throw new Error(`AI provider returned non-JSON response from ${chatUrl} using model ${model}: ${preview}`);
  }
}

function getHealthInfo(env) {
  const baseUrl = getBaseUrl(env);
  const model = getModel(env);

  return {
    ok: true,
    mode: "node-local",
    aiBaseUrl: baseUrl,
    aiChatUrl: getChatCompletionsUrl(baseUrl),
    aiModel: model,
    hasApiKey: Boolean(String(env.AI_API_KEY || "").trim()),
  };
}

function getBaseUrl(env) {
  return String(env.AI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
}

function getModel(env) {
  return String(env.AI_MODEL || "gpt-4.1-mini").trim();
}

function getChatCompletionsUrl(baseUrl) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

async function serveStatic(pathname, res) {
  const safePath = normalize(pathname).replace(/^\.\.(?:\\|\/|$)/, "");
  const filePath = join(publicDir, safePath === "/" ? "index.html" : safePath);
  const fallbackPath = join(publicDir, "index.html");
  const target = existsSync(filePath) ? filePath : fallbackPath;
  const content = await readFile(target);

  send(res, 200, content, {
    "Content-Type": contentType(target),
  });
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function loadDevVars(path) {
  const values = { ...process.env };

  if (!existsSync(path)) {
    return values;
  }

  const text = await readFile(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice("export ".length).trim();
    }

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }

  return values;
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...corsHeaders(),
    ...headers,
  });
  res.end(body);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
