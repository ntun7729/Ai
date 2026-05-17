import { handleChat } from "../ai/chat-handler";
import { handleModels } from "../ai/models-handler";
import { handleTitle } from "../ai/title-handler";
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

  if (url.pathname === "/api/models" && request.method === "GET") {
    return handleModels(env);
  }

  if (url.pathname === "/api/title" && request.method === "POST") {
    return handleTitle(request, env);
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    return handleChat(request, env);
  }

  return env.ASSETS.fetch(request);
}
