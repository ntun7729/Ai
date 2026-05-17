import type { RuntimeSettings } from "../ai/types";
import type { Env } from "../types/env";

const COOKIE_NAME = "ai_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export function isAdminConfigured(env: Env): boolean {
  return Boolean(env.ADMIN_PASSWORD?.trim());
}

export async function isAdminAuthenticated(request: Request, env: Env): Promise<boolean> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token || !isAdminConfigured(env)) return false;
  return verifySessionToken(token, env);
}

export function hasPrivilegedRuntime(runtime?: RuntimeSettings): boolean {
  if (!runtime) return false;
  return Boolean(
    runtime.providerBaseUrl ||
    runtime.providerToken ||
    runtime.logsEnabled === true ||
    runtime.webFetchEnabled === false ||
    runtime.googleSearchEnabled === false,
  );
}

export async function createAdminSessionCookie(request: Request, env: Env): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = await sign(payload, sessionSecret(env));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearAdminSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function verifyAdminPassword(input: string, env: Env): Promise<boolean> {
  const expected = env.ADMIN_PASSWORD?.trim() || "";
  if (!expected || !input) return false;
  return timingSafeEqual(input, expected);
}

function readCookie(request: Request, name: string): string {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

async function verifySessionToken(token: string, env: Env): Promise<boolean> {
  const [expiresAtText, signature] = token.split(".");
  const expiresAt = Number(expiresAtText);
  if (!expiresAt || !signature) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(expiresAtText, sessionSecret(env));
  return timingSafeEqual(signature, expected);
}

function sessionSecret(env: Env): string {
  return env.ADMIN_SESSION_SECRET?.trim() || env.ADMIN_PASSWORD?.trim() || "";
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return diff === 0;
}
