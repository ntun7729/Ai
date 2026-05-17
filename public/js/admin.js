const ADMIN_STORAGE_KEY = "ai-chat.admin.v1";

const DEFAULT_ADMIN_SETTINGS = {
  apiBaseUrl: "",
  logsEnabled: false,
  webFetchEnabled: true,
  googleSearchEnabled: true,
};

export function getAdminSettings() {
  const saved = loadSettings();
  return {
    apiBaseUrl: saved.apiBaseUrl.trim(),
    logsEnabled: Boolean(saved.logsEnabled),
    webFetchEnabled: Boolean(saved.webFetchEnabled),
    googleSearchEnabled: Boolean(saved.googleSearchEnabled),
  };
}

export function setupAdminPanel() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || document.querySelector("#admin-button")) return;

  const button = document.createElement("button");
  button.id = "admin-button";
  button.className = "admin-button";
  button.type = "button";
  button.textContent = "⚙ Admin";

  const newChatButton = document.querySelector("#new-chat-button");
  if (newChatButton) newChatButton.insertAdjacentElement("afterend", button);
  else sidebar.prepend(button);

  const panel = createPanel();
  document.body.append(panel.backdrop);
  button.addEventListener("click", () => openPanel(panel));
}

function createPanel() {
  const backdrop = document.createElement("div");
  backdrop.className = "admin-backdrop";
  backdrop.hidden = true;

  const modal = document.createElement("section");
  modal.className = "admin-panel";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Admin settings");
  modal.innerHTML = `
    <div class="admin-grabber" aria-hidden="true"></div>
    <div class="admin-header">
      <div><h2>Admin panel</h2><p>Provider and crawler settings for this browser.</p></div>
      <button class="admin-close" type="button" aria-label="Close admin panel">×</button>
    </div>
    <div class="admin-section">
      <h3>Provider</h3>
      <label class="admin-field">
        <span>API base URL</span>
        <input id="admin-api-base-url" type="url" placeholder="https://integrate.api.nvidia.com/v1" autocomplete="off" />
        <small>Leave empty to use the Worker setting.</small>
      </label>
      <div class="admin-warning">Provider credentials stay in Cloudflare Worker secrets for production safety.</div>
    </div>
    <div class="admin-section">
      <h3>Tools</h3>
      <label class="admin-switch"><input id="admin-logs-enabled" type="checkbox" /><span class="admin-switch-track"><span></span></span><span><strong>Enable logs</strong><small>Print debug events while requests run.</small></span></label>
      <label class="admin-switch"><input id="admin-web-fetch-enabled" type="checkbox" /><span class="admin-switch-track"><span></span></span><span><strong>Web crawler / fetch links</strong><small>Fetch readable text from links you paste into chat.</small></span></label>
      <label class="admin-switch"><input id="admin-google-search-enabled" type="checkbox" /><span class="admin-switch-track"><span></span></span><span><strong>Google search</strong><small>Try Google search before other search fallbacks.</small></span></label>
    </div>
    <div class="admin-actions"><button class="admin-reset" type="button">Reset</button><button class="admin-save" type="button">Save settings</button></div>
  `;

  backdrop.append(modal);
  const elements = {
    backdrop,
    apiBaseUrl: modal.querySelector("#admin-api-base-url"),
    logsEnabled: modal.querySelector("#admin-logs-enabled"),
    webFetchEnabled: modal.querySelector("#admin-web-fetch-enabled"),
    googleSearchEnabled: modal.querySelector("#admin-google-search-enabled"),
    close: modal.querySelector(".admin-close"),
    save: modal.querySelector(".admin-save"),
    reset: modal.querySelector(".admin-reset"),
  };

  elements.close.addEventListener("click", () => closePanel(elements));
  elements.save.addEventListener("click", () => saveFromPanel(elements));
  elements.reset.addEventListener("click", () => resetPanel(elements));
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closePanel(elements); });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !backdrop.hidden) closePanel(elements); });
  return elements;
}

function openPanel(panel) {
  fillPanel(panel, loadSettings());
  panel.backdrop.hidden = false;
  document.body.classList.add("admin-panel-open");
  window.setTimeout(() => panel.apiBaseUrl.focus(), 50);
}

function closePanel(panel) {
  panel.backdrop.hidden = true;
  document.body.classList.remove("admin-panel-open");
}

function saveFromPanel(panel) {
  const next = {
    apiBaseUrl: panel.apiBaseUrl.value.trim(),
    logsEnabled: panel.logsEnabled.checked,
    webFetchEnabled: panel.webFetchEnabled.checked,
    googleSearchEnabled: panel.googleSearchEnabled.checked,
  };
  if (next.apiBaseUrl && !isHttpUrl(next.apiBaseUrl)) {
    window.alert("API base URL must start with http:// or https://");
    return;
  }
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("admin-settings-changed", { detail: getAdminSettings() }));
  closePanel(panel);
}

function resetPanel(panel) {
  localStorage.removeItem(ADMIN_STORAGE_KEY);
  fillPanel(panel, DEFAULT_ADMIN_SETTINGS);
  window.dispatchEvent(new CustomEvent("admin-settings-changed", { detail: getAdminSettings() }));
}

function fillPanel(panel, settings) {
  panel.apiBaseUrl.value = settings.apiBaseUrl || "";
  panel.logsEnabled.checked = Boolean(settings.logsEnabled);
  panel.webFetchEnabled.checked = settings.webFetchEnabled !== false;
  panel.googleSearchEnabled.checked = settings.googleSearchEnabled !== false;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ADMIN_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ADMIN_SETTINGS, ...parsed, webFetchEnabled: parsed.webFetchEnabled !== false, googleSearchEnabled: parsed.googleSearchEnabled !== false };
  } catch {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
