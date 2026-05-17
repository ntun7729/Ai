import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_USER_ID = "local-user";
const MAX_MEMORY_LENGTH = 500;
const MAX_INJECTED_MEMORIES = 30;
const DATA_DIR = join(process.cwd(), "data");
const JSON_PATH = join(DATA_DIR, "ai-local-memory.json");

const MEMORY_PATTERNS = [
  /^remember(?:\s+that)?\s+(.+)$/i,
  /^please remember(?:\s+that)?\s+(.+)$/i,
  /^my\s+(.+?)\s+is\s+(.+)$/i,
  /^i\s+(?:am|use|like|prefer|want|need|work with|live in|study)\s+(.+)$/i,
  /^we\s+(?:use|prefer|want|need|are building|are working on)\s+(.+)$/i,
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

  const rows = await readJsonRows();
  return rows
    .filter((row) => row.user_id === userId && row.is_deleted !== 1)
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 100);
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
    type: sanitizeType(options.type || "fact"),
    source: sanitizeType(options.source || "chat"),
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

  const rows = await readJsonRows();
  rows.push(record);
  await writeJsonRows(rows);
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

  const rows = await readJsonRows();
  for (const row of rows) {
    if (row.id === id && row.user_id === userId) {
      row.is_deleted = 1;
      row.updated_at = now;
    }
  }
  await writeJsonRows(rows);
  return true;
}

export async function clearLocalMemories(userId = DEFAULT_USER_ID) {
  const now = Date.now();
  const database = await db();
  if (database?.kind === "sqlite") {
    database.db.prepare(`UPDATE memories SET is_deleted = 1, updated_at = ? WHERE user_id = ? AND is_deleted = 0`).run(now, userId);
    return true;
  }

  const rows = await readJsonRows();
  for (const row of rows) {
    if (row.user_id === userId && row.is_deleted !== 1) {
      row.is_deleted = 1;
      row.updated_at = now;
    }
  }
  await writeJsonRows(rows);
  return true;
}

export async function captureLocalMemoryFromText(text, userId = DEFAULT_USER_ID) {
  const raw = String(text || "").trim();
  if (!raw) return { action: "none" };

  if (/\b(forget|clear|delete)\b.*\b(memory|memories|remembered)\b/i.test(raw)) {
    await clearLocalMemories(userId);
    return { action: "cleared" };
  }

  const extracted = extractMemory(raw);
  if (!extracted) return { action: "none" };
  const memory = await addLocalMemory(extracted, { userId, source: "chat" });
  return { action: memory ? "saved" : "none", memory };
}

export async function addLocalMemoryContext(messages, enabled = true) {
  if (!enabled) return messages;
  const memories = await listLocalMemories();
  if (!memories.length) return messages;

  const selected = memories.slice(0, MAX_INJECTED_MEMORIES);
  const content = [
    "Persistent user/project memory from previous chats:",
    ...selected.map((memory, index) => `${index + 1}. ${memory.content}`),
    "Use these memories only when relevant. Do not mention memory unless the user asks.",
  ].join("\n");

  await markUsed(selected.map((memory) => memory.id));
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

async function db() {
  if (sqliteDbPromise) return sqliteDbPromise;
  sqliteDbPromise = openSqlite().catch(async () => {
    sqliteUnavailable = true;
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(JSON_PATH)) await writeJsonRows([]);
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
  const rows = await readJsonRows();
  return stripDeleted(rows.find((row) => row.user_id === userId && row.is_deleted !== 1 && normalize(row.content) === normalized) || null);
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

  const rows = await readJsonRows();
  for (const row of rows) {
    if (ids.includes(row.id)) row.last_used_at = now;
  }
  await writeJsonRows(rows);
}

async function readJsonRows() {
  try {
    const text = await readFile(JSON_PATH, "utf8");
    const rows = JSON.parse(text);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeJsonRows(rows) {
  mkdirSync(dirname(JSON_PATH), { recursive: true });
  await writeFile(JSON_PATH, JSON.stringify(rows, null, 2));
}

function extractMemory(text) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 4 || trimmed.length > 1000) return "";

  for (const pattern of MEMORY_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    if (pattern.source.startsWith("^my")) return sanitizeMemory(`User's ${match[1].trim()} is ${match[2].trim()}`);
    if (pattern.source.startsWith("^i")) return sanitizeMemory(`User ${trimmed}`);
    if (pattern.source.startsWith("^we")) return sanitizeMemory(`Project/team ${trimmed}`);
    return sanitizeMemory(match[1]);
  }
  return "";
}

function sanitizeMemory(value) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > MAX_MEMORY_LENGTH ? `${text.slice(0, MAX_MEMORY_LENGTH - 3)}...` : text;
}

function sanitizeType(value) {
  return String(value || "fact").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "fact";
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripDeleted(record) {
  if (!record) return null;
  const { is_deleted, ...rest } = record;
  return rest;
}
