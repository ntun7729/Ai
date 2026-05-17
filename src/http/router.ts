import { handleAdmin } from "../admin/handler";
import { handleChat } from "../ai/chat-handler";
import { handleModels } from "../ai/models-handler";
import { handleTitle } from "../ai/title-handler";
import { handleMemory } from "../memory/handler";
import type { Env } from "../types/env";
import { handleOptions } from "./cors";
import { jsonResponse } from "./json";

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({ ok: true });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    return handleAdmin(request, env);
  }

  if (url.pathname === "/api/models" && request.method === "GET") {
    return handleModels(env);
  }

  if (url.pathname === "/api/title" && request.method === "POST") {
    return handleTitle(request, env);
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    return handleChat(request, env);
  }

  if (url.pathname === "/api/memory" || url.pathname === "/api/memory/clear" || url.pathname.startsWith("/api/memory/")) {
    return handleMemory(request, env);
  }

  return env.ASSETS.fetch(request);
}
