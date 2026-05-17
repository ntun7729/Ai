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

    if (url.pathname === "/api/models" && req.method === "GET") {
      await handleModels(res, env);
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

async function handleModels(res, env) {
  const baseUrl = getBaseUrl(env);
  const apiKey = getApiKey(env);
  const defaultModel = getModel(env);

  if (!apiKey) {
    sendJson(res, 500, { error: "Missing AI_API_KEY in .dev.vars" });
    return;
  }

  const response = await fetch(getModelsUrl(baseUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    sendJson(res, response.status, { error: data?.error?.message || text.slice(0, 500) || "Failed to load models" });
    return;
  }

  const models = Array.isArray(data?.data)
    ? data.data
        .map((model) => ({ id: String(model?.id || "").trim() }))
        .filter((model) => model.id.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];

  sendJson(res, 200, { models, defaultModel });
}

async function handleChat(req, res, env) {
  const body = await readJsonBody(req);

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    sendJson(res, 400, { error: "Request body must include a non-empty messages array" });
    return;
  }

  const baseUrl = getBaseUrl(env);
  const apiKey = getApiKey(env);
  const model = sanitizeModel(body.model) || getModel(env);
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
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      temperature: 1,
      top_p: 1,
      max_tokens: 16384,
      stream: true,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    const data = parseJson(text);
    sendJson(res, response.status, {
      error: data?.error?.message || text.slice(0, 500) || `AI provider returned HTTP ${response.status}`,
      provider: {
        baseUrl,
        chatUrl,
        model,
      },
    });
    return;
  }

  const data = parseProviderResponse(text, model, chatUrl);

  sendJson(res, 200, {
    answer: data?.choices?.[0]?.message?.content || "",
    model: data?.model || model,
    usage: data?.usage,
  });
}

function parseProviderResponse(text, model, chatUrl) {
  const json = parseJson(text);
  if (json) return json;

  const answer = parseServerSentEvents(text);
  if (answer) {
    return {
      model,
      choices: [
        {
          message: {
            role: "assistant",
            content: answer,
          },
        },
      ],
    };
  }

  const preview = text.slice(0, 500) || "empty response body";
  throw new Error(`AI provider returned non-JSON response from ${chatUrl} using model ${model}: ${preview}`);
}

function parseServerSentEvents(text) {
  let answer = "";

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;

    const chunk = parseJson(payload);
    const content = chunk?.choices?.[0]?.delta?.content;

    if (typeof content === "string") {
      answer += content;
    }
  }

  return answer;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
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
    aiModelsUrl: getModelsUrl(baseUrl),
    aiModel: model,
    hasApiKey: Boolean(getApiKey(env)),
  };
}

function getBaseUrl(env) {
  return String(env.AI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
}

function getApiKey(env) {
  return String(env.AI_API_KEY || env.NVIDIA_API_KEY || "").trim();
}

function getModel(env) {
  return String(env.AI_MODEL || "gpt-4.1-mini").trim();
}

function sanitizeModel(value) {
  if (typeof value !== "string") return "";

  const model = value.trim();
  if (!/^[A-Za-z0-9._:/-]+$/.test(model) || model.length > 160) {
    return "";
  }

  return model;
}

function getChatCompletionsUrl(baseUrl) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

function getModelsUrl(baseUrl) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
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
