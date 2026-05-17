export function renderMarkdown(container, text) {
  container.textContent = "";

  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isFenceStart(line)) {
      const { node, nextIndex } = renderCodeBlock(lines, index);
      container.append(node);
      index = nextIndex;
      continue;
    }

    if (isTableStart(lines, index)) {
      const { node, nextIndex } = renderTableAsCards(lines, index);
      container.append(node);
      index = nextIndex;
      continue;
    }

    if (/^#{1,4}\s+/.test(line.trim())) {
      const heading = document.createElement("h3");
      appendInline(heading, line.trim().replace(/^#{1,4}\s+/, ""));
      container.append(heading);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const list = document.createElement("ul");
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        const item = document.createElement("li");
        appendInline(item, lines[index].trim().replace(/^[-*]\s+/, ""));
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line.trim())) {
      const list = document.createElement("ol");
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        const item = document.createElement("li");
        appendInline(item, lines[index].trim().replace(/^\d+[.)]\s+/, ""));
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    const paragraphLines = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isFenceStart(lines[index]) &&
      !/^#{1,4}\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+[.)]\s+/.test(lines[index].trim()) &&
      !isTableStart(lines, index)
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join(" "));
    container.append(paragraph);
  }
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

function isFenceStart(line) {
  return /^```/.test(String(line || "").trim());
}

function renderCodeBlock(lines, index) {
  const firstLine = lines[index].trim();
  const language = firstLine.replace(/^```/, "").trim() || "code";
  index += 1;

  const codeLines = [];
  while (index < lines.length && !isFenceStart(lines[index])) {
    codeLines.push(lines[index]);
    index += 1;
  }
  if (index < lines.length && isFenceStart(lines[index])) index += 1;

  const code = codeLines.join("\n").replace(/\n+$/g, "");

  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-block-header";

  const label = document.createElement("span");
  label.className = "code-block-language";
  label.textContent = language;

  const copyButton = document.createElement("button");
  copyButton.className = "copy-button code-copy-button";
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", () => copyWithStatus(copyButton, code));

  header.append(label, copyButton);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  pre.append(codeEl);

  wrapper.append(header, pre);
  return { node: wrapper, nextIndex: index };
}

function isTableStart(lines, index) {
  const current = lines[index]?.trim() || "";
  const next = lines[index + 1]?.trim() || "";
  return current.startsWith("|") && current.endsWith("|") && /^\|?\s*[-:]+/.test(next);
}

function renderTableAsCards(lines, index) {
  const headers = splitTableRow(lines[index]);
  index += 2;

  const wrapper = document.createElement("div");
  wrapper.className = "markdown-cards";

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line.startsWith("|") || !line.endsWith("|")) break;

    const cells = splitTableRow(line);
    const card = document.createElement("div");
    card.className = "markdown-card";

    cells.forEach((cell, cellIndex) => {
      const row = document.createElement("div");
      row.className = "markdown-card-row";

      const label = document.createElement("strong");
      label.textContent = `${headers[cellIndex] || `Item ${cellIndex + 1}`}:`;

      const value = document.createElement("span");
      appendInline(value, cell);

      row.append(label, value);
      card.append(row);
    });

    wrapper.append(card);
    index += 1;
  }

  return { node: wrapper, nextIndex: index };
}

function splitTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function appendInline(parent, text) {
  const normalized = String(text || "").replace(/<br\s*\/?\s*>/gi, " ");
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    if (match.index > lastIndex) parent.append(document.createTextNode(normalized.slice(lastIndex, match.index)));

    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("*")) {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      parent.append(em);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        const link = document.createElement("a");
        link.textContent = linkMatch[1];
        link.href = linkMatch[2];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      } else {
        parent.append(document.createTextNode(token));
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < normalized.length) parent.append(document.createTextNode(normalized.slice(lastIndex)));
}

function copyWithStatus(button, text) {
  const oldText = button.textContent;
  copyText(text)
    .then(() => {
      button.textContent = "Copied";
      button.classList.add("copied");
    })
    .catch(() => {
      button.textContent = "Failed";
    })
    .finally(() => {
      window.setTimeout(() => {
        button.textContent = oldText;
        button.classList.remove("copied");
      }, 1200);
    });
}
