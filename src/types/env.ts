export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  AI_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  AI_BASE_URL: string;
  AI_MODEL: string;
  SEARCH_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;
  SEARCH_PROXY_URL?: string;
  PROXY_HOSTS?: string;
  PROXY_IPS?: string;
  PROXYIP?: string;
  PROXY_FAIL_COOLDOWN_MS?: string;
  ENABLE_LOGS?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}
