import { randomUUID } from "node:crypto";
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
  saveLocalMessage,
  upsertLocalConversation,
} from "./memory-local.mjs";

const root = process.cwd();
const publicDir = join(root, "public");
const env = await loadDevVars(join(root, ".dev.vars"));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || env.PORT || 8787);
const URL_PATTERN = /https?:\/\/[^\s<>)"']+/i;
const ADMIN_COOKIE_NAME = "ai_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const localAdminSessions = new Set();

await initLocalMemory();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === "OPTIONS") return send(res, 204, "");
    if (url.pathname === "/api/health" && req.method === "GET") return sendJson(res, 200, await health());
    if (url.pathname.startsWith("/api/admin/")) { await handleAdmin(req, res, url); return; }
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
  console.log(`Admin password configured: ${info.hasAdminPassword ? "yes" : "no"}`);
  console.log(`Memory storage: ${info.memoryStorage}`);
});

async function handleAdmin(req, res, url) {
  if (url.pathname === "/api/admin/status" && req.method === "GET") {
    return sendJson(res, 200, {
      configured: Boolean(adminPassword()),
      authenticated: isLocalAdminAuthenticated(req),
    });
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const expected = adminPassword();
    if (!expected) return sendJson(res, 500, { error: "ADMIN_PASSWORD is not configured" });

    const body = await readJson(req);
    const password = String(body.password || "");
    if (password !== expected) return sendJson(res, 401, { error: "Invalid admin password" });

    const token = randomUUID();
    localAdminSessions.add(token);
    return sendJson(res, 200, { ok: true, authenticated: true }, {
      "Set-Cookie": `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
    });
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    const token = readCookie(req, ADMIN_COOKIE_NAME);
    if (token) localAdminSessions.delete(token);
    return sendJson(res, 200, { ok: true, authenticated: false }, {
      "Set-Cookie": `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    });
  }

  return sendJson(res, 404, { error: "Admin route not found" });
}

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
  const wantsClientStream = body.stream === true || String(req.headers.accept || "").includes("text/event-stream");
  const conversationId = cleanConversationId(body.conversationId) || conversationIdFromMessages(rawMessages);
  const conversationTitle = String(body.conversationTitle || fallbackTitle(latestUserText(rawMessages))).slice(0, 120);
  const latestText = latestUserText(rawMessages);

  if (!apiKey()) return sendJson(res, 500, { error: "Missing AI_API_KEY in .dev.vars" });
  if (rawMessages.length === 0) return sendJson(res, 400, { error: "Request body must include a non-empty messages array" });

  await upsertLocalConversation({ id: conversationId, title: conversationTitle, model });
  await saveLocalMessage({ conversationId, title: conversationTitle, model, role: "user", content: rawMessages.at(-1)?.content || latestText });
  if (memoryEnabled) await captureLocalMemoryFromText(latestText);
  const memoryMessages = await addLocalMemoryContext(rawMessages, memoryEnabled);
  const messages = wantsSearch ? await addSearchContext(env, memoryMessages, log) : memoryMessages;

  log("chat.request", {
    model,
    thinking,
    requestedThinking,
    webSearch: wantsSearch,
    stream: wantsClientStream,
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

  log("chat.provider_response", {
    model,
    thinking,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });

  if (!response.ok) {
    const text = await response.text();
    const data = parseJson(text);
    return sendJson(res, response.status, { error: data?.error?.message || preview(text), provider: { model, thinking, messageCount: messages.length } });
  }

  if (wantsClientStream) {
    await streamProviderToClient(res, response, {
      model,
      conversationId,
      conversationTitle,
      startedAt,
    });
    return;
  }

  const text = await response.text();
  const answer = providerAnswerOrEmpty(text);
  if (!answer) {
    log("chat.empty_answer", { model, bodyPreview: preview(text) });
    return sendJson(res, 200, { answer: "The provider returned an empty answer. Please try again.", model });
  }

  await saveLocalMessage({ conversationId, title: conversationTitle, model, role: "assistant", content: answer });
  log("chat.answer", { model, answerPreview: preview(answer) });
  return sendJson(res, 200, { answer, model });
}

async function streamProviderToClient(res, response, { model, conversationId, conversationTitle, startedAt }) {
  const contentType = response.headers.get("content-type") || "";
  const encoderHeaders = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };

  res.writeHead(200, cors(encoderHeaders));

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let answer = "";
  let sentAnyContent = false;

  try {
    if (!response.body || contentType.includes("application/json")) {
      const text = await response.text();
      const directAnswer = providerAnswerOrEmpty(text);
      if (directAnswer) {
        answer += directAnswer;
        sentAnyContent = true;
        send("delta", { content: directAnswer });
      }
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = drainProviderSseBuffer(buffer, (content) => {
          answer += content;
          sentAnyContent = true;
          send("delta", { content });
        });
      }

      buffer += decoder.decode();
      drainProviderSseBuffer(`${buffer}\n\n`, (content) => {
        answer += content;
        sentAnyContent = true;
        send("delta", { content });
      });
    }

    if (!sentAnyContent) {
      send("error", { error: "The provider returned an empty answer. Please try again." });
    }

    if (answer.trim()) {
      await saveLocalMessage({ conversationId, title: conversationTitle, model, role: "assistant", content: answer.trim() });
      log("chat.answer", {
        model,
        durationMs: Date.now() - startedAt,
        answerPreview: preview(answer),
      });
    } else {
      log("chat.empty_answer", { model, durationMs: Date.now() - startedAt });
    }

    send("done", { model });
    res.end();
  } catch (error) {
    const msg = message(error);
    log("stream.error", { model, message: msg });
    send("error", { error: msg });
    send("done", { model });
    res.end();
  }
}

function drainProviderSseBuffer(buffer, onContent) {
  const parts = buffer.split(/\n\n/);
  const remainder = parts.pop() || "";

  for (const part of parts) {
    const dataLines = part.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    for (const line of dataLines) {
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      const chunk = parseJson(payload);
      const partContent = chunk?.choices?.[0]?.delta?.content;
      if (typeof partContent === "string" && partContent) onContent(partContent);
    }
  }

  return remainder;
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
  return { ok: true, mode: "node-local", aiBaseUrl: baseUrl(), aiChatUrl: chatEndpoint(), aiModelsUrl: modelsEndpoint(), aiModel: modelFromEnv(), hasApiKey: Boolean(apiKey()), hasAdminPassword: Boolean(adminPassword()), memoryStorage: await localMemoryStorageInfo() };
}
function baseUrl() { return String(env.AI_BASE_URL || "https://api.openai.com").replace(/\/+$/, ""); }
function apiKey() { return String(env.AI_API_KEY || env.NVIDIA_API_KEY || "").trim(); }
function adminPassword() { return String(env.ADMIN_PASSWORD || "").trim(); }
function modelFromEnv() { return String(env.AI_MODEL || "gpt-4.1-mini").trim(); }
function chatEndpoint() { return baseUrl().endsWith("/v1") ? `${baseUrl()}/chat/completions` : `${baseUrl()}/v1/chat/completions`; }
function modelsEndpoint() { return baseUrl().endsWith("/v1") ? `${baseUrl()}/models` : `${baseUrl()}/v1/models`; }
function cleanModel(value) { return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,160}$/.test(value.trim()) ? value.trim() : ""; }
function cleanConversationId(value) { return typeof value === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(value.trim()) ? value.trim() : ""; }
function conversationIdFromMessages(messages) { return `local-${String(latestUserText(messages) || Date.now()).slice(0, 64).replace(/[^A-Za-z0-9]+/g, "-")}`; }
function isLocalAdminAuthenticated(req) { const token = readCookie(req, ADMIN_COOKIE_NAME); return Boolean(token && localAdminSessions.has(token)); }
function readCookie(req, name) { const cookie = String(req.headers.cookie || ""); for (const part of cookie.split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return rest.join("="); } return ""; }
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
function cors(headers = {}) { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", ...headers }; }
function sendJson(res, status, data, headers = {}) { return send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8", ...headers }); }
function send(res, status, body, headers = {}) { res.writeHead(status, cors(headers)); res.end(body); }
function contentType(path) { return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" }[extname(path)] || "application/octet-stream"; }
function log(event, details = {}) { console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details })); }
