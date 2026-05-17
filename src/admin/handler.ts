import { clearAdminSessionCookie, createAdminSessionCookie, isAdminAuthenticated, isAdminConfigured, verifyAdminPassword } from "./auth";
import { errorResponse, jsonResponse } from "../http/json";
import type { Env } from "../types/env";

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/admin/status" && request.method === "GET") {
    return jsonResponse({
      configured: isAdminConfigured(env),
      authenticated: await isAdminAuthenticated(request, env),
    });
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    if (!isAdminConfigured(env)) {
      return errorResponse("ADMIN_PASSWORD is not configured", 500);
    }

    const body = await request.json().catch((): unknown => ({}));
    const password = isRecord(body) && typeof body.password === "string" ? body.password : "";
    const ok = await verifyAdminPassword(password, env);
    if (!ok) return errorResponse("Invalid admin password", 401);

    const response = jsonResponse({ ok: true, authenticated: true });
    response.headers.append("Set-Cookie", await createAdminSessionCookie(request, env));
    return response;
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const response = jsonResponse({ ok: true, authenticated: false });
    response.headers.append("Set-Cookie", clearAdminSessionCookie());
    return response;
  }

  return errorResponse("Admin route not found", 404);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
