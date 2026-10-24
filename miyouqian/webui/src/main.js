// ===========================================================================
// 应用主调度、轮询、事件绑定与启动入口
// ===========================================================================

async function refreshStatus() {
  const status = await api("/api/status");
  const scheduler = status.scheduler || {};
  const exchangeScheduler = status.exchange_scheduler || {};
  const shopExchange = status.shop_exchange || null;
  const login = status.login || {};
  const logs = status.logs || [];
  const accounts = config?.accounts || [];
  const loggedIn = accounts.filter((account) => account.stuid).length;
  $("accountMetric").textContent = `${loggedIn}/${accounts.length}`;
  $("scheduleMetric").textContent = scheduler.running
    ? "执行中"
    : scheduler.jitter_waiting
      ? "延后中"
      : scheduler.enabled
        ? (scheduler.thread_alive === false ? "异常停止" : "已启用")
        : "已关闭";
  $("nextRun").textContent = scheduler.jitter_waiting
    ? `预计 ${formatTime(scheduler.jitter_until || scheduler.next_run)}`
    : formatTime(scheduler.next_run);
  const latestRec = status.latest_record;
  if (latestRec) {
    const statusLabel = latestRec.status === "success"
      ? "全部成功"
      : (latestRec.status === "partial" ? "部分成功" : (latestRec.status === "failed" ? "执行失败" : "已跳过"));
    $("lastResult").textContent = `${statusLabel} (${formatTime(latestRec.timestamp).slice(5)})`;
  } else {
    $("lastResult").textContent = latestResultText(scheduler, login, logs);
  }

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
    scrollLogsToBottom();
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
  $("logs").addEventListener("scroll", () => {
    logsPinnedToBottom = isScrolledNearBottom($("logs"));
  });
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

  // 日志页面工具栏事件
  $("logsAutoScrollCheck")?.addEventListener("change", (e) => {
    logsPinnedToBottom = Boolean(e.target.checked);
    if ($("logsScrollMetric")) {
      $("logsScrollMetric").textContent = logsPinnedToBottom ? "开启中" : "已暂停";
    }
    if (logsPinnedToBottom) scrollLogsToBottom();
  });
  $("logsScrollBottomBtn")?.addEventListener("click", () => {
    scrollLogsToBottom();
  });
  $("logsClearViewBtn")?.addEventListener("click", () => {
    if ($("logs")) $("logs").textContent = "";
    showToast("视窗日志已清空");
  });
}

bindEvents();
switchView(activeView);

function startApp() {
  initSelectArrows();
  injectArrowSymbol();
  loadConfig()
    .then(refreshStatus)
    .catch((error) => {
      showToast(error.message);
    });
  setInterval(() => {
    refreshStatus().catch(() => {});
  }, 3000);
}

startApp();
