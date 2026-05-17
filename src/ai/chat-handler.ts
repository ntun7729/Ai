import { hasPrivilegedRuntime, isAdminAuthenticated } from "../admin/auth";
import { getConfig } from "../config/env";
import { corsHeaders } from "../http/cors";
import { errorResponse, jsonResponse } from "../http/json";
import { addMemoryContext, captureMemoryFromText, latestUserText } from "../memory/store";
import { buildSearchContext, messageHasUrl } from "../search/web-search";
import type { Env } from "../types/env";
import { createChatCompletion, streamChatCompletion } from "./client";
import type { ChatMessage } from "./types";
import { parseChatRequest } from "./validation";

const CLIENT_STREAM_FLUSH_MS = 55;

export async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json();
    const parsed = parseChatRequest(body);

    if (hasPrivilegedRuntime(parsed.runtime) && !(await isAdminAuthenticated(request, env))) {
      return errorResponse("Admin login required for provider, log, and crawler overrides", 401);
    }

    const config = getConfig(env, parsed.runtime);
    const selectedModel = parsed.model || config.model;
    const memoryEnabled = parsed.memory !== false;

    if (memoryEnabled) {
      await captureMemoryFromText(env, latestUserText(parsed.messages));
    }

    const withMemory = await addMemoryContext(env, parsed.messages, memoryEnabled);
    const shouldUseWeb = parsed.webSearch || messageHasUrl(withMemory);
    const preparedMessages = shouldUseWeb ? await addWebResults(env, withMemory) : withMemory;
    const providerConfig = { ...config, model: selectedModel };
    const thinking = shouldSendThinking(selectedModel, Boolean(parsed.thinking));

    log(config.logsEnabled, "chat.request", {
      model: selectedModel,
      stream: parsed.stream === true,
      webSearch: shouldUseWeb,
      memory: memoryEnabled,
      memoryStorage: env.DB ? "d1" : "none",
      messageCount: preparedMessages.length,
    });

    if (parsed.stream === true) {
      const providerResponse = await streamChatCompletion(providerConfig, preparedMessages, { thinking });
      return createClientStream(providerResponse, selectedModel);
    }

    const completion = await createChatCompletion(providerConfig, preparedMessages, { thinking });
    const answer = getTextContent(completion.choices?.[0]?.message?.content);

    return jsonResponse({
      answer,
      model: completion.model,
      usage: completion.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chat error";
    const status = message.includes("Missing") ? 500 : 400;

    return errorResponse(message, status);
  }
}

async function addWebResults(env: Env, messages: ChatMessage[]): Promise<ChatMessage[]> {
  const context = await buildSearchContext(env, messages);
  if (!context) return messages;

  return [
    ...messages,
    {
      role: "system",
      content: context,
    },
  ];
}

function createClientStream(providerResponse: Response, model: string): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let sentAnyContent = false;
  let pendingContent = "";
  let flushTimer: number | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const flushDelta = () => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }

        if (!pendingContent) return;
        send("delta", { content: pendingContent });
        pendingContent = "";
      };

      const queueDelta = (content: string) => {
        if (!content) return;
        sentAnyContent = true;
        pendingContent += content;

        if (flushTimer !== null) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          if (!pendingContent) return;
          send("delta", { content: pendingContent });
          pendingContent = "";
        }, CLIENT_STREAM_FLUSH_MS);
      };

      try {
        const body = providerResponse.body;
        if (!body) {
          send("error", { error: "Provider returned an empty stream" });
          send("done", { model });
          controller.close();
          return;
        }

        const reader = body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = drainProviderSseBuffer(buffer, queueDelta);
        }

        buffer += decoder.decode();
        drainProviderSseBuffer(`${buffer}\n\n`, queueDelta);
        flushDelta();

        if (!sentAnyContent) {
          send("error", { error: "The provider returned an empty answer. Please try again." });
        }
        send("done", { model });
        controller.close();
      } catch (error) {
        flushDelta();
        send("error", { error: error instanceof Error ? error.message : "Stream failed" });
        send("done", { model });
        controller.close();
      }
    },
  });

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");

  return new Response(stream, { headers });
}

function drainProviderSseBuffer(
  buffer: string,
  onContent: (content: string) => void,
): string {
  const parts = buffer.split(/\n\n/);
  const remainder = parts.pop() || "";

  for (const part of parts) {
    const dataLines = part.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    for (const line of dataLines) {
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      const json = safeParseJson(payload);
      const delta = json?.choices?.[0]?.delta;
      const content = typeof delta?.content === "string" ? delta.content : "";
      if (content) onContent(content);
    }
  }

  return remainder;
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function shouldSendThinking(model: string, thinking: boolean): boolean {
  if (!thinking) return false;

  const lower = model.toLowerCase();
  if (lower.includes("mistral") || lower.includes("mixtral")) return false;

  return true;
}

function getTextContent(value: ChatMessage["content"] | undefined): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function log(enabled: boolean, event: string, details: Record<string, unknown>): void {
  if (!enabled) return;
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
}
