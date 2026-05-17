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

  if (!form || !prompt || !sendButton || !messages || !conversation || !modelSelect) {
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

  const scroller = container.closest(".conversation");
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }

  return message;
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

export function addConversationItem(container, title) {
  if (!container) return;

  const empty = container.querySelector(".empty-conversations");
  if (empty) empty.remove();

  const button = document.createElement("button");
  button.className = "conversation-item";
  button.type = "button";
  button.textContent = title;
  container.prepend(button);
}

export function resetConversationList(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-conversations">No conversations yet</p>';
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

function getAvatarText(role) {
  if (role === "user") return "U";
  if (role === "error") return "!";
  return "AI";
}
