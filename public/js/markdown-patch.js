import { copyText, renderMarkdown } from "./markdown.js";

const observer = new MutationObserver(() => renderAllAssistantMessages());
observer.observe(document.body, { childList: true, subtree: true });
renderAllAssistantMessages();

function renderAllAssistantMessages() {
  for (const message of document.querySelectorAll(".message.assistant:not([data-rendered-markdown])")) {
    const raw = message.textContent || "";
    message.dataset.renderedMarkdown = "true";
    message.dataset.rawText = raw;
    renderMarkdown(message, raw);
    addResponseCopyButton(message, raw);
  }
}

function addResponseCopyButton(message, raw) {
  const actions = document.createElement("div");
  actions.className = "message-actions";

  const copy = document.createElement("button");
  copy.className = "copy-button response-copy-button";
  copy.type = "button";
  copy.textContent = "Copy response";
  copy.addEventListener("click", () => {
    const old = copy.textContent;
    copyText(raw)
      .then(() => {
        copy.textContent = "Copied";
        copy.classList.add("copied");
      })
      .catch(() => {
        copy.textContent = "Failed";
      })
      .finally(() => {
        window.setTimeout(() => {
          copy.textContent = old;
          copy.classList.remove("copied");
        }, 1200);
      });
  });

  actions.append(copy);
  message.append(actions);
}
