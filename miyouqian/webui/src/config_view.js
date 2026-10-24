// ===========================================================================
// 系统配置视图与打码渠道管理
// ===========================================================================

async function loadConfig() {
  config = await api("/api/config");
  config.accounts = (config.accounts || []).map((account) => ({
    ...account,
    _draft: false,
  }));
  renderConfig();
  loadAllPlanAddresses();
}

function renderConfig() {
  $("scheduleEnable").checked = Boolean(config.schedule?.enable ?? true);
  $("scheduleTime").value = config.schedule?.time || "09:00";
  $("scheduleJitter").value = config.schedule?.jitter_minutes ?? 45;
  $("runOnStart").checked = Boolean(config.schedule?.run_on_start ?? false);

  $("gameCheckin").checked = Boolean(config.features?.game_checkin ?? true);
  $("cloudGameCheckin").checked = Boolean(
    config.features?.cloud_game_checkin ?? false,
  );
  $("bbsTasks").checked = Boolean(config.features?.bbs_tasks ?? false);
  $("bbsCheckin").checked = Boolean(config.bbs?.checkin ?? true);
  $("bbsRead").checked = false;
  $("bbsLike").checked = false;
  $("bbsShare").checked = false;
  setBbsInteractionDisabled();

  $("captchaMaxRetries").value = config.captcha?.max_retries ?? 3;
  renderGames();
  renderCloudGames();
  renderBbsForums();
  renderCaptchaChannels();
  updateTaskDependencyState();
  renderAccounts();
  renderShopConfig();
}

function renderGames() {
  const enabled = new Set(config.games?.enabled || []);
  $("gameChips").innerHTML = gameOptions
    .map(
      ([key, label]) => `
        <label class="chip">
          <input type="checkbox" data-game="${key}" data-autosave ${enabled.has(key) ? "checked" : ""} />
          <span>${label}</span>
        </label>
      `,
    )
    .join("");
  updateTaskDependencyState();
}

function renderCloudGames() {
  const enabled = new Set(config.cloud_games?.enabled || []);
  $("cloudGameChips").innerHTML = cloudGameOptions
    .map(([key, label, disabled, reason]) => {
      const title = reason ? ` title="${escapeAttr(reason)}"` : "";
      return `
        <label class="chip ${disabled ? "disabled" : ""}"${title}>
          <input type="checkbox" data-cloud-game="${key}" data-autosave ${enabled.has(key) ? "checked" : ""} ${disabled ? 'data-cloud-game-disabled="1" disabled' : ""} />
          <span>${label}</span>
        </label>
      `;
    })
    .join("");
  updateTaskDependencyState();
}

function renderBbsForums() {
  const enabled = new Set(
    (config.bbs?.forums || defaultBbsForums).map((id) => String(id)),
  );
  $("bbsForumChips").innerHTML = bbsForumOptions
    .map(
      ([key, label]) => `
        <label class="chip">
          <input type="checkbox" data-bbs-forum="${key}" data-autosave ${enabled.has(key) ? "checked" : ""} />
          <span>${label}</span>
        </label>
      `,
    )
    .join("");
  updateTaskDependencyState();
}

function updateTaskDependencyState() {
  const gameEnabled = $("gameCheckin").checked;
  const cloudEnabled = $("cloudGameCheckin").checked;
  const bbsEnabled = $("bbsTasks").checked;
  setTaskGroupDisabled("gameTaskGroup", "[data-game]", !gameEnabled);
  setTaskGroupDisabled(
    "cloudGameTaskGroup",
    "[data-cloud-game]:not([data-cloud-game-disabled])",
    !cloudEnabled,
  );
  updateAccountCloudGameInputs();
  setTaskGroupDisabled(
    "bbsTaskGroup",
    "#bbsCheckin",
    !bbsEnabled,
  );
  const bbsCheckinEnabled = bbsEnabled && $("bbsCheckin").checked;
  $("bbsForumChips").classList.toggle("is-hidden", !bbsCheckinEnabled);
  setTaskGroupDisabled("bbsTaskGroup", "[data-bbs-forum]", !bbsCheckinEnabled);
  setBbsInteractionDisabled();
}

function setTaskGroupDisabled(groupId, selector, disabled) {
  const group = $(groupId);
  if (!group) return;
  group.classList.toggle("is-disabled", disabled);
  group.querySelectorAll(selector).forEach((input) => {
    input.disabled = disabled;
  });
}

function setBbsInteractionDisabled() {
  ["bbsRead", "bbsLike", "bbsShare"].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.checked = false;
    input.disabled = true;
    const row = input.closest(".check-row");
    if (row) {
      row.classList.add("disabled");
      row.title = bbsInteractionDisabledReason;
    }
  });
}

function renderCaptchaChannels() {
  const channels = config.captcha?.channels || [];
  const byProvider = new Map(
    channels.map((channel) => [channel.provider, channel]),
  );
  $("captchaChannels").innerHTML = captchaChannelOptions
    .map(([provider, label]) => {
      const channel = byProvider.get(provider);
      const enabled = Boolean(channel?.enable);
      const editing = editingCaptchaProviders.has(provider);
      const configured = hasCaptchaChannelConfig(channel);
      const showFields = enabled || editing;
      return `
        <div class="push-channel" data-captcha-provider="${provider}">
          <div class="push-channel-main">
            <label class="check-row push-channel-toggle">
              <input type="checkbox" data-captcha-toggle="${provider}" ${enabled ? "checked" : ""} />
              <span>${label}</span>
            </label>
            <div class="push-channel-actions">
              ${
                !showFields
                  ? `<button class="ghost icon-only" type="button" data-edit-captcha="${provider}" title="展开/编辑${label}配置">
                      <svg><use href="#i-edit"></use></svg>
                    </button>`
                  : ""
              }
              ${
                showFields
                  ? `<button class="primary" type="button" data-save-captcha="${provider}" title="保存${label}配置">
                      <svg><use href="#i-save"></use></svg>
                      <span>保存</span>
                    </button>`
                  : ""
              }
            </div>
          </div>
          ${showFields ? captchaChannelFields(provider, channel || emptyCaptchaChannel(provider)) : captchaChannelHiddenFields(channel)}
          ${provider === "custom" && enabled ? customCaptchaTips() : ""}
        </div>
      `;
    })
    .join("");
  bindCaptchaChannelEvents();
}

function bindCaptchaChannelEvents() {
  document.querySelectorAll("[data-captcha-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        // 同一时间只会使用一个打码渠道，选中当前渠道时取消其他渠道
        document.querySelectorAll("[data-captcha-toggle]").forEach((other) => {
          if (other !== input) other.checked = false;
        });
      }
      collectConfig();
      const provider = input.dataset.captchaToggle;
      const existingChannel = findCaptchaChannel(provider);
      if (input.checked) {
        upsertCaptchaChannel({
          ...emptyCaptchaChannel(provider),
          ...(existingChannel || {}),
          enable: true,
        });
        editingCaptchaProviders.add(provider);
        renderCaptchaChannels();
        autoSaveConfig()
          .then(() => showToast("验证码识别已启用"))
          .catch((error) => showToast(error.message));
        return;
      }
      upsertCaptchaChannel({
        ...emptyCaptchaChannel(provider),
        ...(existingChannel || {}),
        enable: false,
      });
      editingCaptchaProviders.delete(provider);
      renderCaptchaChannels();
      autoSaveConfig()
        .then(() => showToast("验证码识别已关闭"))
        .catch((error) => showToast(error.message));
    });
  });
  document.querySelectorAll("[data-edit-captcha]").forEach((button) => {
    button.addEventListener("click", () => {
      collectConfig();
      editingCaptchaProviders.add(button.dataset.editCaptcha);
      renderCaptchaChannels();
    });
  });
  document.querySelectorAll("[data-save-captcha]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        collectConfig();
        const provider = button.dataset.saveCaptcha;
        const channel = findCaptchaChannel(provider);
        if (!channel?.enable) {
          editingCaptchaProviders.delete(provider);
        }
        renderCaptchaChannels();
        await saveConfig("验证码识别配置已保存");
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  document.querySelectorAll("[data-captcha-doc-view]").forEach((button) => {
    button.addEventListener("click", () => {
      showCustomCaptchaDoc().catch((error) => showToast(error.message));
    });
  });
  document.querySelectorAll("[data-captcha-doc-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      copyCustomCaptchaDoc().catch((error) => showToast(error.message));
    });
  });
}

function customCaptchaTips() {
  return `
    <div class="captcha-tips">
      <span>自定义接口需遵循固定的请求与响应规范：GET 请求接口地址并附带 gt / challenge 参数，可选请求头 X-API-Key，统一 code / data 响应格式。</span>
      <div class="captcha-tips-actions">
        <button class="ghost" type="button" data-captcha-doc-view>查看规范</button>
        <button class="ghost" type="button" data-captcha-doc-copy>复制规范</button>
      </div>
    </div>
  `;
}

async function loadCustomCaptchaDoc() {
  if (customCaptchaDocText) return customCaptchaDocText;
  const response = await fetch(customCaptchaDocUrl, { cache: "no-cache" });
  if (!response.ok) throw new Error("规范文档加载失败");
  customCaptchaDocText = await response.text();
  return customCaptchaDocText;
}

async function copyCustomCaptchaDoc() {
  await copyText(await loadCustomCaptchaDoc());
  showToast("规范文档已复制");
}

async function showCustomCaptchaDoc() {
  const text = await loadCustomCaptchaDoc();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card captcha-doc-dialog" role="dialog" aria-modal="true" aria-labelledby="captchaDocTitle">
      <div class="modal-head">
        <div>
          <strong id="captchaDocTitle">自定义打码接口规范</strong>
          <p>对接的打码服务需按此规范提供请求与响应</p>
        </div>
        <button class="ghost icon-only" type="button" data-captcha-doc-close title="关闭">
          <svg><use href="#i-x"></use></svg>
        </button>
      </div>
      <pre class="captcha-doc-text"></pre>
      <div class="modal-actions">
        <button class="ghost" type="button" data-captcha-doc-dialog-copy>复制全文</button>
        <button class="primary" type="button" data-captcha-doc-close>关闭</button>
      </div>
    </div>
  `;
  overlay.querySelector(".captcha-doc-text").textContent = text;
  document.body.insertBefore(overlay, document.querySelector(".toast"));
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  };
  document.addEventListener("keydown", onKeydown);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay
    .querySelectorAll("[data-captcha-doc-close]")
    .forEach((button) => button.addEventListener("click", close));
  overlay
    .querySelector("[data-captcha-doc-dialog-copy]")
    .addEventListener("click", () => {
      copyCustomCaptchaDoc().catch((error) => showToast(error.message));
    });
}

function captchaChannelFields(provider, channel) {
  if (provider === "test_nine") {
    return `
      <div class="push-channel-fields form-grid compact">
        <label>
          <span>服务地址 (/pass_uni)</span>
          <input data-captcha-field="url" type="text" placeholder="http://127.0.0.1:9645/pass_uni (Docker内部填 http://test_nine:9645/pass_uni)" value="${escapeAttr(channel.url || "http://127.0.0.1:9645/pass_uni")}" autocomplete="off" />
        </label>
        <input data-captcha-field="timeout" type="hidden" value="${escapeAttr(channel.timeout || 30)}" />
      </div>
    `;
  }
  if (provider === "custom") {
    return `
      <div class="push-channel-fields form-grid compact">
        <label>
          <span>接口地址</span>
          <input data-captcha-field="url" type="text" placeholder="https://gt.example.com/nine" value="${escapeAttr(channel.url || "")}" autocomplete="off" />
        </label>
        <label>
          <span>API Key（选填）</span>
          <input data-captcha-field="api_key" type="password" value="${escapeAttr(channel.api_key || "")}" autocomplete="off" />
        </label>
        <input data-captcha-field="timeout" type="hidden" value="${escapeAttr(channel.timeout || 120)}" />
      </div>
    `;
  }
  if (provider !== "damagou") return "";
  return `
    <div class="push-channel-fields form-grid compact">
      <label>
        <span>UserKey</span>
        <input data-captcha-field="userkey" type="password" value="${escapeAttr(channel.userkey || "")}" autocomplete="off" />
      </label>
      <input data-captcha-field="type" type="hidden" value="${escapeAttr(channel.type || "")}" />
      <input data-captcha-field="timeout" type="hidden" value="${escapeAttr(channel.timeout || 60)}" />
    </div>
  `;
}

function captchaChannelHiddenFields(channel) {
  if (!channel) return "";
  return Object.entries(channel)
    .filter(([key]) => key !== "provider" && key !== "enable")
    .map(
      ([key, value]) =>
        `<input data-captcha-field="${key}" type="hidden" value="${escapeAttr(value ?? "")}" />`,
    )
    .join("");
}

function emptyCaptchaChannel(provider) {
  if (provider === "test_nine") {
    return {
      provider,
      enable: true,
      url: "http://127.0.0.1:9645/pass_uni",
      timeout: 30,
    };
  }
  if (provider === "custom") {
    return {
      provider,
      enable: true,
      url: "",
      api_key: "",
      timeout: 120,
    };
  }
  return {
    provider,
    enable: true,
    userkey: "",
    type: "",
    timeout: 60,
  };
}

function upsertCaptchaChannel(channel) {
  config.captcha = config.captcha || {};
  config.captcha.channels = config.captcha.channels || [];
  const index = config.captcha.channels.findIndex(
    (item) => item.provider === channel.provider,
  );
  if (index === -1) {
    config.captcha.channels.push(channel);
  } else {
    config.captcha.channels[index] = {
      ...config.captcha.channels[index],
      ...channel,
    };
  }
}

function findCaptchaChannel(provider) {
  return (
    (config.captcha?.channels || []).find(
      (item) => item.provider === provider,
    ) || null
  );
}

function hasCaptchaChannelConfig(channel) {
  if (!channel) return false;
  if (channel.provider === "test_nine") {
    return Boolean(String(channel.url || "").trim());
  }
  if (channel.provider === "custom") {
    return Boolean(String(channel.url || "").trim());
  }
  return Boolean(String(channel.userkey || "").trim());
}

function serverConfig({ includeDrafts = true } = {}) {
  collectConfig();
  const payload = JSON.parse(JSON.stringify(config));
  payload.accounts = (payload.accounts || [])
    .filter((account) => includeDrafts || !account._draft)
    .map(({ _draft, ...account }) => account);

  return payload;
}

function validateUniqueAccountUids(accounts) {
  const seen = new Map();
  accounts.forEach((account, index) => {
    const uid = String(account.stuid || "").trim();
    if (!uid) return;
    if (seen.has(uid)) {
      throw new Error(`UID ${uid} 已存在，不能重复添加同一账号`);
    }
    seen.set(uid, index);
  });
}

async function saveConfig(message = "配置已保存") {
  const payload = serverConfig({ includeDrafts: true });
  validateUniqueAccountUids(payload.accounts || []);
  isSavingConfig = true;
  try {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast(message);
    await loadConfig();
  } finally {
    isSavingConfig = false;
  }
}

async function autoSaveConfig() {
  const payload = serverConfig({ includeDrafts: false });
  validateUniqueAccountUids(payload.accounts || []);
  isSavingConfig = true;
  try {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } finally {
    isSavingConfig = false;
  }
}

function scheduleAutoSave() {
  if (!config || isSavingConfig) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveConfig()
      .then(() => showToast("配置已更新"))
      .catch((error) => showToast(error.message));
  }, 450);
}
