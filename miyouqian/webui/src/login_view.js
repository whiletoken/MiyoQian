// ===========================================================================
// 扫码与短信验证码登录流程管理 (含极验安全验证)
// ===========================================================================

function renderLoginSlot(login, options = {}) {
  const hasServerPanel = Boolean(login.running || login.qr || login.status === "error");
  if (!hasServerPanel && localLoginPanel && !options.forceLocal) {
    const existingSlot = document.querySelector(
      `[data-login-slot="${localLoginPanel.account_index}"]`,
    );
    if (existingSlot?.dataset.localLoginPanel === "1") {
      return;
    }
  }
  document.querySelectorAll("[data-login-slot]").forEach((slot) => {
    slot.innerHTML = "";
    slot.classList.remove("active");
    delete slot.dataset.localLoginPanel;
    delete slot.dataset.localLoginMode;
  });
  if (!hasServerPanel && localLoginPanel) {
    const slot = document.querySelector(
      `[data-login-slot="${localLoginPanel.account_index}"]`,
    );
    if (slot) renderLocalLoginPanel(slot, localLoginPanel);
    return;
  }
  if (!hasServerPanel) {
    return;
  }
  const index = login.account_index ?? activeLoginIndex ?? -1;
  const slot = document.querySelector(`[data-login-slot="${index}"]`);
  if (!slot) return;

  // 当登录失败且不在运行状态时，5秒后自动折叠
  if (login.status === "error" && !login.running) {
    if (loginErrorCollapseTimer) clearTimeout(loginErrorCollapseTimer);
    loginErrorCollapseTimer = setTimeout(() => {
      activeLoginIndex = null;
      renderLoginSlot({ running: false, status: "idle" });
      loginErrorCollapseTimer = null;
    }, 5000);
  } else if (loginErrorCollapseTimer) {
    clearTimeout(loginErrorCollapseTimer);
    loginErrorCollapseTimer = null;
  }

  slot.classList.add("active");
  if (login.qr) {
    slot.innerHTML = `
      <div class="inline-login">
        <button type="button" class="qr-refresh-btn" title="点击刷新二维码">
          <img src="${login.qr}" alt="米游社扫码登录二维码" />
          <span class="qr-refresh-hint">点击刷新</span>
        </button>
        <p>${escapeHtml(login.message || "等待扫码确认")}</p>
      </div>
    `;
    slot.querySelector(".qr-refresh-btn")?.addEventListener("click", refreshLoginQr);
  } else {
    slot.innerHTML = `
      <div class="inline-login pending">
        <div class="qr-loading"></div>
        <p>${escapeHtml(login.message || loginStatusText(login.status || "starting"))}</p>
      </div>
    `;
  }
}

function renderLocalLoginPanel(slot, panel) {
  slot.classList.add("active");
  slot.dataset.localLoginPanel = "1";
  slot.dataset.localLoginMode = panel.mode || "";
  if (panel.mode === "methods") {
    slot.innerHTML = `
      <div class="inline-login login-method-panel">
        <div class="login-method-actions">
          <button class="ghost" type="button" data-login-method-captcha>
            <svg><use href="#i-phone"></use></svg>
            <span>验证码登录</span>
          </button>
          <button class="ghost" type="button" data-login-method-scan>
            <svg><use href="#i-qr"></use></svg>
            <span>扫码登录</span>
          </button>
          <button class="ghost" type="button" data-login-panel-close>取消</button>
        </div>
      </div>
    `;
    slot
      .querySelector("[data-login-method-captcha]")
      ?.addEventListener("click", () => showCaptchaLogin(panel.account_index));
    slot
      .querySelector("[data-login-method-scan]")
      ?.addEventListener("click", () =>
        confirmScanLogin(panel.account_index).catch((error) =>
          showToast(error.message),
        ),
      );
    slot
      .querySelector("[data-login-panel-close]")
      ?.addEventListener("click", resetLoginPanel);
    return;
  }

  const busy = Boolean(panel.sending || panel.verifying);
  const countdown = Number(panel.countdown || 0);
  const canVerify = Boolean(panel.action_type && !busy);
  const sendDisabled = busy || countdown > 0;
  const message = panel.message
    ? `<p class="login-panel-message ${panel.error ? "error" : ""}" data-login-panel-message>${escapeHtml(panel.message)}</p>`
    : "";
  slot.innerHTML = `
    <div class="inline-login captcha-login-panel">
      <div class="captcha-login-fields">
        <input data-login-phone="${panel.account_index}" type="tel" inputmode="numeric" placeholder="手机号" value="${escapeAttr(panel.phone || "")}" autocomplete="tel" ${busy || panel.action_type ? "disabled" : ""} />
        <div class="captcha-code-row">
          <input data-login-captcha="${panel.account_index}" type="text" inputmode="numeric" placeholder="验证码" value="${escapeAttr(panel.captcha || "")}" autocomplete="one-time-code" ${panel.action_type && !busy ? "" : "disabled"} />
          <button class="ghost" type="button" data-login-send-captcha="${panel.account_index}" ${sendDisabled ? "disabled" : ""}>
            <svg><use href="#i-phone"></use></svg>
            <span>${loginSendButtonText(panel)}</span>
          </button>
        </div>
      </div>
      <div class="captcha-login-actions">
        <button class="primary" type="button" data-login-submit-captcha="${panel.account_index}" ${canVerify ? "" : "disabled"}>
          <svg><use href="#i-save"></use></svg>
          <span>${panel.verifying ? "登录中" : "登录"}</span>
        </button>
        <button class="ghost" type="button" data-login-panel-close ${busy ? "disabled" : ""}>取消</button>
      </div>
      ${message}
    </div>
  `;
  slot
    .querySelector("[data-login-phone]")
    ?.addEventListener("input", (event) => {
      if (!localLoginPanel) return;
      localLoginPanel.phone = event.target.value;
      if (localLoginPanel.action_type) {
        localLoginPanel.action_type = "";
        localLoginPanel.message = "";
      }
    });
  slot
    .querySelector("[data-login-captcha]")
    ?.addEventListener("input", (event) => {
      if (localLoginPanel) localLoginPanel.captcha = event.target.value;
    });
  slot
    .querySelector("[data-login-captcha]")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitCaptchaLogin(panel.account_index).catch((error) =>
          showToast(error.message),
        );
      }
    });
  slot
    .querySelector("[data-login-send-captcha]")
    ?.addEventListener("click", () =>
      sendCaptchaLogin(panel.account_index).catch((error) =>
        showToast(error.message),
      ),
    );
  slot
    .querySelector("[data-login-submit-captcha]")
    ?.addEventListener("click", () =>
      submitCaptchaLogin(panel.account_index).catch((error) =>
        showToast(error.message),
      ),
    );
  slot
    .querySelector("[data-login-panel-close]")
    ?.addEventListener("click", resetLoginPanel);
}

async function showLoginMethods(accountIndex) {
  collectConfig();
  const account = config.accounts[accountIndex];
  if (!account) {
    throw new Error("请先添加账号");
  }
  clearLoginCountdown();
  lastLoginStatus = "";
  activeLoginIndex = accountIndex;
  localLoginPanel = { account_index: accountIndex, mode: "methods" };
  renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
}

function showCaptchaLogin(accountIndex) {
  clearLoginCountdown();
  localLoginPanel = {
    account_index: accountIndex,
    mode: "captcha",
    phone: "",
    captcha: "",
    action_type: "",
    countdown: 0,
    message: "",
    error: false,
  };
  activeLoginIndex = accountIndex;
  renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
  document.querySelector(`[data-login-phone="${accountIndex}"]`)?.focus();
}

function resetLoginPanel() {
  clearLoginCountdown();
  localLoginPanel = null;
  activeLoginIndex = null;
  renderLoginSlot({ running: false, status: "idle" });
}

function loginSendButtonText(panel) {
  const countdown = Number(panel.countdown || 0);
  if (panel.sending) return "发送中";
  if (countdown > 0) return `${countdown}s`;
  return panel.action_type ? "重发" : "发送验证码";
}

function parseLoginCountdown(value) {
  const seconds = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function clearLoginCountdown() {
  if (loginCountdownTimer) {
    clearInterval(loginCountdownTimer);
    loginCountdownTimer = null;
  }
}

function startLoginCountdown(accountIndex, seconds) {
  clearLoginCountdown();
  const panel = localLoginPanel;
  if (!panel || panel.account_index !== accountIndex) return;
  panel.countdown = Math.max(Number(seconds || 0), 0);
  updateLoginCountdownView(panel);
  if (panel.countdown <= 0) return;
  loginCountdownTimer = setInterval(() => {
    const activePanel = localLoginPanel;
    if (!activePanel || activePanel.account_index !== accountIndex) {
      clearLoginCountdown();
      return;
    }
    activePanel.countdown = Math.max(Number(activePanel.countdown || 0) - 1, 0);
    if (activePanel.countdown <= 0) {
      activePanel.message = "验证码已发送，可重新发送";
      updateLoginCountdownView(activePanel);
      clearLoginCountdown();
      return;
    }
    updateLoginCountdownView(activePanel);
  }, 1000);
}

function updateLoginCountdownView(panel) {
  const button = document.querySelector(
    `[data-login-send-captcha="${panel.account_index}"]`,
  );
  if (button) {
    button.disabled =
      Boolean(panel.sending || panel.verifying) || Number(panel.countdown || 0) > 0;
    const label = button.querySelector("span");
    if (label) label.textContent = loginSendButtonText(panel);
  }
  const message = document.querySelector("[data-login-panel-message]");
  if (message && !panel.error) {
    message.textContent =
      Number(panel.countdown || 0) > 0
        ? `验证码已发送，${panel.countdown}s 后可重发`
        : panel.message || "";
  }
}

async function confirmScanLogin(accountIndex) {
  clearLoginCountdown();
  localLoginPanel = null;
  await startLogin(accountIndex);
}

function isAigisRequired(error) {
  return error?.code === "aigis_required" && error.aigis;
}

const loadedScripts = new Map();

function loadScriptOnce(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("安全验证脚本加载失败"));
    document.head.appendChild(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

async function completeAigisChallenge(rawAigis) {
  const aigis =
    typeof rawAigis === "string" ? JSON.parse(rawAigis) : rawAigis || {};
  const data =
    typeof aigis.data === "string" ? JSON.parse(aigis.data) : aigis.data || {};
  await loadScriptOnce("https://static.geetest.com/static/js/gt.0.4.9.js");
  await loadScriptOnce("https://static.geetest.com/v4/gt4.js");
  const validate = await showGeetestDialog(data, aigis);
  return `${aigis.session_id};${base64Json(validate)}`;
}

function base64Json(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function showGeetestDialog(data, aigis) {
  return new Promise((resolve, reject) => {
    const boxId = `geetestBox${Date.now()}`;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card geetest-dialog" role="dialog" aria-modal="true" aria-labelledby="geetestDialogTitle">
        <div class="modal-head">
          <div>
            <strong id="geetestDialogTitle">安全验证</strong>
            <p>请完成验证后继续登录</p>
          </div>
          <button class="ghost icon-only" type="button" data-geetest-cancel title="关闭">
            <svg><use href="#i-x"></use></svg>
          </button>
        </div>
        <div class="geetest-box" id="${boxId}"></div>
      </div>
    `;
    document.body.insertBefore(overlay, document.querySelector(".toast"));
    const cleanup = () => overlay.remove();
    const cancel = () => {
      cleanup();
      reject(new Error("安全验证已取消"));
    };
    overlay
      .querySelector("[data-geetest-cancel]")
      ?.addEventListener("click", cancel);

    if ("challenge" in data) {
      if (typeof window.initGeetest !== "function") {
        cancel();
        return;
      }
      window.initGeetest(
        {
          gt: data.gt,
          challenge: data.challenge,
          offline: false,
          new_captcha: true,
          product: "custom",
          area: `#${boxId}`,
          width: "250px",
          https: true,
        },
        (captchaObj) => {
          captchaObj.appendTo(`#${boxId}`);
          captchaObj.onClose(() => {
            const validate = captchaObj.getValidate();
            cleanup();
            if (!validate) {
              reject(new Error("安全验证已取消"));
              return;
            }
            resolve(validate);
          });
        },
      );
      return;
    }

    if (typeof window.initGeetest4 !== "function") {
      cancel();
      return;
    }
    window.initGeetest4(
      {
        captchaId: data.gt,
        riskType: data.risk_type,
        product: "popup",
        nextWidth: "250px",
        lang: "zho",
        userInfo: JSON.stringify({ session_id: aigis.session_id }),
        https: true,
        protocol: "https",
      },
      (captchaObj) => {
        captchaObj.appendTo(`#${boxId}`);
        captchaObj.onClose(cancel);
        captchaObj.onSuccess(() => {
          const validate = captchaObj.getValidate();
          cleanup();
          if (!validate) {
            reject(new Error("安全验证失败"));
            return;
          }
          resolve(validate);
        });
      },
    );
  });
}

async function sendCaptchaLogin(accountIndex) {
  collectConfig();
  const account = config.accounts[accountIndex];
  const panel = localLoginPanel;
  if (!account || !panel || panel.account_index !== accountIndex) {
    throw new Error("请先选择验证码登录");
  }
  panel.phone = String(
    document.querySelector(`[data-login-phone="${accountIndex}"]`)?.value ||
      panel.phone ||
      "",
  ).trim();
  panel.sending = true;
  panel.error = false;
  panel.message = "正在发送验证码";
  renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
  try {
    const response = await api("/api/login/captcha/send", {
      method: "POST",
      body: JSON.stringify({
        account_index: accountIndex,
        phone: panel.phone,
        draft: Boolean(account._draft),
        account: stripClientAccount(account),
        aigis: panel.aigis || "",
      }),
    });
    panel.sending = false;
    panel.action_type = response.action_type || "";
    panel.captcha = "";
    panel.aigis = "";
    const countdown = parseLoginCountdown(response.countdown) || 60;
    panel.countdown = countdown;
    panel.message = `验证码已发送，${countdown}s 后可重发`;
    panel.error = false;
    renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
    startLoginCountdown(accountIndex, countdown);
    document.querySelector(`[data-login-captcha="${accountIndex}"]`)?.focus();
    showToast("验证码已发送");
  } catch (error) {
    if (isAigisRequired(error)) {
      panel.sending = false;
      panel.error = false;
      panel.message = "请完成安全验证";
      renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
      panel.aigis = await completeAigisChallenge(error.aigis);
      return sendCaptchaLogin(accountIndex);
    }
    panel.sending = false;
    panel.countdown = 0;
    panel.error = true;
    panel.message = error.message || "发送验证码失败";
    renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
    throw error;
  }
}

async function submitCaptchaLogin(accountIndex) {
  collectConfig();
  const account = config.accounts[accountIndex];
  const panel = localLoginPanel;
  if (!account || !panel || panel.account_index !== accountIndex) {
    throw new Error("请先选择验证码登录");
  }
  panel.phone = String(
    document.querySelector(`[data-login-phone="${accountIndex}"]`)?.value ||
      panel.phone ||
      "",
  ).trim();
  panel.captcha = String(
    document.querySelector(`[data-login-captcha="${accountIndex}"]`)?.value ||
      panel.captcha ||
      "",
  ).trim();
  if (!panel.action_type) {
    throw new Error("请先发送短信验证码");
  }
  if (!panel.captcha) {
    throw new Error("请输入短信验证码");
  }
  panel.verifying = true;
  panel.error = false;
  panel.message = "正在登录";
  renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
  try {
    const response = await api("/api/login/captcha/verify", {
      method: "POST",
      body: JSON.stringify({
        account_index: accountIndex,
        phone: panel.phone,
        captcha: panel.captcha,
        action_type: panel.action_type,
        draft: Boolean(account._draft),
        account: stripClientAccount(account),
        aigis: panel.aigis || "",
      }),
    });
    panel.aigis = "";
    clearLoginCountdown();
    localLoginPanel = null;
    activeLoginIndex = null;
    showToast(response.message || "登录成功");
    if (response.draft) {
      applyDraftLogin(response);
    } else {
      await loadConfig();
    }
    renderLoginSlot({ running: false, status: "idle" });
  } catch (error) {
    if (isAigisRequired(error)) {
      panel.verifying = false;
      panel.error = false;
      panel.message = "请完成安全验证";
      renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
      panel.aigis = await completeAigisChallenge(error.aigis);
      return submitCaptchaLogin(accountIndex);
    }
    panel.verifying = false;
    panel.error = true;
    panel.message = error.message || "验证码登录失败";
    renderLoginSlot({ running: false, status: "idle" }, { forceLocal: true });
    throw error;
  }
}

async function startLogin(accountIndex) {
  collectConfig();
  const account = config.accounts[accountIndex];
  if (!account) {
    throw new Error("请先添加账号");
  }
  lastLoginStatus = "";
  activeLoginIndex = accountIndex;
  clearLoginCountdown();
  localLoginPanel = null;
  renderLoginSlot({
    running: true,
    account_index: accountIndex,
    status: "starting",
    message: "正在生成二维码",
  });
  try {
    await api("/api/login/start", {
      method: "POST",
      body: JSON.stringify({
        account_index: accountIndex,
        timeout: 180,
        draft: Boolean(account._draft),
        account: stripClientAccount(account),
      }),
    });
    showToast("登录流程已启动");
    await refreshStatus();
  } catch (error) {
    activeLoginIndex = null;
    renderLoginSlot({});
    throw error;
  }
}

async function refreshLoginQr() {
  const btn = document.querySelector(".qr-refresh-btn");
  if (!btn || btn.classList.contains("is-refreshing")) return;
  btn.classList.add("is-refreshing");
  btn.innerHTML = `<div class="qr-loading"></div><span class="qr-refresh-hint">刷新中…</span>`;
  btn.disabled = true;
  try {
    await api("/api/login/refresh", { method: "POST", body: "{}" });
  } catch (error) {
    showToast("刷新失败: " + error.message);
  }
}

function loginStatusText(status) {
  const labels = {
    starting: "生成二维码",
    waiting: "等待扫码",
    exchanging: "换取凭证",
    success: "登录成功",
    error: "登录失败",
  };
  return labels[status] || status;
}
