export function renderMarkdown(container, text) {
  container.textContent = "";

  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/<br\s*\/?\s*>/gi, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
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
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(normalized.slice(lastIndex, match.index)));
    }

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

  if (lastIndex < normalized.length) {
    parent.append(document.createTextNode(normalized.slice(lastIndex)));
  }
}
