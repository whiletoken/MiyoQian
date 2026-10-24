// ===========================================================================
// 通用工具函数与网络通信
// ===========================================================================

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    error.code = data.code || "";
    error.aigis = data.aigis;
    error.data = data;
    throw error;
  }
  return data;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function formatTime(value) {
  if (!value) return "-";
  return value.replace("T", " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function timestampToLocalInput(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  const date = new Date((timestamp + 8 * 60 * 60) * 1000);
  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function localInputToTimestamp(value) {
  if (!value) return 0;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, year, month, day, hour, minute] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    0,
  );
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function timestampToIso(value) {
  const timestamp = Number(value || 0);
  return timestamp ? timestampToBeijingText(timestamp) : "";
}

function timestampToBeijingText(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  const date = new Date((timestamp + 8 * 60 * 60) * 1000);
  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 通过局域网 http 访问时 Clipboard API 不可用，回退到 execCommand
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("复制失败，请在规范弹窗中手动选中复制");
}

function updateLogs(logs) {
  const logBox = $("logs");
  if (!logBox) return;
  const wasPinned = logsPinnedToBottom || isScrolledNearBottom(logBox);
  const nextText = logs.join("\n");
  if (logBox.textContent !== nextText) {
    logBox.textContent = nextText;
    if (wasPinned) {
      requestAnimationFrame(() => scrollLogsToBottom());
    }
  }
  if ($("logsTotalMetric")) {
    $("logsTotalMetric").textContent = `${logs.length} 行`;
  }
  if ($("logsLatestTimeMetric") && logs.length > 0) {
    const lastLine = logs[logs.length - 1];
    const match = lastLine.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (match) {
      $("logsLatestTimeMetric").textContent = match[1].slice(5);
    }
  }
}

function scrollLogsToBottom() {
  const logBox = $("logs");
  logBox.scrollTop = logBox.scrollHeight;
  logsPinnedToBottom = true;
}

function isScrolledNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
}

async function withButtonLoading(button, loadingText, task) {
  if (!button) {
    shopRequestInFlight = true;
    try {
      await task();
    } finally {
      shopRequestInFlight = false;
    }
    return;
  }
  if (button.disabled) return;
  const label = button.querySelector("span");
  const originalText = label?.textContent || "";
  shopRequestInFlight = true;
  button.disabled = true;
  button.classList.add("is-loading");
  if (label) label.textContent = loadingText;
  try {
    await task();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    if (label) label.textContent = originalText;
    shopRequestInFlight = false;
  }
}
