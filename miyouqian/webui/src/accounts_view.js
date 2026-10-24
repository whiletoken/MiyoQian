// ===========================================================================
// 多账号列表管理与云游戏凭据配置
// ===========================================================================

function renderAccounts() {
  const accounts = config.accounts || [];
  $("accounts").innerHTML = accounts.length
    ? accounts
        .map(
          (account, index) => `
        <div class="account-row" data-index="${index}" data-draft="${account._draft ? "1" : "0"}">
          <div class="account-main">
            <div class="account-title">
              <strong>
                <span class="status-dot ${account.stuid ? "ok" : ""}"></span>
                ${
                  editingAccountIndex === index
                    ? `<input class="inline-name-input" data-field="name" type="text" maxlength="10" placeholder="最多 10 字" value="${escapeAttr(account.name || "")}" />`
                    : `<span class="account-name-text">${escapeHtml(accountLabel(account))}</span><input data-field="name" type="hidden" value="${escapeAttr(account.name || "")}" />`
                }
              </strong>
              <small>${account.stuid ? `UID ${escapeHtml(account.stuid)}` : "未登录"}</small>
            </div>
            <div class="account-actions">
              ${
                editingAccountIndex === index
                  ? `
                    <button class="primary" type="button" data-save-account="${index}" title="保存账号名">
                      <svg><use href="#i-save"></use></svg>
                      <span>保存</span>
                    </button>
                    <button class="ghost icon-only" type="button" data-cancel-account="${index}" title="取消编辑">
                      <svg><use href="#i-x"></use></svg>
                    </button>
                  `
                  : `
                    <button class="ghost icon-only" type="button" data-edit-account="${index}" title="编辑账号名">
                      <svg><use href="#i-edit"></use></svg>
                    </button>
                  `
              }
              <button class="ghost" type="button" data-login="${index}" title="登录方式">
                <svg><use href="#i-phone"></use></svg>
                <span>${account.stuid ? "刷新" : "登录"}</span>
              </button>
              <button class="ghost icon-only ${hasAccountCloudToken(account) || expandedCloudAccounts.has(index) ? "is-active" : ""}" type="button" data-toggle-cloud="${index}" title="云游戏签到凭证">
                <svg><use href="#i-cloud"></use></svg>
              </button>
              <button class="ghost icon-only" type="button" data-remove="${index}" title="删除账号">
                <svg><use href="#i-trash"></use></svg>
              </button>
            </div>
          </div>
          <input data-field="stuid" type="hidden" value="${escapeAttr(account.stuid || "")}" />
          <input data-field="stoken" type="hidden" value="${escapeAttr(account.stoken || "")}" />
          <input data-field="mid" type="hidden" value="${escapeAttr(account.mid || "")}" />
          <textarea class="hidden-field" data-field="cookie">${escapeHtml(account.cookie || "")}</textarea>
          ${accountCloudGameFields(account, index)}
          <div class="account-login-slot" data-login-slot="${index}"></div>
        </div>
      `,
        )
        .join("")
    : `<div class="empty-state">
        <strong>暂无账号</strong>
        <span>添加账号后，可在账号卡片内登录。</span>
      </div>`;
  document.querySelectorAll("[data-login]").forEach((button) => {
    button.addEventListener("click", () => {
      showLoginMethods(Number(button.dataset.login)).catch((error) =>
        showToast(error.message),
      );
    });
  });
  document.querySelectorAll("[data-edit-account]").forEach((button) => {
    button.addEventListener("click", () => {
      collectConfig();
      editingAccountIndex = Number(button.dataset.editAccount);
      renderAccounts();
      const row = document.querySelector(
        `.account-row[data-index="${editingAccountIndex}"]`,
      );
      row?.querySelector('[data-field="name"]')?.focus();
    });
  });
  document.querySelectorAll("[data-toggle-cloud]").forEach((button) => {
    button.addEventListener("click", () => {
      collectConfig();
      const index = Number(button.dataset.toggleCloud);
      if (expandedCloudAccounts.has(index)) {
        expandedCloudAccounts.delete(index);
      } else {
        expandedCloudAccounts.add(index);
      }
      renderAccounts();
    });
  });
  document.querySelectorAll("[data-cancel-account]").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.cancelAccount);
      if (activeLoginIndex === index) {
        await api("/api/login/cancel", { method: "POST", body: "{}" }).catch(() => {});
        clearLoginCountdown();
        localLoginPanel = null;
        activeLoginIndex = null;
        renderLoginSlot({ running: false, status: "idle" });
      }
      if (config.accounts[index]?._draft) {
        config.accounts.splice(index, 1);
        editingAccountIndex = null;
        activeLoginIndex = null;
        clearLoginCountdown();
        localLoginPanel = null;
        expandedCloudAccounts = shiftExpandedCloudAccounts(index);
        renderAccounts();
        renderLoginSlot({ running: false, status: "idle" });
        return;
      }
      editingAccountIndex = null;
      await loadConfig();
    });
  });
  document.querySelectorAll("[data-save-account]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        editingAccountIndex = null;
        await saveConfig("账号已保存");
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.remove);
      if (activeLoginIndex === index) {
        await api("/api/login/cancel", { method: "POST", body: "{}" }).catch(() => {});
        clearLoginCountdown();
        localLoginPanel = null;
        activeLoginIndex = null;
        renderLoginSlot({ running: false, status: "idle" });
      }
      const [removed] = config.accounts.splice(index, 1);
      if (editingAccountIndex === index) editingAccountIndex = null;
      if (editingAccountIndex !== null && editingAccountIndex > index)
        editingAccountIndex -= 1;
      expandedCloudAccounts = shiftExpandedCloudAccounts(index);
      renderAccounts();
      if (!removed?._draft) {
        autoSaveConfig()
          .then(refreshShopPlans)
          .then(() => showToast("账号已删除"))
          .catch((error) => showToast(error.message));
      }
    });
  });
  updateTaskDependencyState();
}

function updateAccountCloudGameInputs() {
  document.querySelectorAll(".account-cloud").forEach((section) => {
    section.classList.remove("is-disabled");
  });
  document.querySelectorAll("[data-account-cloud-token]").forEach((input) => {
    const isStarrail = input.dataset.accountCloudToken === "starrail";
    input.disabled = isStarrail;
  });
}

function accountCloudGameFields(account, index) {
  const cloudGames = account.cloud_games || {};
  const tokens = cloudGames.tokens || {};
  if (!expandedCloudAccounts.has(index)) {
    return accountCloudGameHiddenFields(tokens);
  }
  const rows = cloudGameOptions
    .map(([key, label, disabled, reason]) => {
      const title = reason ? ` title="${escapeAttr(reason)}"` : "";
      const placeholder = disabled ? "不可配置" : "x-rpc-combo_token";
      return `
        <label class="cloud-token-row ${disabled ? "disabled" : ""}"${title}>
          <span>${label}</span>
          <input data-account-cloud-token="${key}" type="password" value="${escapeAttr(tokens[key] || "")}" placeholder="${placeholder}" autocomplete="off" data-autosave ${disabled ? "disabled" : ""} />
        </label>
      `;
    })
    .join("");
  return `
    <div class="account-cloud">
      <div class="account-subhead">
        <strong>云游戏签到</strong>
        <small>从云游戏网页请求头复制 X-Rpc-Combo_token</small>
      </div>
      <div class="cloud-token-list">${rows}</div>
    </div>
  `;
}

function accountCloudGameHiddenFields(tokens) {
  return `
    <input data-account-cloud-token="genshin" type="hidden" value="${escapeAttr(tokens.genshin || "")}" />
    <input data-account-cloud-token="zzz" type="hidden" value="${escapeAttr(tokens.zzz || "")}" />
  `;
}

function hasAccountCloudToken(account) {
  const tokens = account.cloud_games?.tokens || {};
  return Boolean(
    String(tokens.genshin || "").trim() || String(tokens.zzz || "").trim(),
  );
}

function shiftExpandedCloudAccounts(removedIndex) {
  const shifted = new Set();
  expandedCloudAccounts.forEach((index) => {
    if (index < removedIndex) shifted.add(index);
    if (index > removedIndex) shifted.add(index - 1);
  });
  return shifted;
}

function collectConfig() {
  config.schedule = {
    enable: $("scheduleEnable").checked,
    time: $("scheduleTime").value || "09:00",
    jitter_minutes: Number($("scheduleJitter").value || 0),
    run_on_start: $("runOnStart").checked,
  };
  config.features = {
    game_checkin: $("gameCheckin").checked,
    cloud_game_checkin: $("cloudGameCheckin").checked,
    bbs_tasks: $("bbsTasks").checked,
  };
  config.games = config.games || {};
  config.games.enabled = Array.from(
    document.querySelectorAll("[data-game]:checked"),
  ).map((input) => input.dataset.game);
  config.cloud_games = config.cloud_games || {};
  config.cloud_games.enabled = Array.from(
    document.querySelectorAll("[data-cloud-game]:checked"),
  ).map((input) => input.dataset.cloudGame);
  config.bbs = {
    ...(config.bbs || {}),
    checkin: $("bbsCheckin").checked,
    forums: Array.from(
      document.querySelectorAll("[data-bbs-forum]:checked"),
    ).map((input) => Number(input.dataset.bbsForum)),
    read: false,
    like: false,
    share: false,
  };
  config.captcha = {
    ...(config.captcha || {}),
    max_retries: Number($("captchaMaxRetries").value || 3),
  };
  config.captcha.channels = Array.from(
    document.querySelectorAll("[data-captcha-provider]"),
  )
    .map((row) => collectCaptchaChannel(row))
    .filter(Boolean);
  config.captcha.enable = config.captcha.channels.some(
    (channel) => channel.enable,
  );
  config.shop_exchange = collectShopExchange();
  const accountRows = document.querySelectorAll(".account-row");
  if (accountRows.length === 0 && Array.isArray(config.accounts) && config.accounts.length > 0) {
    // DOM 未渲染账号节点时保留内存中已有账号配置
    config.accounts = config.accounts;
  } else {
    config.accounts = Array.from(accountRows).map(
      (row) => {
        const index = Number(row.dataset.index ?? -1);
        const existingAccount = (config.accounts && index >= 0 && index < config.accounts.length)
          ? config.accounts[index]
          : {};
        const item = { ...existingAccount };
        row.querySelectorAll("[data-field]").forEach((field) => {
          item[field.dataset.field] = field.value.trim();
        });
        item.cloud_games = collectAccountCloudGames(row);
        item.name = (item.name || "").slice(0, 10);
        item._draft = row.dataset.draft === "1";
        return item;
      },
    );
  }
  return config;
}

function collectCaptchaChannel(row) {
  const toggle = row.querySelector("[data-captcha-toggle]");
  const provider = row.dataset.captchaProvider;
  const channel = emptyCaptchaChannel(provider);
  channel.enable = Boolean(toggle?.checked);
  row.querySelectorAll("[data-captcha-field]").forEach((field) => {
    if (field.dataset.captchaField === "timeout") {
      channel.timeout = Number(field.value || channel.timeout);
    } else {
      channel[field.dataset.captchaField] = field.value.trim();
    }
  });
  return channel;
}

function collectAccountCloudGames(row) {
  const tokens = {};
  row.querySelectorAll("[data-account-cloud-token]").forEach((field) => {
    tokens[field.dataset.accountCloudToken] = field.value.trim();
  });
  return {
    tokens: {
      genshin: tokens.genshin || "",
      zzz: tokens.zzz || "",
    },
  };
}

function addAccount() {
  collectConfig();
  config.accounts.push(emptyAccount(nextAccountName()));
  editingAccountIndex = config.accounts.length - 1;
  renderAccounts();
  const row = document.querySelector(
    `.account-row[data-index="${editingAccountIndex}"]`,
  );
  row?.querySelector('[data-field="name"]')?.focus();
}

function emptyAccount(name) {
  return {
    name,
    cookie: "",
    stuid: "",
    stoken: "",
    mid: "",
    cloud_games: emptyAccountCloudGames(),
    _draft: true,
  };
}

function emptyAccountCloudGames() {
  return { tokens: { genshin: "", zzz: "" } };
}

function nextAccountName() {
  const names = new Set(
    (config.accounts || []).map((account) => account.name).filter(Boolean),
  );
  for (let index = 1; index < 1000; index += 1) {
    const name = `账号${index}`;
    if (!names.has(name)) return name;
  }
  return "账号";
}

function stripClientAccount(account) {
  const { _draft, ...payload } = account || {};
  return payload;
}

function applyDraftLogin(login) {
  collectConfig();
  const index = login.account_index ?? activeLoginIndex;
  const account = config.accounts[index];
  const accountData = login.account_data || {};
  if (!account || !account._draft || !accountData.stuid) {
    return;
  }
  Object.assign(account, {
    cookie: accountData.cookie || "",
    stuid: accountData.stuid || "",
    stoken: accountData.stoken || "",
    mid: accountData.mid || "",
    _draft: true,
  });
  editingAccountIndex = index;
  renderAccounts();
  const row = document.querySelector(`.account-row[data-index="${index}"]`);
  row?.querySelector('[data-field="name"]')?.focus();
}

function accountLabel(account) {
  return account.name || account.stuid || "未命名账号";
}
