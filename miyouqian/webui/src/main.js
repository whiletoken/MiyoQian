// ===========================================================================
// 应用主调度、轮询、事件绑定与启动入口
// ===========================================================================

async function refreshStatus() {
  const needsLogs = activeView === "logs";
  const status = await api(`/api/status?logs=${needsLogs ? "1" : "0"}`);
  const scheduler = status.scheduler || {};
  const exchangeScheduler = status.exchange_scheduler || {};
  const shopExchange = status.shop_exchange || null;
  const login = status.login || {};
  const logs = status.logs || [];
  // 状态横幅已按需移除

  const runningPlans = new Set(exchangeScheduler.running_plans || []);
  const runningCount = exchangeScheduler.running_count ?? runningPlans.size;
  shopRunningProgress = exchangeScheduler.running_progress || {};

  if ($("shopScheduleMetric")) {
    $("shopScheduleMetric").textContent = runningCount > 0
      ? "兑换中"
      : exchangeScheduler.enabled
        ? "已启用"
        : "已关闭";
  }
  if ($("shopNextRun")) {
    $("shopNextRun").textContent = formatTime(exchangeScheduler.next_run);
  }
  if (
    shopExchange &&
    config &&
    !shopRequestInFlight &&
    !isEditingShopConfig()
  ) {
    config.shop_exchange = shopExchange;
    renderShopConfig();
  }
  updateLogs(logs);

  if (login.running) {
    clearLoginCountdown();
    localLoginPanel = null;
    activeLoginIndex = login.account_index ?? activeLoginIndex;
  }
  renderLoginSlot(login);
  $("runBtn").disabled = Boolean(scheduler.running);
  document.querySelectorAll("[data-login]").forEach((button) => {
    button.disabled = Boolean(login.running);
  });
  if (login.status === "success" && lastLoginStatus !== "success") {
    clearLoginCountdown();
    localLoginPanel = null;
    showToast(login.message || "登录成功");
    if (login.draft) {
      applyDraftLogin(login);
      activeLoginIndex = null;
    } else {
      activeLoginIndex = null;
      await loadConfig();
    }
  }
  lastLoginStatus = login.status || "";
}

async function runNow(force = false) {
  await autoSaveConfig();
  const res = await api("/api/run", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
  if (res?.already_signed) {
    if (confirm(`${res.message || "今日已完成打卡签到"}。是否强制重新签到？`)) {
      await runNow(true);
    }
    return;
  }
  showToast("任务已启动");
  await refreshStatus();
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === activeView);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle(
      "is-hidden",
      panel.dataset.viewPanel !== activeView,
    );
  });
  document.querySelectorAll("[data-view-actions]").forEach((actions) => {
    actions.classList.toggle(
      "is-hidden",
      actions.dataset.viewActions !== activeView,
    );
  });
  if (activeView === "shop" && !shopGoods.length) {
    loadShopGoods().catch((error) => showToast(error.message));
  } else if (activeView === "records") {
    loadRecords().catch((error) => showToast(error.message));
  } else if (activeView === "logs") {
    refreshStatus().then(() => {
      logsAutoFollow = true;
      if ($("logsAutoFollowCheck")) $("logsAutoFollowCheck").checked = true;
      renderLogsView();
    }).catch(() => {});
  }
}

function initSelectArrows() {
  document.addEventListener('mousedown', function(e) {
    const select = e.target.closest('select');
    if (!select) return;
    const wrapper = select.closest('.select-wrapper');
    if (!wrapper) return;
    e.stopPropagation();
    wrapper.classList.toggle('arrow-rotated');
  });

  document.addEventListener('change', function(e) {
    const select = e.target.closest('select');
    if (!select) return;
    const wrapper = select.closest('.select-wrapper');
    if (!wrapper) return;
    wrapper.classList.remove('arrow-rotated');
  });

  document.addEventListener('blur', function(e) {
    const select = e.target.closest('select');
    if (!select) return;
    const wrapper = select.closest('.select-wrapper');
    if (!wrapper) return;
    setTimeout(() => {
      if (!select.matches(':focus')) {
        wrapper.classList.remove('arrow-rotated');
      }
    }, 10);
  }, true);

  document.addEventListener('click', function(e) {
    if (e.target.closest('.select-wrapper')) return;
    document.querySelectorAll('.select-wrapper.arrow-rotated').forEach(w => {
      w.classList.remove('arrow-rotated');
    });
  });
}

function injectArrowSymbol() {
  if (document.querySelector('#arrow-down')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.display = 'none';
  const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
  symbol.id = 'arrow-down';
  symbol.setAttribute('viewBox', '0 0 10 6');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M1 1l4 4 4-4');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  symbol.appendChild(path);
  svg.appendChild(symbol);
  document.body.prepend(svg);
}

function bindEvents() {
  document
    .querySelectorAll("summary button, summary input")
    .forEach((control) => {
      control.addEventListener("click", (event) => event.stopPropagation());
    });
  $("shopStatusFilter")?.addEventListener("change", (event) => {
    shopFilterStatus = event.target.value;
    shopCurrentPage = 1;
    renderShopGoods();
  });
  document.addEventListener("change", (event) => {
    if (event.target?.matches?.("[data-autosave]")) {
      if (
        event.target.id === "gameCheckin" ||
        event.target.id === "cloudGameCheckin" ||
        event.target.id === "bbsTasks" ||
        event.target.id === "bbsCheckin"
      ) {
        updateTaskDependencyState();
      }
      scheduleAutoSave();
    }
  });
  document.addEventListener("input", (event) => {
    if (
      event.target?.matches?.(
        'input[type="time"][data-autosave], input[type="datetime-local"][data-autosave], input[type="number"][data-autosave], input[type="text"][data-autosave], select[data-autosave], [data-account-cloud-token][data-autosave]',
      )
    ) {
      scheduleAutoSave();
    }
  });
  $("refreshBtn").addEventListener("click", () => {
    Promise.all([loadConfig(), refreshStatus()]).catch((error) =>
      showToast(error.message),
    );
  });
  $("runBtn").addEventListener("click", () =>
    runNow().catch((error) => showToast(error.message)),
  );
  // 日志现已支持分页无滚动条展示
  $("addAccountBtn").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    addAccount();
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("recordsRefreshBtn")?.addEventListener("click", () =>
    loadRecords().then(() => showToast("记录已刷新")).catch((error) => showToast(error.message)),
  );
  $("recordsClearBtn")?.addEventListener("click", () =>
    clearRecords().catch((error) => showToast(error.message)),
  );
  $("shopRefreshBtn")?.addEventListener("click", () =>
    loadShopGoods().catch((error) => showToast(error.message)),
  );
  $("shopGameFilter")?.addEventListener("change", () =>
    loadShopGoods().catch((error) => showToast(error.message)),
  );

  // 打卡日历事件
  $("calPrevMonth")?.addEventListener("click", () => {
    calCurrentMonth--;
    if (calCurrentMonth < 0) {
      calCurrentMonth = 11;
      calCurrentYear--;
    }
    renderCalendar();
  });
  $("calNextMonth")?.addEventListener("click", () => {
    calCurrentMonth++;
    if (calCurrentMonth > 11) {
      calCurrentMonth = 0;
      calCurrentYear++;
    }
    renderCalendar();
  });
  $("calTodayBtn")?.addEventListener("click", () => {
    const now = new Date();
    calCurrentYear = now.getFullYear();
    calCurrentMonth = now.getMonth();
    calSelectedDate = getTodayDateKey();
    renderCalendar();
    renderDateDetail(calSelectedDate);
  });

  // 日志页面工具栏与翻页事件
  $("logsAutoFollowCheck")?.addEventListener("change", (e) => {
    logsAutoFollow = Boolean(e.target.checked);
    if ($("logsScrollMetric")) {
      $("logsScrollMetric").textContent = logsAutoFollow ? "开启中" : "已暂停";
    }
    if (logsAutoFollow) {
      const totalPages = Math.max(1, Math.ceil(allLogs.length / logsPageSize));
      logsCurrentPage = totalPages;
      renderLogsView();
    }
  });
  $("logsLatestPageBtn")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(allLogs.length / logsPageSize));
    logsCurrentPage = totalPages;
    logsAutoFollow = true;
    if ($("logsAutoFollowCheck")) $("logsAutoFollowCheck").checked = true;
    if ($("logsScrollMetric")) $("logsScrollMetric").textContent = "开启中";
    renderLogsView();
  });
  $("logsAutoScrollBtn")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(allLogs.length / logsPageSize));
    logsCurrentPage = totalPages;
    logsAutoFollow = true;
    if ($("logsAutoFollowCheck")) $("logsAutoFollowCheck").checked = true;
    if ($("logsScrollMetric")) $("logsScrollMetric").textContent = "开启中";
    renderLogsView();
    refreshStatus();
  });
  $("logsPageSizeSelect")?.addEventListener("change", (e) => {
    logsPageSize = Number(e.target.value) || 18;
    const totalPages = Math.max(1, Math.ceil(allLogs.length / logsPageSize));
    if (logsCurrentPage > totalPages) logsCurrentPage = totalPages;
    renderLogsView();
  });
  $("logsClearViewBtn")?.addEventListener("click", () => {
    allLogs = [];
    renderLogsView();
    showToast("视窗日志已清空");
  });
}

bindEvents();
switchView(activeView);

let statusPollingTimer = null;

function schedulePolling() {
  if (statusPollingTimer) clearInterval(statusPollingTimer);
  statusPollingTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    refreshStatus().catch(() => {});
  }, 3000);
}

function startApp() {
  initSelectArrows();
  injectArrowSymbol();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshStatus().catch(() => {});
      }
    });
  }
  loadConfig()
    .then(refreshStatus)
    .catch((error) => {
      showToast(error.message);
    });
  schedulePolling();
}

startApp();
