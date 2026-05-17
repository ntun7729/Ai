import type { ChatContent, ChatContentPart, ChatMessage, ChatRequestBody, RuntimeSettings } from "./types";

const VALID_ROLES = new Set(["system", "user", "assistant"]);
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const DATA_IMAGE_PATTERN = /^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;

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
    webSearch: input.webSearch === true,
    memory: input.memory !== false,
    stream: input.stream === true,
    conversationId: parseOptionalText(input.conversationId, 120),
    conversationTitle: parseOptionalText(input.conversationTitle, 120),
    runtime: parseRuntime(input.runtime),
  };
}

function parseRuntime(value: unknown): RuntimeSettings | undefined {
  if (!isRecord(value)) return undefined;

  return {
    providerBaseUrl: parseOptionalHttpUrl(value.providerBaseUrl),
    providerToken: parseOptionalToken(value.providerToken),
    logsEnabled: value.logsEnabled === true,
    webFetchEnabled: value.webFetchEnabled !== false,
    googleSearchEnabled: value.googleSearchEnabled !== false,
  };
}

function parseOptionalHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const url = value.trim();
  if (url.length > 240) throw new Error("Provider base URL is too long");
  if (!isHttpUrl(url)) throw new Error("Provider base URL must be http or https");
  return url;
}

function parseOptionalToken(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const token = value.trim();
  if (token.length > 4000) throw new Error("Provider API key is too long");
  return token;
}

function parseOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim().slice(0, maxLength);
}

function parseMessage(value: unknown): ChatMessage {
  if (!isRecord(value)) {
    throw new Error("Each message must be an object");
  }

  if (typeof value.role !== "string" || !VALID_ROLES.has(value.role)) {
    throw new Error("Each message must have a valid role");
  }

  return {
    role: value.role as ChatMessage["role"],
    content: parseContent(value.content),
  };
}

function parseContent(value: unknown): ChatContent {
  if (typeof value === "string") {
    if (value.trim().length === 0) throw new Error("Each message must have non-empty content");
    return value.trim();
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Each message must have non-empty content");
  }

  return value.map(parseContentPart);
}

function parseContentPart(value: unknown): ChatContentPart {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid message content part");
  }

  if (value.type === "text") {
    if (typeof value.text !== "string" || value.text.trim().length === 0) {
      throw new Error("Text content part must include text");
    }

    return {
      type: "text",
      text: value.text.trim(),
    };
  }

  if (value.type === "image_url") {
    const imageUrl = isRecord(value.image_url) ? value.image_url.url : undefined;
    if (typeof imageUrl !== "string" || !DATA_IMAGE_PATTERN.test(imageUrl)) {
      throw new Error("Image content part must include a valid data image URL");
    }

    return {
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    };
  }

  throw new Error("Unsupported message content part");
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
