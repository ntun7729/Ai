const MEMORY_ENABLED_KEY = "ai-chat.memory.enabled.v1";

export function setupMemory() {
  createMemoryToggle();
}

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
      <small>Long-term memory from local DB/D1</small>
    </span>
  `;

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "memory-clear-button";
  clearButton.textContent = "Clear memory";
  clearButton.addEventListener("click", async () => {
    const ok = window.confirm("Clear all saved memories?");
    if (!ok) return;
    try {
      const response = await fetch("/api/memory/clear", { method: "POST" });
      if (!response.ok) throw new Error("Memory API failed");
      window.alert("Memory cleared.");
    } catch {
      window.alert("Could not clear server memory. Try again after restarting the app.");
    }
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
