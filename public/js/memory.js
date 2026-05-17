const MEMORY_STORAGE_KEY = "ai-chat.memories.v1";
const MEMORY_ENABLED_KEY = "ai-chat.memory.enabled.v1";
const MAX_MEMORIES = 60;
const MAX_MEMORY_LENGTH = 180;

const MEMORY_PATTERNS = [
  /^remember(?:\s+that)?\s+(.+)$/i,
  /^please remember(?:\s+that)?\s+(.+)$/i,
  /^my\s+(.+?)\s+is\s+(.+)$/i,
  /^i\s+(?:am|use|like|prefer|want|need|work with|live in|study)\s+(.+)$/i,
  /^we\s+(?:use|prefer|want|need|are building|are working on)\s+(.+)$/i,
];

export function createMemoryToggle() {
  const modelPicker = document.querySelector(".model-picker");
  if (!modelPicker || document.querySelector("#memory-toggle")) return document.querySelector("#memory-toggle");

  const label = document.createElement("label");
  label.className = "thinking-toggle memory-toggle";
  label.htmlFor = "memory-toggle";
  label.innerHTML = `
    <input id="memory-toggle" type="checkbox" />
    <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
    <span class="toggle-copy">
      <strong>Memory</strong>
      <small>Remember useful facts across chats</small>
    </span>
  `;

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "memory-clear-button";
  clearButton.textContent = "Clear memory";
  clearButton.addEventListener("click", () => {
    if (!getMemories().length) {
      window.alert("No saved memories yet.");
      return;
    }
    const ok = window.confirm("Clear all saved memories for this browser?");
    if (!ok) return;
    clearMemories();
    window.alert("Memory cleared.");
  });

  modelPicker.append(label, clearButton);
  const input = label.querySelector("#memory-toggle");
  input.checked = getMemoryEnabled();
  input.addEventListener("change", () => setMemoryEnabled(input.checked));
  return input;
}

export function getMemoryEnabled() {
  return localStorage.getItem(MEMORY_ENABLED_KEY) !== "false";
}

export function setMemoryEnabled(value) {
  localStorage.setItem(MEMORY_ENABLED_KEY, value ? "true" : "false");
}

export function getMemories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeMemory(item?.text || item))
      .filter(Boolean)
      .slice(0, MAX_MEMORIES);
  } catch {
    return [];
  }
}

export function clearMemories() {
  localStorage.removeItem(MEMORY_STORAGE_KEY);
}

export function updateMemoryFromUserText(text) {
  const raw = String(text || "").trim();
  if (!raw) return { changed: false, action: "none" };

  if (/\b(forget|clear|delete)\b.*\b(memory|memories|remembered)\b/i.test(raw)) {
    clearMemories();
    return { changed: true, action: "cleared" };
  }

  const memory = extractMemory(raw);
  if (!memory) return { changed: false, action: "none" };

  const memories = getMemories();
  const normalized = normalize(memory);
  const existingIndex = memories.findIndex((item) => normalize(item) === normalized);
  if (existingIndex >= 0) return { changed: false, action: "duplicate" };

  memories.unshift(memory);
  saveMemories(memories.slice(0, MAX_MEMORIES));
  return { changed: true, action: "saved", memory };
}

export function buildMemorySummary() {
  const memories = getMemories();
  if (!memories.length) return [];
  return memories.slice(0, 30);
}

function extractMemory(text) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 4 || trimmed.length > 600) return "";

  for (const pattern of MEMORY_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    if (pattern.source.startsWith("^my")) {
      return sanitizeMemory(`User's ${match[1].trim()} is ${match[2].trim()}`);
    }

    if (pattern.source.startsWith("^i")) {
      return sanitizeMemory(`User ${trimmed}`);
    }

    if (pattern.source.startsWith("^we")) {
      return sanitizeMemory(`Project/team ${trimmed}`);
    }

    return sanitizeMemory(match[1]);
  }

  return "";
}

function saveMemories(memories) {
  const payload = memories.map((text) => ({ text, savedAt: Date.now() }));
  localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(payload));
}

function sanitizeMemory(value) {
  const text = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > MAX_MEMORY_LENGTH ? `${text.slice(0, MAX_MEMORY_LENGTH - 3)}...` : text;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
