import type { ChatMessage } from "../ai/types";
import type { Env } from "../types/env";

export interface MemoryRecord {
  id: string;
  user_id: string;
  content: string;
  type: string;
  source: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

const DEFAULT_USER_ID = "local-user";
const MAX_MEMORY_LENGTH = 500;
const MAX_INJECTED_MEMORIES = 30;

const MEMORY_PATTERNS = [
  /^remember(?:\s+that)?\s+(.+)$/i,
  /^please remember(?:\s+that)?\s+(.+)$/i,
  /^my\s+(.+?)\s+is\s+(.+)$/i,
  /^i\s+(?:am|use|like|prefer|want|need|work with|live in|study)\s+(.+)$/i,
  /^we\s+(?:use|prefer|want|need|are building|are working on)\s+(.+)$/i,
];

export async function listMemories(env: Env, userId = DEFAULT_USER_ID): Promise<MemoryRecord[]> {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, content, type, source, created_at, updated_at, last_used_at
     FROM memories
     WHERE user_id = ? AND is_deleted = 0
     ORDER BY updated_at DESC
     LIMIT 100`,
  ).bind(userId).all<MemoryRecord>();
  return results || [];
}

export async function addMemory(env: Env, content: string, options: { userId?: string; type?: string; source?: string } = {}): Promise<MemoryRecord | null> {
  const db = env.DB;
  if (!db) return null;
  const sanitized = sanitizeMemory(content);
  if (!sanitized) return null;

  const userId = options.userId || DEFAULT_USER_ID;
  const existing = await findDuplicateMemory(db, userId, sanitized);
  if (existing) return existing;

  const now = Date.now();
  const record: MemoryRecord = {
    id: crypto.randomUUID(),
    user_id: userId,
    content: sanitized,
    type: sanitizeType(options.type || "fact"),
    source: sanitizeType(options.source || "chat"),
    created_at: now,
    updated_at: now,
    last_used_at: null,
  };

  await db.prepare(
    `INSERT INTO memories (id, user_id, content, type, source, created_at, updated_at, last_used_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).bind(record.id, record.user_id, record.content, record.type, record.source, record.created_at, record.updated_at, record.last_used_at).run();

  return record;
}

export async function deleteMemory(env: Env, id: string, userId = DEFAULT_USER_ID): Promise<boolean> {
  if (!env.DB || !id) return false;
  await env.DB.prepare(
    `UPDATE memories SET is_deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
  ).bind(Date.now(), id, userId).run();
  return true;
}

export async function clearMemories(env: Env, userId = DEFAULT_USER_ID): Promise<boolean> {
  if (!env.DB) return false;
  await env.DB.prepare(
    `UPDATE memories SET is_deleted = 1, updated_at = ? WHERE user_id = ? AND is_deleted = 0`,
  ).bind(Date.now(), userId).run();
  return true;
}

export async function captureMemoryFromText(env: Env, text: string, userId = DEFAULT_USER_ID): Promise<{ action: string; memory?: MemoryRecord | null }> {
  if (/\b(forget|clear|delete)\b.*\b(memory|memories|remembered)\b/i.test(text)) {
    await clearMemories(env, userId);
    return { action: "cleared" };
  }

  const extracted = extractMemory(text);
  if (!extracted) return { action: "none" };
  const memory = await addMemory(env, extracted, { userId, source: "chat" });
  return { action: memory ? "saved" : "none", memory };
}

export async function addMemoryContext(env: Env, messages: ChatMessage[], enabled: boolean): Promise<ChatMessage[]> {
  if (!enabled || !env.DB) return messages;
  const memories = await listMemories(env);
  if (memories.length === 0) return messages;

  const selected = memories.slice(0, MAX_INJECTED_MEMORIES);
  const content = [
    "Persistent user/project memory from previous chats:",
    ...selected.map((memory, index) => `${index + 1}. ${memory.content}`),
    "Use these memories only when relevant. Do not mention memory unless the user asks.",
  ].join("\n");

  const insertAt = messages.findIndex((message) => message.role !== "system");
  const memoryMessage: ChatMessage = { role: "system", content };
  const nextMessages = insertAt < 0
    ? [...messages, memoryMessage]
    : [...messages.slice(0, insertAt), memoryMessage, ...messages.slice(insertAt)];

  await markMemoriesUsed(env.DB, selected.map((memory) => memory.id));
  return nextMessages;
}

export function latestUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    const text = message.content.find((part) => part.type === "text");
    if (text?.type === "text") return text.text;
  }
  return "";
}

async function findDuplicateMemory(db: D1Database, userId: string, content: string): Promise<MemoryRecord | null> {
  const row = await db.prepare(
    `SELECT id, user_id, content, type, source, created_at, updated_at, last_used_at
     FROM memories
     WHERE user_id = ? AND is_deleted = 0 AND lower(content) = lower(?)
     LIMIT 1`,
  ).bind(userId, content).first<MemoryRecord>();
  return row || null;
}

async function markMemoriesUsed(db: D1Database, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = Date.now();
  await Promise.all(ids.map((id) => db.prepare(
    `UPDATE memories SET last_used_at = ? WHERE id = ?`,
  ).bind(now, id).run()));
}

function extractMemory(text: string): string {
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

function sanitizeMemory(value: string): string {
  const text = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > MAX_MEMORY_LENGTH ? `${text.slice(0, MAX_MEMORY_LENGTH - 3)}...` : text;
}

function sanitizeType(value: string): string {
  return String(value || "fact").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "fact";
}
