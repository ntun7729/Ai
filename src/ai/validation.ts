import type { ChatMessage, ChatRequestBody } from "./types";

const VALID_ROLES = new Set(["system", "user", "assistant"]);
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;

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

  return {
    messages,
    model: parseModel(input.model),
    thinking: input.thinking === true,
  };
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

function parseModel(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const model = value.trim();

  if (model.length > 160 || !MODEL_ID_PATTERN.test(model)) {
    throw new Error("Unsupported model selected");
  }

  return model;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
