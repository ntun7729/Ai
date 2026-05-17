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
  message.textContent = content;

  row.append(avatar, message);
  container.append(row);
  scrollMessages(container);

  return message;
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
  sendButton.textContent = isLoading ? "…" : "↑";
}

export function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
}

export function setModelLabels(model, modelBadge, mobileModelLabel) {
  if (modelBadge) modelBadge.textContent = model;
  if (mobileModelLabel) mobileModelLabel.textContent = model;
}

export function renderConversationList(container, sessions, activeSessionId, onSelectSession) {
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
    const button = document.createElement("button");
    button.className = "conversation-item";
    button.type = "button";
    button.textContent = session.title;
    button.dataset.sessionId = session.id;
    button.setAttribute("aria-pressed", session.id === activeSessionId ? "true" : "false");
    button.addEventListener("click", () => onSelectSession(session.id));
    container.append(button);
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
    if (document.body.classList.contains("sidebar-open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  sidebarBackdrop.addEventListener("click", closeSidebar);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });
}

export function setupAttachmentPlaceholder(elements) {
  const { attachmentButton, attachmentMenu, imageInput, fileInput, attachmentPreview } = elements;
  if (!attachmentButton || !attachmentMenu || !attachmentPreview) return;

  const closeMenu = () => {
    attachmentMenu.hidden = true;
    attachmentButton.setAttribute("aria-expanded", "false");
  };

  attachmentButton.addEventListener("click", () => {
    const open = attachmentMenu.hidden;
    attachmentMenu.hidden = !open;
    attachmentButton.setAttribute("aria-expanded", String(open));
  });

  attachmentMenu.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-attachment-action]");
    if (!button) return;
    closeMenu();
    if (button.dataset.attachmentAction === "image") imageInput?.click();
    if (button.dataset.attachmentAction === "file") fileInput?.click();
  });

  for (const input of [imageInput, fileInput]) {
    input?.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      attachmentPreview.hidden = false;
      attachmentPreview.textContent = `Attached: ${file.name} - upload support coming next`;
      input.value = "";
    });
  }

  document.addEventListener("click", (event) => {
    if (attachmentMenu.hidden) return;
    if (attachmentMenu.contains(event.target) || attachmentButton.contains(event.target)) return;
    closeMenu();
  });
}

function scrollMessages(container) {
  const scroller = container.closest(".conversation");
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function getAvatarText(role) {
  if (role === "user") return "U";
  if (role === "error") return "!";
  return "AI";
}
