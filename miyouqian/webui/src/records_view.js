// ===========================================================================
// 任务执行记录与数据统计展示
// ===========================================================================

async function loadRecords() {
  try {
    const data = await api("/api/records?limit=50");
    taskRecords = data.records || [];
    renderRecords(taskRecords);
  } catch (error) {
    showToast(`加载记录失败: ${error.message}`);
  }
}

async function clearRecords() {
  if (!confirm("确定要清空全部任务执行记录吗？此操作不可撤销。")) {
    return;
  }
  try {
    await api("/api/records/clear", { method: "POST" });
    showToast("执行记录已清空");
    await loadRecords();
  } catch (error) {
    showToast(`清空记录失败: ${error.message}`);
  }
}

function getRecordStatusBadge(status) {
  switch (status) {
    case "success":
      return '<span class="record-badge success">全部成功</span>';
    case "partial":
      return '<span class="record-badge partial">部分成功</span>';
    case "failed":
      return '<span class="record-badge failed">执行失败</span>';
    case "skipped":
      return '<span class="record-badge skipped">已跳过</span>';
    default:
      return `<span class="record-badge">${escapeHtml(status || "未知")}</span>`;
  }
}

function getTriggerBadge(trigger) {
  switch (trigger) {
    case "startup":
      return '<span class="record-badge trigger">启动触发</span>';
    case "scheduled":
      return '<span class="record-badge trigger">定时触发</span>';
    case "patrol":
    case "retry":
      return '<span class="record-badge trigger">巡检重试</span>';
    case "manual":
      return '<span class="record-badge trigger">手动触发</span>';
    case "exchange_scheduler":
    case "exchange_plan":
      return '<span class="record-badge trigger">定时兑换</span>';
    case "exchange_manual":
    case "exchange":
      return '<span class="record-badge trigger">商品兑换</span>';
    case "cli":
      return '<span class="record-badge trigger">命令行</span>';
    default:
      return `<span class="record-badge trigger">${escapeHtml(trigger || "触发")}</span>`;
  }
}

function renderRecords(records) {
  const container = $("recordsList");
  const emptyBox = $("recordsEmpty");
  if (!container) return;

  const total = records.length;
  if ($("recordsTotalMetric")) $("recordsTotalMetric").textContent = String(total);
  if (total > 0) {
    const latest = records[0];
    if ($("recordsLatestStatusMetric")) $("recordsLatestStatusMetric").innerHTML = getRecordStatusBadge(latest.status);
    if ($("recordsLatestTimeMetric")) $("recordsLatestTimeMetric").textContent = formatTime(latest.timestamp).slice(5);
    const succCount = records.filter((r) => r.status === "success").length;
    const rate = Math.round((succCount / total) * 100);
    if ($("recordsSuccessRateMetric")) $("recordsSuccessRateMetric").textContent = `${rate}%`;
  } else {
    if ($("recordsLatestStatusMetric")) $("recordsLatestStatusMetric").textContent = "-";
    if ($("recordsLatestTimeMetric")) $("recordsLatestTimeMetric").textContent = "-";
    if ($("recordsSuccessRateMetric")) $("recordsSuccessRateMetric").textContent = "-";
  }

  if (total === 0) {
    container.innerHTML = "";
    emptyBox?.classList.remove("is-hidden");
    return;
  }
  emptyBox?.classList.add("is-hidden");

  container.innerHTML = records
    .map((record, index) => {
      const accounts = record.accounts || [];
      const messages = record.messages || [];

      const accountsHtml = accounts
        .map((acc) => {
          const stagesHtml = (acc.stages || [])
            .map((st) => {
              const succItems = (st.success_items || [])
                .map((item) => `<span class="record-item-pill ok">${escapeHtml(item)}</span>`)
                .join("");
              const failItems = (st.failed_items || [])
                .map((item) => `<span class="record-item-pill err">${escapeHtml(item)}</span>`)
                .join("");
              const skipItems = (st.skipped_items || [])
                .map((item) => `<span class="record-item-pill skip">${escapeHtml(item)}</span>`)
                .join("");
              return `
                <div class="record-stage-row">
                  <div class="record-stage-name">
                    <span>${escapeHtml(st.stage || st.stage_name || "阶段任务")}</span>
                    ${getRecordStatusBadge(st.status)}
                  </div>
                  ${
                    succItems || failItems || skipItems
                      ? `
                    <div class="record-items-group">
                      ${succItems}
                      ${failItems}
                      ${skipItems}
                    </div>
                  `
                      : ""
                  }
                </div>
              `;
            })
            .join("");

          return `
            <div class="record-account-card">
              <div class="record-account-header">
                <span class="record-account-title">${escapeHtml(acc.name || "未命名账号")} ${acc.stuid ? `<small>(${escapeHtml(acc.stuid)})</small>` : ""}</span>
                ${getRecordStatusBadge(acc.status)}
              </div>
              <div class="record-stage-list">
                ${stagesHtml || '<span class="record-duration">暂无阶段详情</span>'}
              </div>
            </div>
          `;
        })
        .join("");

      const logsHtml =
        messages.length > 0
          ? `
        <div>
          <button class="record-logs-toggle" type="button" onclick="this.nextElementSibling.classList.toggle('is-hidden')">查看完整执行日志 (${messages.length} 行)</button>
          <pre class="record-logs-pre is-hidden">${escapeHtml(messages.join("\n"))}</pre>
        </div>
      `
          : "";

      return `
        <article class="record-card ${index === 0 ? "is-open" : ""}" data-record-id="${escapeHtml(record.id || "")}">
          <div class="record-head" onclick="this.parentElement.classList.toggle('is-open')">
            <div class="record-meta">
              ${getRecordStatusBadge(record.status)}
              ${getTriggerBadge(record.trigger)}
              <span class="record-time">${escapeHtml(record.timestamp || "-")}</span>
              <span class="record-duration">耗时 ${escapeHtml(String(record.duration_seconds ?? 0))}s</span>
            </div>
            <div class="record-summary-line">
              <span>${escapeHtml(record.summary_text || "")}</span>
              <span class="record-arrow">▼</span>
            </div>
          </div>
          <div class="record-body">
            ${accountsHtml || `<p class="record-duration">${escapeHtml(record.summary_text || "无账号详情")}</p>`}
            ${logsHtml}
          </div>
        </article>
      `;
    })
    .join("");
}

function latestResultText(scheduler, login, logs) {
  if (scheduler.running) return "正在签到";
  if (scheduler.last_error) return "任务失败";
  const latest = [...logs].reverse().find((line) => {
    return /任务汇总|签到汇总|签到成功|社区任务结束|获得|任务执行完成|登录成功|失败|触发验证码/.test(
      line,
    );
  });
  if (latest) {
    if (latest.includes("云游戏成功项")) return "云游戏成功";
    if (latest.includes("云游戏失败项")) return "云游戏部分失败";
    if (latest.includes("游戏社区成功项") || latest.includes("游戏成功项"))
      return "社区签到成功";
    if (latest.includes("游戏社区失败项") || latest.includes("游戏失败项"))
      return "社区部分失败";
    if (latest.includes("米游币任务汇总")) {
      const points = latest.match(/实际已获得\s*([^，\s]+)/);
      return points ? `米游币 ${points[1]}` : "米游币完成";
    }
    if (latest.includes("云游戏签到汇总"))
      return latest.includes("失败 0") ? "云游戏成功" : "云游戏部分失败";
    if (
      latest.includes("游戏社区签到汇总") ||
      latest.includes("游戏签到汇总")
    ) {
      return latest.includes("失败 0") ? "社区签到成功" : "社区部分失败";
    }
    if (latest.includes("社区任务结束")) {
      const points = latest.match(/今日已得\s*([^，\s]+)/);
      return points ? `米游币 ${points[1]}` : "米游币完成";
    }
    if (latest.includes("签到成功")) return "签到成功";
    if (latest.includes("任务执行完成")) return "任务完成";
    if (latest.includes("登录成功")) return "登录成功";
    if (latest.includes("触发验证码")) return "需要验证";
    if (latest.includes("失败")) return "任务失败";
    if (latest.includes("获得")) return "奖励已获取";
  }
  if (login.status && login.status !== "idle")
    return loginStatusText(login.status);
  if (scheduler.last_run) return "任务完成";
  return "-";
}
