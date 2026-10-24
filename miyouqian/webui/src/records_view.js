// ===========================================================================
// 任务执行记录与日志展示
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
      return '<span class="record-trigger-badge">启动触发</span>';
    case "scheduled":
      return '<span class="record-trigger-badge">定时触发</span>';
    case "manual":
      return '<span class="record-trigger-badge">手动触发</span>';
    case "exchange_scheduler":
      return '<span class="record-trigger-badge">定时兑换</span>';
    case "exchange_manual":
      return '<span class="record-trigger-badge">手动兑换</span>';
    default:
      return trigger ? `<span class="record-trigger-badge">${escapeHtml(trigger)}</span>` : "";
  }
}

function renderRecords(records) {
  const container = $("recordsList");
  if (!container) return;
  if (!records || !records.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>暂无执行记录</strong>
        <span>任务执行完成后，详细的执行阶段与结果汇总将展示在这里。</span>
      </div>
    `;
    return;
  }
  container.innerHTML = records
    .map((record) => {
      const isExchange = record.task_type === "shop_exchange";
      const totalAccounts = record.accounts?.length || 0;
      let summaryText = "";
      if (isExchange) {
        summaryText = `兑换商品: ${escapeHtml(record.goods_name || "-")} · 账号: ${escapeHtml(record.account_name || "-")}`;
      } else {
        summaryText = `执行账号: ${totalAccounts} 个 · 耗时: ${record.duration ? record.duration.toFixed(1) + "s" : "-"}`;
      }

      const accountsHtml = (record.accounts || [])
        .map((acc) => {
          const accBadge = getRecordStatusBadge(acc.status);
          const stagesHtml = (acc.stages || [])
            .map((st) => {
              const succItems = (st.success_items || [])
                .map((it) => `<span class="stage-item success">${escapeHtml(it)}</span>`)
                .join("");
              const failItems = (st.failed_items || [])
                .map((it) => `<span class="stage-item failed">${escapeHtml(it)}</span>`)
                .join("");
              const skipItems = (st.skipped_items || [])
                .map((it) => `<span class="stage-item skipped">${escapeHtml(it)}</span>`)
                .join("");
              const itemsList = [succItems, failItems, skipItems].filter(Boolean).join("");
              const stageStatusClass = st.status === "failed" ? "failed" : (st.status === "skipped" ? "skipped" : "success");
              return `
                <div class="record-stage-row">
                  <div class="record-stage-title">
                    <span class="record-stage-dot ${stageStatusClass}"></span>
                    <strong>${escapeHtml(st.stage_name)}</strong>
                    ${st.message ? `<small>${escapeHtml(st.message)}</small>` : ""}
                  </div>
                  ${itemsList ? `<div class="record-stage-items">${itemsList}</div>` : ""}
                </div>
              `;
            })
            .join("");

          return `
            <div class="record-account-card">
              <div class="record-account-header">
                <div>
                  <strong>${escapeHtml(acc.name || "未命名账号")}</strong>
                  <small>${acc.stuid ? `UID ${escapeHtml(acc.stuid)}` : ""}</small>
                </div>
                ${accBadge}
              </div>
              <div class="record-stages-list">
                ${stagesHtml}
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <article class="record-card">
          <div class="record-card-head">
            <div class="record-meta-main">
              <div class="record-meta-row">
                <span class="record-time">${escapeHtml(formatTime(record.timestamp))}</span>
                ${getRecordStatusBadge(record.status)}
                ${getTriggerBadge(record.trigger)}
              </div>
              <p class="record-summary-line">${summaryText}</p>
              ${record.error ? `<p class="record-error-line">${escapeHtml(record.error)}</p>` : ""}
            </div>
            <button class="ghost icon-only record-collapse-btn" type="button" title="展开/收起详情">
              <svg><use href="#arrow-down"></use></svg>
            </button>
          </div>
          <div class="record-card-body is-hidden">
            ${accountsHtml}
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".record-card-head").forEach((head) => {
    head.addEventListener("click", () => {
      const body = head.parentElement.querySelector(".record-card-body");
      const btn = head.querySelector(".record-collapse-btn");
      if (body) {
        body.classList.toggle("is-hidden");
        btn?.classList.toggle("is-expanded");
      }
    });
  });
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
