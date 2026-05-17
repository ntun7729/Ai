import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { addSearchContext } from "./search-local.mjs";
import {
  addLocalMemory,
  addLocalMemoryContext,
  captureLocalMemoryFromText,
  clearLocalMemories,
  deleteLocalMemory,
  initLocalMemory,
  latestUserText,
  listLocalMemories,
  localMemoryStorageInfo,
} from "./memory-local.mjs";

const root = process.cwd();
const publicDir = join(root, "public");
const env = await loadDevVars(join(root, ".dev.vars"));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || env.PORT || 8787);
const URL_PATTERN = /https?:\/\/[^\s<>)"']+/i;

await initLocalMemory();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === "OPTIONS") return send(res, 204, "");
    if (url.pathname === "/api/health" && req.method === "GET") return sendJson(res, 200, await health());
    if (url.pathname === "/api/models" && req.method === "GET") { await handleModels(res); return; }
    if (url.pathname === "/api/chat" && req.method === "POST") { await handleChat(req, res); return; }
    if (url.pathname === "/api/title" && req.method === "POST") { await handleTitle(req, res); return; }
    if (url.pathname === "/api/memory" || url.pathname === "/api/memory/clear" || url.pathname.startsWith("/api/memory/")) { await handleMemory(req, res, url); return; }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const msg = message(error);
    log("error", { message: msg });
    sendJson(res, 500, { error: msg });
  }
}).listen(port, host, async () => {
  const info = await health();
  console.log(`Local fallback server running at http://${host}:${port}`);
  console.log("Use this only when wrangler dev cannot start in your environment.");
  console.log(`AI_BASE_URL: ${info.aiBaseUrl}`);
  console.log(`AI_CHAT_URL: ${info.aiChatUrl}`);
  console.log(`AI_MODELS_URL: ${info.aiModelsUrl}`);
  console.log(`AI_MODEL: ${info.aiModel}`);
  console.log(`AI_API_KEY loaded: ${info.hasApiKey ? "yes" : "no"}`);
  console.log(`Memory storage: ${info.memoryStorage}`);
});

async function handleModels(res) {
  const startedAt = Date.now();
  const modelsUrl = modelsEndpoint();
  const defaultModel = modelFromEnv();

  if (!apiKey()) return sendJson(res, 500, { error: "Missing AI_API_KEY in .dev.vars" });

  log("models.request", { modelsUrl, defaultModel });
  const response = await fetch(modelsUrl, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
  });
  const text = await response.text();
  const data = parseJson(text);

  log("models.response", {
    status: response.status,
    durationMs: Date.now() - startedAt,
    bodyPreview: response.ok ? undefined : preview(text),
  });

  if (!response.ok) return sendJson(res, response.status, { error: data?.error?.message || preview(text) });

  const models = Array.isArray(data?.data)
    ? data.data.map((item) => ({ id: String(item?.id || "").trim() })).filter((item) => item.id).sort((a, b) => a.id.localeCompare(b.id))
    : [];

  log("models.loaded", { count: models.length });
  return sendJson(res, 200, { models, defaultModel });
}

async function handleMemory(req, res, url) {
  const storage = await localMemoryStorageInfo();

  if (url.pathname === "/api/memory" && req.method === "GET") {
    return sendJson(res, 200, { memories: await listLocalMemories(), storage });
  }

  if (url.pathname === "/api/memory" && req.method === "POST") {
    const body = await readJson(req);
    const content = String(body.content || "").trim();
    if (!content) return sendJson(res, 400, { error: "Memory content is required" });
    const memory = await addLocalMemory(content, { type: body.type || "fact", source: body.source || "manual" });
    return sendJson(res, 200, { memory, storage });
  }

  if (url.pathname === "/api/memory/clear" && req.method === "POST") {
    await clearLocalMemories();
    return sendJson(res, 200, { ok: true, storage });
  }

  const deleteMatch = url.pathname.match(/^\/api\/memory\/([^/]+)$/);
  if (deleteMatch && req.method === "DELETE") {
    await deleteLocalMemory(decodeURIComponent(deleteMatch[1]));
    return sendJson(res, 200, { ok: true, storage });
  }

  return sendJson(res, 404, { error: "Memory route not found" });
}

async function handleChat(req, res) {
  const startedAt = Date.now();
  const body = await readJson(req);
  const model = cleanModel(body.model) || modelFromEnv();
  const requestedThinking = body.thinking === true;
  const thinking = shouldSendThinking(model, requestedThinking);
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const memoryEnabled = body.memory !== false;
  const wantsSearch = body.webSearch === true || messageWantsSearch(rawMessages.at(-1)?.content);

  if (!apiKey()) return sendJson(res, 500, { error: "Missing AI_API_KEY in .dev.vars" });
  if (rawMessages.length === 0) return sendJson(res, 400, { error: "Request body must include a non-empty messages array" });

  if (memoryEnabled) await captureLocalMemoryFromText(latestUserText(rawMessages));
  const memoryMessages = await addLocalMemoryContext(rawMessages, memoryEnabled);
  const messages = wantsSearch ? await addSearchContext(env, memoryMessages, log) : memoryMessages;

  log("chat.request", {
    model,
    thinking,
    requestedThinking,
    webSearch: wantsSearch,
    memory: memoryEnabled,
    memoryStorage: await localMemoryStorageInfo(),
    messageCount: messages.length,
    lastRole: rawMessages.at(-1)?.role,
    lastTextPreview: previewContent(rawMessages.at(-1)?.content),
    chatUrl: chatEndpoint(),
  });

  const payload = { model, messages, temperature: 1, top_p: 1, max_tokens: 16384, stream: true };
  if (thinking) payload.chat_template_kwargs = { enable_thinking: true, clear_thinking: false };

  const response = await callProvider(payload, "text/event-stream, application/json");
  const text = await response.text();

  log("chat.provider_response", {
    model,
    thinking,
    status: response.status,
    durationMs: Date.now() - startedAt,
    bodyPreview: response.ok ? undefined : preview(text),
  });

  if (!response.ok) {
    const data = parseJson(text);
    return sendJson(res, response.status, { error: data?.error?.message || preview(text), provider: { model, thinking, messageCount: messages.length } });
  }

  const answer = providerAnswerOrEmpty(text);
  if (!answer) {
    log("chat.empty_answer", { model, bodyPreview: preview(text) });
    return sendJson(res, 200, { answer: "The provider returned an empty answer. Please try again.", model });
  }

  log("chat.answer", { model, answerPreview: preview(answer) });
  return sendJson(res, 200, { answer, model });
}

async function handleTitle(req, res) {
  const startedAt = Date.now();
  const body = await readJson(req);
  const model = cleanModel(body.model) || modelFromEnv();
  const question = String(body.userMessage || "").trim().slice(0, 900);
  const answer = String(body.assistantMessage || "").trim().slice(0, 900);

  if (!apiKey()) return sendJson(res, 500, { error: "Missing AI_API_KEY in .dev.vars" });
  if (!question || !answer) return sendJson(res, 400, { error: "userMessage and assistantMessage are required" });

  log("title.request", { model, userPreview: preview(question), assistantPreview: preview(answer) });

  const payload = {
    model,
    messages: [
      { role: "system", content: "Write a short topic label for the sidebar. Output only the label. Five words maximum." },
      { role: "user", content: `Question: ${question}\nAnswer: ${answer}` },
    ],
    temperature: 0.1,
    top_p: 1,
    max_tokens: 48,
    stream: false,
  };

  const response = await callProvider(payload, "application/json");
  const text = await response.text();

  log("title.provider_response", {
    model,
    status: response.status,
    durationMs: Date.now() - startedAt,
    bodyPreview: preview(text),
  });

  if (!response.ok) {
    const data = parseJson(text);
    const title = fallbackTitle(question);
    log("title.fallback", { model, reason: data?.error?.message || preview(text), title });
    return sendJson(res, 200, { title });
  }

  const title = cleanTitle(providerAnswerOrEmpty(text)) || fallbackTitle(question);
  log("title.answer", { model, title });
  return sendJson(res, 200, { title });
}

function shouldSendThinking(model, thinking) {
  if (!thinking) return false;
  const lower = model.toLowerCase();
  if (lower.includes("mistral") || lower.includes("mixtral")) return false;
  return true;
}

function messageWantsSearch(content) {
  const text = Array.isArray(content)
    ? content.find((part) => part?.type === "text")?.text || ""
    : String(content || "");
  return URL_PATTERN.test(text) || /\b(web\s*search|websearch|search web|latest news|today news|current news)\b/i.test(text);
}

function callProvider(payload, accept) {
  return fetch(chatEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(payload),
  });
}

function providerAnswerOrEmpty(text) {
  const json = parseJson(text);
  const direct = json?.choices?.[0]?.message?.content;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  let content = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const chunk = parseJson(payload);
    const part = chunk?.choices?.[0]?.delta?.content;
    if (typeof part === "string") content += part;
  }

  return content.trim();
}

async function serveStatic(pathname, res) {
  const safePath = normalize(pathname).replace(/^\.\.(?:\\|\/|$)/, "");
  const filePath = join(publicDir, safePath === "/" ? "index.html" : safePath);
  const target = existsSync(filePath) ? filePath : join(publicDir, "index.html");
  return send(res, 200, await readFile(target), { "Content-Type": contentType(target) });
}

async function health() {
  return { ok: true, mode: "node-local", aiBaseUrl: baseUrl(), aiChatUrl: chatEndpoint(), aiModelsUrl: modelsEndpoint(), aiModel: modelFromEnv(), hasApiKey: Boolean(apiKey()), memoryStorage: await localMemoryStorageInfo() };
}
function baseUrl() { return String(env.AI_BASE_URL || "https://api.openai.com").replace(/\/+$/, ""); }
function apiKey() { return String(env.AI_API_KEY || env.NVIDIA_API_KEY || "").trim(); }
function modelFromEnv() { return String(env.AI_MODEL || "gpt-4.1-mini").trim(); }
function chatEndpoint() { return baseUrl().endsWith("/v1") ? `${baseUrl()}/chat/completions` : `${baseUrl()}/v1/chat/completions`; }
function modelsEndpoint() { return baseUrl().endsWith("/v1") ? `${baseUrl()}/models` : `${baseUrl()}/v1/models`; }
function cleanModel(value) { return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,160}$/.test(value.trim()) ? value.trim() : ""; }
function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }
function preview(value) { return String(value || "").replace(/\s+/g, " ").slice(0, 240); }
function previewContent(value) { return Array.isArray(value) ? value.map((part) => part?.type || "part").join(",") : preview(value); }
function fallbackTitle(value) { return String(value || "").replace(/[.!?]+$/g, "").trim().split(/\s+/).slice(0, 5).join(" ") || "New chat"; }
function cleanTitle(value) {
  const title = fallbackTitle(String(value || "").replace(/^Title:\s*/i, "").replace(/["'`]/g, ""));
  const lower = title.toLowerCase();
  return ["the user", "user gave", "assistant", "conversation", "response", "answer"].some((start) => lower.startsWith(start)) ? "" : title;
}
function message(error) { return error instanceof Error ? error.message : String(error); }
async function readJson(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const raw = Buffer.concat(chunks).toString("utf8"); return raw ? JSON.parse(raw) : {}; }
async function loadDevVars(path) {
  const values = { ...process.env };
  if (!existsSync(path)) return values;
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, "");
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}
function sendJson(res, status, data) { return send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8" }); }
function send(res, status, body, headers = {}) { res.writeHead(status, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", ...headers }); res.end(body); }
function contentType(path) { return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" }[extname(path)] || "application/octet-stream"; }
function log(event, details = {}) { console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details })); }
