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

function getVisiblePages(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [];
  pages.push(1);
  let left = current - 1;
  let right = current + 1;
  if (current <= 3) {
    left = 2;
    right = 4;
  }
  if (current >= total - 2) {
    left = total - 3;
    right = total - 1;
  }
  if (left > 2) pages.push("...");
  for (let i = left; i <= right; i++) {
    if (i > 1 && i < total) pages.push(i);
  }
  if (right < total - 1) pages.push("...");
  pages.push(total);
  return pages;
}

function updateLogs(logs) {
  allLogs = logs || [];
  renderLogsView();
  if ($("logsTotalMetric")) {
    $("logsTotalMetric").textContent = `${allLogs.length} 行`;
  }
  if ($("logsLatestTimeMetric") && allLogs.length > 0) {
    const lastLine = allLogs[allLogs.length - 1];
    const match = lastLine.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (match) {
      $("logsLatestTimeMetric").textContent = match[1].slice(5);
    }
  }
}

function renderLogsView() {
  const logBox = $("logs");
  if (!logBox) return;
  const totalLines = allLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalLines / logsPageSize));

  if (logsAutoFollow || logsCurrentPage > totalPages) {
    logsCurrentPage = totalPages;
  }
  if (logsCurrentPage < 1) logsCurrentPage = 1;

  const startIndex = (logsCurrentPage - 1) * logsPageSize;
  const endIndex = Math.min(totalLines, startIndex + logsPageSize);
  const pageLines = allLogs.slice(startIndex, endIndex);

  logBox.textContent = pageLines.length ? pageLines.join("\n") : "（暂无运行日志）";

  renderLogsPagination(totalLines, totalPages);
}

function renderLogsPagination(totalLines, totalPages) {
  const container = $("logsPagination");
  if (!container) return;

  if (totalLines <= logsPageSize) {
    container.innerHTML = `<span class="page-info">共 ${totalLines} 行 · 第 1/1 页</span>`;
    return;
  }

  const current = logsCurrentPage;
  let html = `
    <button class="ghost page-btn" data-log-page="first" ${current <= 1 ? "disabled" : ""} title="首页">首页</button>
    <button class="ghost page-btn" data-log-page="prev" ${current <= 1 ? "disabled" : ""} title="上一页">
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M7 1L3 5l4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
    </button>
  `;

  const pages = getVisiblePages(current, totalPages);
  for (const p of pages) {
    if (p === "...") {
      html += `<span class="page-ellipsis">…</span>`;
    } else {
      html += `<button class="ghost page-btn ${p === current ? "is-active" : ""}" data-log-page="${p}">${p}</button>`;
    }
  }

  html += `
    <button class="ghost page-btn" data-log-page="next" ${current >= totalPages ? "disabled" : ""} title="下一页">
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
    </button>
    <button class="ghost page-btn" data-log-page="latest" ${current >= totalPages ? "disabled" : ""} title="最新一页">最新页</button>
    <span class="page-info">共 ${totalLines} 行 · 第 ${current}/${totalPages} 页</span>
  `;

  container.innerHTML = html;

  container.querySelectorAll("[data-log-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.logPage;
      if (page === "first") {
        logsCurrentPage = 1;
        logsAutoFollow = false;
      } else if (page === "prev" && logsCurrentPage > 1) {
        logsCurrentPage--;
        logsAutoFollow = false;
      } else if (page === "next" && logsCurrentPage < totalPages) {
        logsCurrentPage++;
        if (logsCurrentPage === totalPages) logsAutoFollow = true;
      } else if (page === "latest") {
        logsCurrentPage = totalPages;
        logsAutoFollow = true;
      } else if (Number(page)) {
        logsCurrentPage = Number(page);
        logsAutoFollow = logsCurrentPage === totalPages;
      }
      const check = $("logsAutoFollowCheck");
      if (check) check.checked = logsAutoFollow;
      renderLogsView();
    });
  });
}

function scrollLogsToBottom() {
  const totalPages = Math.max(1, Math.ceil(allLogs.length / logsPageSize));
  logsCurrentPage = totalPages;
  logsAutoFollow = true;
  renderLogsView();
}

function isScrolledNearBottom(element) {
  return true;
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
