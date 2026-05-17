export function getChatElements() {
  const form = document.querySelector("#chat-form");
  const prompt = document.querySelector("#prompt");
  const sendButton = document.querySelector("#send-button");
  const messages = document.querySelector("#messages");
  const menuButton = document.querySelector("#menu-button");
  const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
  const promptChips = Array.from(document.querySelectorAll(".prompt-chip"));
  const conversation = document.querySelector(".conversation");

  if (!form || !prompt || !sendButton || !messages || !conversation) {
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

export function setLoading(sendButton, isLoading) {
  sendButton.disabled = isLoading;
  sendButton.textContent = isLoading ? "…" : "↑";
}

export function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
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
