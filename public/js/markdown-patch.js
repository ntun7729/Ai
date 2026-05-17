import { renderMarkdown } from "./markdown.js";

const observer = new MutationObserver(() => {
  for (const message of document.querySelectorAll(".message.assistant:not([data-rendered-markdown])")) {
    const raw = message.textContent || "";
    message.dataset.renderedMarkdown = "true";
    renderMarkdown(message, raw);
  }
});

observer.observe(document.body, { childList: true, subtree: true });

for (const message of document.querySelectorAll(".message.assistant:not([data-rendered-markdown])")) {
  const raw = message.textContent || "";
  message.dataset.renderedMarkdown = "true";
  renderMarkdown(message, raw);
}
