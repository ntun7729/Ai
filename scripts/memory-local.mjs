import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_USER_ID = "local-user";
const MAX_MEMORY_LENGTH = 500;
const MAX_INJECTED_MEMORIES = 18;
const MAX_RECALLED_MESSAGES = 10;
const DATA_DIR = join(process.cwd(), "data");
const JSON_PATH = join(DATA_DIR, "ai-local-memory.json");

const MEMORY_PATTERNS = [
  /^remember(?:\s+that)?\s+(.+)$/i,
  /^please remember(?:\s+that)?\s+(.+)$/i,
  /^my\s+(.+?)\s+is\s+(.+)$/i,
  /^i\s+(?:am|use|like|prefer|want|need|work with|live in|study)\s+(.+)$/i,
  /^we\s+(?:use|prefer|want|need|are building|are working on|decided|agreed)\s+(.+)$/i,
  /^(?:the|our)\s+project\s+(?:uses|needs|is|should|will)\s+(.+)$/i,
];

let sqliteDbPromise;
let sqliteUnavailable = false;

export async function initLocalMemory() {
  await db();
}

export async function listLocalMemories(userId = DEFAULT_USER_ID) {
  const database = await db();
  if (database?.kind === "sqlite") {
    return database.db.prepare(
      `SELECT id, user_id, content, type, source, created_at, updated_at, last_used_at
       FROM memories
       WHERE user_id = ? AND is_deleted = 0
       ORDER BY updated_at DESC
       LIMIT 100`,
    ).all(userId);
  }

  const state = await readJsonState();
  return state.memories
    .filter((row) => row.user_id === userId && row.is_deleted !== 1)
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 100)
    .map(stripDeleted);
}

export async function addLocalMemory(content, options = {}) {
  const sanitized = sanitizeMemory(content);
  if (!sanitized) return null;

  const userId = options.userId || DEFAULT_USER_ID;
  const existing = await findDuplicate(userId, sanitized);
  if (existing) return existing;

  const now = Date.now();
  const record = {
    id: randomUUID(),
    user_id: userId,
    content: sanitized,
    type: sanitizeType(options.type || inferMemoryType(sanitized)),
    source: sanitizeType(options.source || "auto"),
    created_at: now,
    updated_at: now,
    last_used_at: null,
    is_deleted: 0,
  };

  const database = await db();
  if (database?.kind === "sqlite") {
    database.db.prepare(
      `INSERT INTO memories (id, user_id, content, type, source, created_at, updated_at, last_used_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(record.id, record.user_id, record.content, record.type, record.source, record.created_at, record.updated_at, record.last_used_at);
    return stripDeleted(record);
  }

  const state = await readJsonState();
  state.memories.push(record);
  await writeJsonState(state);
  return stripDeleted(record);
}

export async function deleteLocalMemory(id, userId = DEFAULT_USER_ID) {
  if (!id) return false;
  const now = Date.now();
  const database = await db();
  if (database?.kind === "sqlite") {
    database.db.prepare(`UPDATE memories SET is_deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?`).run(now, id, userId);
    return true;
  }

  const state = await readJsonState();
  for (const row of state.memories) {
    if (row.id === id && row.user_id === userId) {
      row.is_deleted = 1;
      row.updated_at = now;
    }
  }
  await writeJsonState(state);
  return true;
}

export async function clearLocalMemories(userId = DEFAULT_USER_ID) {
  const now = Date.now();
  const database = await db();
  if (database?.kind === "sqlite") {
    database.db.prepare(`UPDATE memories SET is_deleted = 1, updated_at = ? WHERE user_id = ? AND is_deleted = 0`).run(now, userId);
    return true;
  }

  const state = await readJsonState();
  for (const row of state.memories) {
    if (row.user_id === userId && row.is_deleted !== 1) {
      row.is_deleted = 1;
      row.updated_at = now;
    }
  }
  await writeJsonState(state);
  return true;
}

export async function upsertLocalConversation(options = {}) {
  const id = sanitizeId(options.id) || randomUUID();
  const userId = options.userId || DEFAULT_USER_ID;
  const now = Date.now();
  const title = sanitizeTitle(options.title || "New chat");
  const model = sanitizeModel(options.model || "");

  const database = await db();
  if (database?.kind === "sqlite") {
    const existing = database.db.prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ? LIMIT 1`).get(id, userId);
    if (existing) {
      database.db.prepare(`UPDATE conversations SET title = ?, model = ?, updated_at = ? WHERE id = ? AND user_id = ?`).run(title, model, now, id, userId);
    } else {
      database.db.prepare(
        `INSERT INTO conversations (id, user_id, title, model, created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      ).run(id, userId, title, model, now, now);
    }
    return id;
  }

  const state = await readJsonState();
  const existing = state.conversations.find((conversation) => conversation.id === id && conversation.user_id === userId);
  if (existing) {
    existing.title = title;
    existing.model = model;
    existing.updated_at = now;
  } else {
    state.conversations.push({ id, user_id: userId, title, model, created_at: now, updated_at: now, is_deleted: 0 });
  }
  await writeJsonState(state);
  return id;
}

export async function saveLocalMessage(options = {}) {
  const content = sanitizeMessage(options.content);
  if (!content) return null;

  const conversationId = await upsertLocalConversation({
    id: options.conversationId,
    userId: options.userId,
    title: options.title,
    model: options.model,
  });
  const now = Date.now();
  const record = {
    id: randomUUID(),
    conversation_id: conversationId,
    user_id: options.userId || DEFAULT_USER_ID,
    role: sanitizeRole(options.role || "user"),
    content,
    model: sanitizeModel(options.model || ""),
    created_at: now,
  };

  const database = await db();
  if (database?.kind === "sqlite") {
    database.db.prepare(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.id, record.conversation_id, record.user_id, record.role, record.content, record.model, record.created_at);
    database.db.prepare(`UPDATE conversations SET updated_at = ?, model = COALESCE(NULLIF(?, ''), model) WHERE id = ?`).run(now, record.model, conversationId);
    return record;
  }

  const state = await readJsonState();
  state.messages.push(record);
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (conversation) conversation.updated_at = now;
  await writeJsonState(state);
  return record;
}

export async function captureLocalMemoryFromText(text, userId = DEFAULT_USER_ID) {
  const raw = String(text || "").trim();
  if (!raw) return { action: "none" };

  if (/\b(forget|clear|delete)\b.*\b(memory|memories|remembered)\b/i.test(raw)) {
    await clearLocalMemories(userId);
    return { action: "cleared" };
  }

  const memories = extractMemoryCandidates(raw);
  if (memories.length === 0) return { action: "none" };

  const saved = [];
  for (const memory of memories) {
    const record = await addLocalMemory(memory.content, { userId, source: memory.source, type: memory.type });
    if (record) saved.push(record);
  }
  return { action: saved.length ? "saved" : "none", memory: saved[0] || null, count: saved.length };
}

export async function addLocalMemoryContext(messages, enabled = true) {
  if (!enabled) return messages;

  const query = latestUserText(messages);
  const memories = await relevantLocalMemories(query);
  const recalls = await searchLocalMessages(query);
  if (!memories.length && !recalls.length) return messages;

  const content = [
    "Long-term memory retrieved from previous chats:",
    memories.length ? "Saved durable memories:" : "",
    ...memories.map((memory, index) => `${index + 1}. ${memory.content}`),
    recalls.length ? "Relevant past conversation excerpts:" : "",
    ...recalls.map((message, index) => `${index + 1}. ${message.role}: ${message.content}`),
    "Use this recalled context only when relevant. Do not mention memory/retrieval unless the user asks.",
  ].filter(Boolean).join("\n");

  await markUsed(memories.map((memory) => memory.id));
  const memoryMessage = { role: "system", content };
  const insertAt = messages.findIndex((message) => message.role !== "system");
  if (insertAt < 0) return [...messages, memoryMessage];
  return [...messages.slice(0, insertAt), memoryMessage, ...messages.slice(insertAt)];
}

export function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      const text = message.content.find((part) => part?.type === "text");
      if (text?.text) return text.text;
    }
  }
  return "";
}

export async function localMemoryStorageInfo() {
  const database = await db();
  return database?.kind || "json";
}

async function relevantLocalMemories(query, userId = DEFAULT_USER_ID) {
  const database = await db();
  const tokens = queryTokens(query);
  if (database?.kind === "sqlite") {
    if (tokens.length) {
      const clauses = tokens.slice(0, 8).map(() => "lower(content) LIKE ?").join(" OR ");
      const rows = database.db.prepare(
        `SELECT id, user_id, content, type, source, created_at, updated_at, last_used_at
         FROM memories
         WHERE user_id = ? AND is_deleted = 0 AND (${clauses})
         ORDER BY updated_at DESC
         LIMIT ?`,
      ).all(userId, ...tokens.slice(0, 8).map((token) => `%${token}%`), MAX_INJECTED_MEMORIES);
      if (rows.length) return rows;
    }
    return database.db.prepare(
      `SELECT id, user_id, content, type, source, created_at, updated_at, last_used_at
       FROM memories
       WHERE user_id = ? AND is_deleted = 0
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).all(userId, Math.min(8, MAX_INJECTED_MEMORIES));
  }

  const memories = await listLocalMemories(userId);
  if (!tokens.length) return memories.slice(0, 8);
  const scored = memories.map((memory) => ({ memory, score: scoreText(memory.content, tokens) })).filter((item) => item.score > 0);
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_INJECTED_MEMORIES).map((item) => item.memory);
}

async function searchLocalMessages(query, userId = DEFAULT_USER_ID) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  const database = await db();
  if (database?.kind === "sqlite") {
    const clauses = tokens.slice(0, 8).map(() => "lower(content) LIKE ?").join(" OR ");
    return database.db.prepare(
      `SELECT id, conversation_id, user_id, role, content, model, created_at
       FROM messages
       WHERE user_id = ? AND role IN ('user', 'assistant') AND (${clauses})
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(userId, ...tokens.slice(0, 8).map((token) => `%${token}%`), MAX_RECALLED_MESSAGES);
  }

  const state = await readJsonState();
  const scored = state.messages
    .filter((message) => message.user_id === userId && ["user", "assistant"].includes(message.role))
    .map((message) => ({ message, score: scoreText(message.content, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.message.created_at - a.message.created_at)
    .slice(0, MAX_RECALLED_MESSAGES)
    .map((item) => item.message);
  return scored;
}

async function db() {
  if (sqliteDbPromise) return sqliteDbPromise;
  sqliteDbPromise = openSqlite().catch(async () => {
    sqliteUnavailable = true;
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(JSON_PATH)) await writeJsonState(defaultJsonState());
    return { kind: "json" };
  });
  return sqliteDbPromise;
}

async function openSqlite() {
  if (sqliteUnavailable) return { kind: "json" };
  mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = await import("node:sqlite");
  const databasePath = join(DATA_DIR, "ai-local.db");
  const database = new sqlite.DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local-user',
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'fact',
      source TEXT NOT NULL DEFAULT 'chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memories_user_active
    ON memories (user_id, is_deleted, updated_at);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local-user',
      title TEXT NOT NULL DEFAULT 'New chat',
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local-user',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
    ON conversations (user_id, is_deleted, updated_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages (conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_user_created
    ON messages (user_id, created_at);
  `);
  return { kind: "sqlite", db: database };
}

async function findDuplicate(userId, content) {
  const database = await db();
  if (database?.kind === "sqlite") {
    const row = database.db.prepare(
      `SELECT id, user_id, content, type, source, created_at, updated_at, last_used_at
       FROM memories
       WHERE user_id = ? AND is_deleted = 0 AND lower(content) = lower(?)
       LIMIT 1`,
    ).get(userId, content);
    return row || null;
  }

  const normalized = normalize(content);
  const state = await readJsonState();
  return stripDeleted(state.memories.find((row) => row.user_id === userId && row.is_deleted !== 1 && normalize(row.content) === normalized) || null);
}

async function markUsed(ids) {
  if (!ids.length) return;
  const now = Date.now();
  const database = await db();
  if (database?.kind === "sqlite") {
    const statement = database.db.prepare(`UPDATE memories SET last_used_at = ? WHERE id = ?`);
    for (const id of ids) statement.run(now, id);
    return;
  }

  const state = await readJsonState();
  for (const row of state.memories) {
    if (ids.includes(row.id)) row.last_used_at = now;
  }
  await writeJsonState(state);
}

async function readJsonState() {
  try {
    const text = await readFile(JSON_PATH, "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { ...defaultJsonState(), memories: parsed };
    return { ...defaultJsonState(), ...parsed };
  } catch {
    return defaultJsonState();
  }
}

async function writeJsonState(state) {
  mkdirSync(dirname(JSON_PATH), { recursive: true });
  await writeFile(JSON_PATH, JSON.stringify({ ...defaultJsonState(), ...state }, null, 2));
}

function defaultJsonState() {
  return { memories: [], conversations: [], messages: [] };
}

function extractMemoryCandidates(text) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 4 || trimmed.length > 1600) return [];

  const explicit = extractExplicitMemory(trimmed);
  if (explicit) return [{ content: explicit, type: inferMemoryType(explicit), source: "explicit" }];

  const candidates = [];
  const sentences = trimmed.split(/(?<=[.!?])\s+/).slice(0, 5);
  for (const sentence of sentences) {
    const content = autoMemoryFromSentence(sentence);
    if (content) candidates.push({ content, type: inferMemoryType(content), source: "auto" });
  }
  return candidates.slice(0, 3);
}

function extractExplicitMemory(text) {
  for (const pattern of MEMORY_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    if (pattern.source.startsWith("^my")) return sanitizeMemory(`User's ${match[1].trim()} is ${match[2].trim()}`);
    if (pattern.source.startsWith("^i")) return sanitizeMemory(`User ${text}`);
    if (pattern.source.startsWith("^we")) return sanitizeMemory(`Project/team ${text}`);
    return sanitizeMemory(match[1]);
  }
  return "";
}

function autoMemoryFromSentence(sentence) {
  const text = sentence.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > MAX_MEMORY_LENGTH) return "";
  if (/\b(what|when|where|why|how|can you|could you|please|show me|write|create|generate|summarize|explain)\b/i.test(text)) return "";
  if (/\b(password|api key|secret|token|credential|private key)\b/i.test(text)) return "";

  if (/\b(i|my|me)\b/i.test(text) && /\b(like|prefer|use|want|need|am|work with|live in|study|favorite)\b/i.test(text)) {
    return sanitizeMemory(`User said: ${text}`);
  }
  if (/\b(we|our|project|app|website)\b/i.test(text) && /\b(use|need|want|decided|prefer|building|working on|should|must|will|deploy|local|worker|cloudflare|memory|proxyip)\b/i.test(text)) {
    return sanitizeMemory(`Project context: ${text}`);
  }
  return "";
}

function inferMemoryType(content) {
  const text = content.toLowerCase();
  if (/\bprefer|favorite|like\b/.test(text)) return "preference";
  if (/\bproject|app|website|worker|cloudflare|deploy|proxyip|local\b/.test(text)) return "project";
  if (/\bmust|should|always|never\b/.test(text)) return "instruction";
  return "fact";
}

function queryTokens(query) {
  return Array.from(new Set(String(query || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || []))
    .filter((token) => !new Set(["what", "when", "where", "which", "about", "this", "that", "with", "from", "your", "have", "like"]).has(token))
    .slice(0, 10);
}

function scoreText(text, tokens) {
  const lower = String(text || "").toLowerCase();
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function sanitizeMemory(value) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > MAX_MEMORY_LENGTH ? `${text.slice(0, MAX_MEMORY_LENGTH - 3)}...` : text;
}

function sanitizeMessage(value) {
  if (typeof value === "string") return value.trim().slice(0, 12000);
  if (Array.isArray(value)) {
    const text = value.find((part) => part?.type === "text")?.text || "[non-text message]";
    const hasImage = value.some((part) => part?.type === "image_url");
    return `${String(text).trim()}${hasImage ? " [image attached]" : ""}`.trim().slice(0, 12000);
  }
  return String(value || "").trim().slice(0, 12000);
}

function sanitizeType(value) {
  return String(value || "fact").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "fact";
}

function sanitizeRole(value) {
  return ["system", "user", "assistant", "error"].includes(value) ? value : "user";
}

function sanitizeModel(value) {
  return String(value || "").replace(/[^A-Za-z0-9._:/-]/g, "").slice(0, 160);
}

function sanitizeId(value) {
  return String(value || "").replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 120);
}

function sanitizeTitle(value) {
  return String(value || "New chat").replace(/\s+/g, " ").trim().slice(0, 120) || "New chat";
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripDeleted(record) {
  if (!record) return null;
  const { is_deleted, ...rest } = record;
  return rest;
}
