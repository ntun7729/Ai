import { corsHeaders } from "./cors";

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, { status });
}
