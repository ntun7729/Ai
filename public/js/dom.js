export function getChatElements() {
  const form = document.querySelector("#chat-form");
  const prompt = document.querySelector("#prompt");
  const sendButton = document.querySelector("#send-button");
  const messages = document.querySelector("#messages");
  const menuButton = document.querySelector("#menu-button");
  const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
  const promptChips = Array.from(document.querySelectorAll(".prompt-chip"));
  const conversation = document.querySelector(".conversation");
  const modelSelect = document.querySelector("#model-select");
  const modelBadge = document.querySelector("#model-badge");
  const mobileModelLabel = document.querySelector("#mobile-model-label");
  const conversationList = document.querySelector("#conversation-list");
  const newChatButton = document.querySelector("#new-chat-button");
  const thinkingToggle = document.querySelector("#thinking-toggle");
  const attachmentButton = document.querySelector("#attachment-button");
  const attachmentMenu = document.querySelector("#attachment-menu");
  const attachmentPreview = document.querySelector("#attachment-preview");
  const imageInput = document.querySelector("#image-input");
  const cameraInput = document.querySelector("#camera-input");
  const fileInput = document.querySelector("#file-input");

  if (!form || !prompt || !sendButton || !messages || !conversation || !modelSelect || !thinkingToggle) {
    throw new Error("Chat UI is missing required elements");
  }

  return {
    form,
    prompt,
    sendButton,
    messages,
    menuButton,
    sidebarBackdrop,
    promptChips,
    conversation,
    modelSelect,
    modelBadge,
    mobileModelLabel,
    conversationList,
    newChatButton,
    thinkingToggle,
    attachmentButton,
    attachmentMenu,
    attachmentPreview,
    imageInput,
    cameraInput,
    fileInput,
  };
}

export function addMessage(container, role, content) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = getAvatarText(role);

  const message = document.createElement("div");
  message.className = `message ${role}`;
  setMessageContent(message, role, content);

  row.append(avatar, message);
  container.append(row);
  scrollMessages(container);

  return message;
}

export function updateMessage(message, content) {
  if (!message) return;
  const role = message.classList.contains("assistant") ? "assistant" : message.classList.contains("error") ? "error" : "user";
  setMessageContent(message, role, content);
  const container = message.closest("#messages");
  if (container) scrollMessages(container);
}

export function renderMessages(container, displayMessages) {
  clearMessages(container);

  for (const message of displayMessages) {
    addMessage(container, message.role, message.content);
  }
}

export function clearMessages(container) {
  container.textContent = "";
}

export function setLoading(sendButton, isLoading) {
  sendButton.disabled = isLoading;
  sendButton.textContent = isLoading ? "..." : "↑";
}

export function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
}

export function setModelLabels(model, modelBadge, mobileModelLabel) {
  if (modelBadge) modelBadge.textContent = model;
  if (mobileModelLabel) mobileModelLabel.textContent = model;
}

export function renderConversationList(container, sessions, activeSessionId, onSelectSession, onDeleteSession) {
  if (!container) return;

  container.textContent = "";

  const visibleSessions = sessions.filter((session) => session.hasUserMessage);
  if (visibleSessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-conversations";
    empty.textContent = "No conversations yet";
    container.append(empty);
    return;
  }

  for (const session of visibleSessions) {
    const row = document.createElement("div");
    row.className = "conversation-list-row";
    row.dataset.sessionId = session.id;

    const button = document.createElement("button");
    button.className = "conversation-item";
    button.type = "button";
    button.textContent = session.title;
    button.dataset.sessionId = session.id;
    button.setAttribute("aria-pressed", session.id === activeSessionId ? "true" : "false");
    button.addEventListener("click", () => onSelectSession(session.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "conversation-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.title = "Delete conversation";
    deleteButton.setAttribute("aria-label", `Delete conversation: ${session.title}`);
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onDeleteSession?.(session.id);
    });

    row.append(button, deleteButton);
    container.append(row);
  }
}

export function setupMobileSidebar({ menuButton, sidebarBackdrop }) {
  if (!menuButton || !sidebarBackdrop) return;

  const closeSidebar = () => {
    document.body.classList.remove("sidebar-open");
    menuButton.setAttribute("aria-expanded", "false");
    sidebarBackdrop.hidden = true;
  };

  const openSidebar = () => {
    document.body.classList.add("sidebar-open");
    menuButton.setAttribute("aria-expanded", "true");
    sidebarBackdrop.hidden = false;
  };

  menuButton.addEventListener("click", () => {
    if (document.body.classList.contains("sidebar-open")) closeSidebar();
    else openSidebar();
  });

  sidebarBackdrop.addEventListener("click", closeSidebar);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });
}

export function setupAttachmentPicker(elements, onAttachmentSelected, onAttachmentCleared) {
  const { attachmentButton, attachmentMenu, imageInput, cameraInput, fileInput, attachmentPreview } = elements;
  if (!attachmentButton || !attachmentMenu || !attachmentPreview) return;

  const closeMenu = () => {
    attachmentMenu.hidden = true;
    attachmentButton.setAttribute("aria-expanded", "false");
  };

  attachmentButton.addEventListener("click", () => {
    const willOpen = attachmentMenu.hidden;
    attachmentMenu.hidden = !willOpen;
    attachmentButton.setAttribute("aria-expanded", String(willOpen));
  });

  attachmentMenu.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-attachment-action]");
    if (!button) return;
    closeMenu();
    if (button.dataset.attachmentAction === "image") imageInput?.click();
    if (button.dataset.attachmentAction === "camera") cameraInput?.click();
    if (button.dataset.attachmentAction === "file") fileInput?.click();
  });

  for (const input of [imageInput, cameraInput, fileInput]) {
    input?.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      onAttachmentSelected(file);
      input.value = "";
    });
  }

  document.addEventListener("click", (event) => {
    if (attachmentMenu.hidden) return;
    if (attachmentMenu.contains(event.target) || attachmentButton.contains(event.target)) return;
    closeMenu();
  });

  attachmentPreview.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-clear-attachment]");
    if (!button) return;
    attachmentPreview.hidden = true;
    attachmentPreview.textContent = "";
    onAttachmentCleared();
  });
}

export function showAttachmentPreview(container, attachment) {
  if (!container) return;
  container.hidden = false;
  container.textContent = "";

  if (attachment.kind === "image") {
    const img = document.createElement("img");
    img.src = attachment.dataUrl;
    img.alt = attachment.name;
    container.append(img);
  }

  const label = document.createElement("span");
  label.textContent = attachment.kind === "image" ? `Image: ${attachment.name}` : `File: ${attachment.name}`;

  const clear = document.createElement("button");
  clear.type = "button";
  clear.dataset.clearAttachment = "true";
  clear.textContent = "Remove";

  container.append(label, clear);
}

export function hideAttachmentPreview(container) {
  if (!container) return;
  container.hidden = true;
  container.textContent = "";
}

function setMessageContent(message, role, content) {
  const text = String(content || "");
  message.textContent = "";
  message.dataset.rawContent = text;

  if (role === "assistant") {
    renderMarkdown(message, text);
    if (text.trim()) appendCopyResponseButton(message, text);
    return;
  }

  message.textContent = text;
}

function renderMarkdown(container, text) {
  const blocks = splitCodeBlocks(text);
  for (const block of blocks) {
    if (block.type === "code") {
      container.append(createCodeBlock(block.language, block.content));
    } else {
      renderTextBlock(container, block.content);
    }
  }
}

function splitCodeBlocks(text) {
  const blocks = [];
  const regex = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) blocks.push({ type: "text", content: text.slice(lastIndex, match.index) });
    blocks.push({ type: "code", language: match[1].trim() || "Code", content: match[2].replace(/\n$/, "") });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) blocks.push({ type: "text", content: text.slice(lastIndex) });
  return blocks.length ? blocks : [{ type: "text", content: text }];
}

function renderTextBlock(container, text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    renderInlineMarkdown(p, paragraph.join(" ").trim());
    container.append(p);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    container.append(list);
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const table = collectMarkdownTable(lines, index);
    if (table) {
      flushParagraph();
      flushList();
      container.append(createMarkdownTableCards(table.headers, table.rows));
      index = table.nextIndex - 1;
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      container.append(document.createElement("hr"));
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = String(heading[1]).length + 1;
      const h = document.createElement(`h${level}`);
      renderInlineMarkdown(h, heading[2]);
      container.append(h);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list) list = document.createElement("ul");
      const li = document.createElement("li");
      renderInlineMarkdown(li, bullet[1]);
      list.append(li);
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (!list || list.tagName !== "OL") list = document.createElement("ol");
      const li = document.createElement("li");
      renderInlineMarkdown(li, numbered[1]);
      list.append(li);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
}

function collectMarkdownTable(lines, startIndex) {
  const headerLine = lines[startIndex]?.trim() || "";
  const separatorLine = lines[startIndex + 1]?.trim() || "";
  if (!isMarkdownTableRow(headerLine) || !isMarkdownTableSeparator(separatorLine)) return null;

  const headers = parseMarkdownTableCells(headerLine);
  if (headers.length < 2) return null;

  const rows = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const rowLine = lines[nextIndex].trim();
    if (!isMarkdownTableRow(rowLine)) break;
    const cells = parseMarkdownTableCells(rowLine);
    if (cells.some((cell) => cell.trim())) rows.push(cells);
    nextIndex += 1;
  }

  if (!rows.length) return null;
  return { headers, rows, nextIndex };
}

function isMarkdownTableRow(line) {
  if (!line.includes("|")) return false;
  return /^\|.*\|$/.test(line.trim());
}

function isMarkdownTableSeparator(line) {
  if (!isMarkdownTableRow(line)) return false;
  const cells = parseMarkdownTableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseMarkdownTableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function createMarkdownTableCards(headers, rows) {
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-table-cards";

  const titleIndex = Math.max(
    0,
    headers.findIndex((header) => /^(story|headline|topic|title|source)$/i.test(header.trim())),
  );

  for (const row of rows) {
    const card = document.createElement("section");
    card.className = "markdown-table-card";

    const titleText = row[titleIndex] || row.find((cell) => cell.trim()) || "Item";
    if (titleText) {
      const title = document.createElement("h4");
      title.className = "markdown-table-card-title";
      renderInlineMarkdown(title, titleText);
      card.append(title);
    }

    headers.forEach((header, index) => {
      const value = row[index] || "";
      if (!value.trim()) return;

      const field = document.createElement("div");
      field.className = "markdown-table-field";

      const label = document.createElement("span");
      label.className = "markdown-table-label";
      label.textContent = header.trim() || `Column ${index + 1}`;

      const body = document.createElement("p");
      body.className = "markdown-table-value";
      renderInlineMarkdown(body, value);

      field.append(label, body);
      card.append(field);
    });

    wrapper.append(card);
  }

  return wrapper;
}

function renderInlineMarkdown(parent, text) {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      const anchor = document.createElement("a");
      anchor.textContent = linkMatch?.[1] || token;
      anchor.href = linkMatch?.[2] || "#";
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      parent.append(anchor);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) parent.append(document.createTextNode(text.slice(lastIndex)));
}

function createCodeBlock(language, codeText) {
  const shell = document.createElement("div");
  shell.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-block-header";

  const label = document.createElement("span");
  label.textContent = language || "Code";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-code-button";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    await copyText(codeText, copy, "Copied");
  });

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = codeText;
  pre.append(code);

  header.append(label, copy);
  shell.append(header, pre);
  return shell;
}

function appendCopyResponseButton(message, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-response-button";
  button.textContent = "Copy response";
  button.addEventListener("click", async () => {
    await copyText(text, button, "Copied");
  });
  message.append(button);
}

async function copyText(text, button, copiedLabel) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = copiedLabel;
    window.setTimeout(() => {
      button.textContent = original;
    }, 1100);
  } catch {
    button.textContent = "Copy failed";
  }
}

function scrollMessages(container) {
  const scroller = container.closest(".conversation");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function getAvatarText(role) {
  if (role === "user") return "U";
  if (role === "error") return "!";
  return "AI";
}
