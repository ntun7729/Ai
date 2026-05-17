import { errorResponse, jsonResponse } from "../http/json";
import type { Env } from "../types/env";
import { addMemory, clearMemories, deleteMemory, listMemories } from "./store";

const DEFAULT_USER_ID = "local-user";

export async function handleMemory(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!env.DB) {
      return jsonResponse({ memories: [], storage: "none", warning: "D1 DB binding is not configured" });
    }

    if (path === "/api/memory" && request.method === "GET") {
      const memories = await listMemories(env, DEFAULT_USER_ID);
      return jsonResponse({ memories, storage: "d1" });
    }

    if (path === "/api/memory" && request.method === "POST") {
      const body = await request.json() as { content?: unknown; type?: unknown; source?: unknown };
      const content = typeof body.content === "string" ? body.content : "";
      if (!content.trim()) return errorResponse("Memory content is required", 400);
      const memory = await addMemory(env, content, {
        userId: DEFAULT_USER_ID,
        type: typeof body.type === "string" ? body.type : "fact",
        source: typeof body.source === "string" ? body.source : "manual",
      });
      return jsonResponse({ memory, storage: "d1" });
    }

    if (path === "/api/memory/clear" && request.method === "POST") {
      await clearMemories(env, DEFAULT_USER_ID);
      return jsonResponse({ ok: true, storage: "d1" });
    }

    const deleteMatch = path.match(/^\/api\/memory\/([^/]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      await deleteMemory(env, decodeURIComponent(deleteMatch[1]), DEFAULT_USER_ID);
      return jsonResponse({ ok: true, storage: "d1" });
    }

    return errorResponse("Memory route not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown memory error";
    return errorResponse(message, 400);
  }
}
