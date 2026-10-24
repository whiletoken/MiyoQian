// ===========================================================================
// 任务执行记录、打卡日历与奖励详情展示
// ===========================================================================

async function loadRecords() {
  try {
    const data = await api("/api/records?limit=100");
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

function getRecordDateKey(record) {
  if (record.timestamp) {
    const match = String(record.timestamp).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (record.id) {
    const match = String(record.id).match(/^(\d{4})(\d{2})(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return "";
}

function getTodayDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

function getRecordsByDate() {
  const map = new Map();
  for (const record of taskRecords) {
    const dateKey = getRecordDateKey(record);
    if (!dateKey) continue;
    if (!map.has(dateKey)) {
      map.set(dateKey, []);
    }
    map.get(dateKey).push(record);
  }
  return map;
}

function extractRewardsFromRecord(record) {
  const rewards = [];
  const seen = new Set();

  function addReward(title, subtitle, type, icon) {
    const key = `${title}__${subtitle}`;
    if (seen.has(key)) return;
    seen.add(key);
    rewards.push({ title, subtitle, type, icon: icon || "🎁" });
  }

  // 1. 从 accounts 的 stages 中提取成功项
  const accounts = record.accounts || [];
  for (const acc of accounts) {
    const accName = acc.name || "未命名账号";
    for (const stage of acc.stages || []) {
      for (const item of stage.success_items || []) {
        const itemStr = String(item).trim();
        // 游戏奖励: 「原石」x20 等
        const awardMatch = itemStr.match(/「([^」]+)」x(\d+|\?)/);
        if (awardMatch) {
          const gamePart = itemStr.split(" ")[0] || "";
          addReward(`「${awardMatch[1]}」x${awardMatch[2]}`, `${accName} · ${gamePart || stage.stage}`, "game", "💎");
        } else if (itemStr.includes("分钟免费时长")) {
          const timeMatch = itemStr.match(/获得\s*(\d+)\s*分钟免费时长/);
          const minutes = timeMatch ? timeMatch[1] : "";
          addReward(`云游戏免费时长 +${minutes || "?"}分钟`, `${accName} · ${itemStr.split(" ")[0] || "云游戏"}`, "cloud", "⚡");
        } else if (itemStr.includes("已签到")) {
          const gamePart = itemStr.split(" ")[0] || "";
          addReward(itemStr.replace(/^.+已签到\s*/, "") || "已完成签到", `${accName} · ${gamePart}`, "game", "✓");
        } else if (stage.stage === "米游币商品兑换") {
          addReward(`兑换成功：${itemStr}`, `${accName} · 米游社兑换`, "exchange", "🛍️");
        }
      }
    }
  }

  // 2. 从 logs/messages 中提取米游币增量等信息
  for (const msg of record.messages || []) {
    if (msg.includes("实际已获得") || msg.includes("本次新增")) {
      const match = msg.match(/本次新增\s*(\d+)/) || msg.match(/实际已获得\s*(\d+)/);
      if (match && Number(match[1]) > 0) {
        addReward(`米游币 +${match[1]}`, "米游币社区任务奖励", "bbs", "🪙");
      }
    }
  }

  return rewards;
}

function renderRecords(records) {
  // 横幅状态指标已全部清理

  const todayStr = getTodayDateKey();
  if (!calSelectedDate) {
    const recordsMap = getRecordsByDate();
    if (recordsMap.has(todayStr)) {
      calSelectedDate = todayStr;
    } else if (records.length > 0) {
      calSelectedDate = getRecordDateKey(records[0]) || todayStr;
    } else {
      calSelectedDate = todayStr;
    }
  }

  // 渲染打卡日历
  renderCalendar();

  // 渲染选中日期的记录与奖励详情
  renderDateDetail(calSelectedDate);

  // 保持旧容器 recordsList 存在（若DOM有此元素，填充内容防空指针）
  const container = $("recordsList");
  if (container) {
    container.innerHTML = "";
  }
}

function renderCalendar() {
  const label = $("calMonthLabel");
  const grid = $("calendarDaysGrid");
  if (!label || !grid) return;

  label.textContent = `${calCurrentYear}年 ${calCurrentMonth + 1}月`;

  const recordsMap = getRecordsByDate();
  const todayStr = getTodayDateKey();

  // 当前月第一天星期几 (0:周一, 6:周日)
  const firstDay = new Date(calCurrentYear, calCurrentMonth, 1);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7;

  // 当前月总天数
  const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();

  // 上个月总天数
  const daysInPrevMonth = new Date(calCurrentYear, calCurrentMonth, 0).getDate();

  let html = "";

  // 填充上月占位格
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const prevDay = daysInPrevMonth - i;
    html += `<div class="cal-day-cell is-other-month"><span class="cal-day-num">${prevDay}</span></div>`;
  }

  // 填充当月日期
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayRecords = recordsMap.get(dateStr) || [];
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === calSelectedDate;
    const hasRecords = dayRecords.length > 0;

    let status = "";
    let hasRewards = false;
    if (hasRecords) {
      const anySucc = dayRecords.some((r) => r.status === "success");
      const anyFail = dayRecords.some((r) => r.status === "failed");
      const anyPartial = dayRecords.some((r) => r.status === "partial");
      const allSkip = dayRecords.every((r) => r.status === "skipped");
      if (anyFail && anySucc) status = "partial";
      else if (anyFail) status = "failed";
      else if (anyPartial) status = "partial";
      else if (anySucc) status = "success";
      else if (allSkip) status = "skipped";
      else status = "success";

      for (const rec of dayRecords) {
        const rewards = extractRewardsFromRecord(rec);
        if (rewards.length > 0) {
          hasRewards = true;
          break;
        }
      }
    }

    const classes = [
      "cal-day-cell",
      isToday ? "is-today" : "",
      isSelected ? "is-selected" : "",
      hasRecords ? "has-records" : "",
      status ? `status-${status}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    let indicatorHtml = "";
    if (hasRecords) {
      indicatorHtml = `
        <div class="cal-day-indicator">
          <span class="cal-dot ${status}"></span>
          ${hasRewards ? '<span class="cal-gift-dot" title="当日有奖励">🎁</span>' : ""}
        </div>
      `;
    }

    html += `
      <div class="${classes}" data-cal-date="${dateStr}">
        <span class="cal-day-num">${day}</span>
        ${indicatorHtml}
      </div>
    `;
  }

  grid.innerHTML = html;

  // 绑定点击事件
  grid.querySelectorAll("[data-cal-date]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const targetDate = cell.dataset.calDate;
      if (!targetDate) return;
      calSelectedDate = targetDate;
      renderCalendar();
      renderDateDetail(calSelectedDate);
    });
  });
}

function renderDateDetail(dateStr) {
  const title = $("calDetailDateTitle");
  const subtitle = $("calDetailDateSubtitle");
  const badge = $("calDetailDateBadge");
  const rewardsContainer = $("calDetailRewardsSection");
  const recordsContainer = $("calDetailRecordsList");

  if (!title || !recordsContainer) return;

  const parts = dateStr.split("-");
  const dateFormatted = parts.length === 3 ? `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日` : dateStr;
  title.textContent = `${dateFormatted} 打卡详情`;

  const recordsMap = getRecordsByDate();
  const dayRecords = recordsMap.get(dateStr) || [];

  if (subtitle) {
    subtitle.textContent = dayRecords.length
      ? `当日累计打卡 ${dayRecords.length} 次`
      : "该日期暂未记录打卡签到";
  }

  if (badge) {
    if (dayRecords.length) {
      const anySucc = dayRecords.some((r) => r.status === "success");
      const anyFail = dayRecords.some((r) => r.status === "failed");
      const status = anyFail && anySucc ? "partial" : (anyFail ? "failed" : (anySucc ? "success" : "skipped"));
      badge.innerHTML = getRecordStatusBadge(status);
    } else {
      badge.innerHTML = '<span class="record-badge skipped">无记录</span>';
    }
  }

  // 1. 渲染当日奖励详情
  if (rewardsContainer) {
    if (!dayRecords.length) {
      rewardsContainer.innerHTML = "";
    } else {
      const allRewards = [];
      const seen = new Set();
      for (const rec of dayRecords) {
        const list = extractRewardsFromRecord(rec);
        for (const item of list) {
          const k = `${item.title}_${item.subtitle}`;
          if (!seen.has(k)) {
            seen.add(k);
            allRewards.push(item);
          }
        }
      }

      if (allRewards.length > 0) {
        rewardsContainer.innerHTML = `
          <div class="rewards-block">
            <div class="rewards-block-head">
              <strong>当日获取奖励 (${allRewards.length} 项)</strong>
            </div>
            <div class="rewards-grid">
              ${allRewards
                .map(
                  (r) => `
                <div class="reward-card ${r.type}">
                  <span class="reward-icon">${r.icon}</span>
                  <div class="reward-content">
                    <strong class="reward-title">${escapeHtml(r.title)}</strong>
                    <span class="reward-subtitle">${escapeHtml(r.subtitle)}</span>
                  </div>
                </div>
              `,
                )
                .join("")}
            </div>
          </div>
        `;
      } else {
        rewardsContainer.innerHTML = `
          <div class="rewards-empty-card">
            <span>当日打卡已执行完成，无额外道具或时长入账（已达到签到上限或社区已签）。</span>
          </div>
        `;
      }
    }
  }

  // 2. 渲染当日打卡执行卡片
  if (!dayRecords.length) {
    recordsContainer.innerHTML = `
      <div class="empty-state cal-detail-empty">
        <p>该日期暂无打卡记录</p>
        <span>请在左侧日历点击带有状态标记的日期查看历史打卡记录与奖励详情。</span>
      </div>
    `;
    return;
  }

  recordsContainer.innerHTML = dayRecords
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
