import type { ChatMessage, ChatRequestBody } from "./types";

const VALID_ROLES = new Set(["system", "user", "assistant"]);

export function parseChatRequest(input: unknown): ChatRequestBody {
  if (!isRecord(input)) {
    throw new Error("Request body must be an object");
  }

  if (!Array.isArray(input.messages)) {
    throw new Error("Request body must include a messages array");
  }

  const messages = input.messages.map(parseMessage);

  if (messages.length === 0) {
    throw new Error("Messages array cannot be empty");
  }

  return { messages };
}

function parseMessage(value: unknown): ChatMessage {
  if (!isRecord(value)) {
    throw new Error("Each message must be an object");
  }

  if (typeof value.role !== "string" || !VALID_ROLES.has(value.role)) {
    throw new Error("Each message must have a valid role");
  }

  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    throw new Error("Each message must have non-empty content");
  }

  return {
    role: value.role as ChatMessage["role"],
    content: value.content.trim(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
