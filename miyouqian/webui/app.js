// ===========================================================================
// 米游签 Web 控制台前端脚本 (由 miyouqian/webui/src/ 自动构建)
// 模块源码位于 miyouqian/webui/src/，请勿在此单文件直接新增业务逻辑！
// ===========================================================================

// --- Module: constants.js ---
// ===========================================================================
// 常量与全局状态定义
// ===========================================================================

const gameOptions = [
  ["genshin", "原神"],
  ["starrail", "星穹铁道"],
  ["zzz", "绝区零"],
  ["honkai3rd", "崩坏3"],
  ["tears", "未定事件簿"],
  ["honkai2", "崩坏学园2"],
];

const cloudGameOptions = [
  ["genshin", "云原神", false, ""],
  ["zzz", "云绝区零", false, ""],
  [
    "starrail",
    "云星穹铁道",
    true,
    "云星穹铁道是版本更新赠送 600 分钟，不需要每日签到获取时长",
  ],
];

const captchaChannelOptions = [
  ["test_nine", "极验识别服务 (Docker / test_nine)"],
  ["damagou", "打码狗(成本≈0.01元/次)"],
  ["custom", "自定义接口"],
];
const customCaptchaDocUrl = "/custom-captcha-api.md";
let customCaptchaDocText = "";

const bbsForumOptions = [
  ["5", "大别野"],
  ["2", "原神"],
  ["6", "崩坏：星穹铁道"],
  ["8", "绝区零"],
  ["9", "崩坏：因缘精灵"],
  ["1", "崩坏3"],
  ["3", "崩坏学园2"],
  ["4", "未定事件簿"],
];
const defaultBbsForums = ["5", "2"];
const bbsInteractionDisabledReason =
  "米游社改版，社区互动已无法获取米游币，待新获取方式更新~";

let config = null;
let toastTimer = null;
let autoSaveTimer = null;
let isSavingConfig = false;
let lastLoginStatus = "";
let activeLoginIndex = null;
let localLoginPanel = null;
let loginCountdownTimer = null;
let loginErrorCollapseTimer = null;
let editingAccountIndex = null;
let expandedCloudAccounts = new Set();
let editingCaptchaProviders = new Set();
let logsPinnedToBottom = true;
let activeView = "dashboard";
let shopGoods = [];
let shopGames = [{ key: "", name: "全部分区" }];
let shopSelectedGame = "";
let shopOpenPlans = new Set();
let shopRunningProgress = {};
let shopRequestInFlight = false;
let shopGoodsLoading = false;
let shopGoodsLoadSeq = 0;
let shopExchangeNowGoodsId = "";
let shopPlanAddressCache = new Map();
let shopFilterStatus = "";        // 商品状态筛选："" 全部 / sold_out / available
let shopCurrentPage = 1;          // 当前页码，从1开始
const SHOP_PAGE_SIZE = 4;        // 每页显示商品数
let taskRecords = [];

const $ = (id) => document.getElementById(id);

// --- Module: utils.js ---
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
  const wasPinned = logsPinnedToBottom || isScrolledNearBottom(logBox);
  const nextText = logs.join("\n");
  if (logBox.textContent !== nextText) {
    logBox.textContent = nextText;
    if (wasPinned) {
      requestAnimationFrame(() => scrollLogsToBottom());
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

// --- Module: config_view.js ---
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

// --- Module: accounts_view.js ---
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

// --- Module: shop_view.js ---
// ===========================================================================
// 米游币商品商城与兑换计划管理
// ===========================================================================

function renderShopConfig() {
  const shop = config.shop_exchange || {};
  if ($("shopEnable")) {
    $("shopEnable").checked = Boolean(shop.enable);
  }
  if ($("shopRetrySeconds")) {
    $("shopRetrySeconds").value = shop.retry_seconds ?? 20;
  }
  if ($("shopRetryInterval")) {
    $("shopRetryInterval").value = shop.retry_interval ?? 0.4;
  }
  renderShopGameFilter();
  if (shopGoodsLoading) {
    renderShopGoodsLoadingState();
  } else {
    renderShopGoods();
  }
  renderShopPlans();
}

function renderShopGameFilter() {
  const select = $("shopGameFilter");
  if (!select) return;
  const current = shopSelectedGame;
  select.innerHTML = shopGames
    .map(
      (item) =>
        `<option value="${escapeAttr(item.key)}" ${item.key === current ? "selected" : ""}>${escapeHtml(item.name)}</option>`,
    )
    .join("");
}

function getFilteredGoods() {
  if (!shopFilterStatus) return shopGoods;
  if (shopFilterStatus === "sold_out") {
    return shopGoods.filter((item) => isShopGoodSoldOut(item));
  }
  if (shopFilterStatus === "available") {
    return shopGoods.filter((item) => canShopGoodExchangeNow(item));
  }
  return shopGoods;
}

function renderShopGoodsLoadingState() {
  const grid = $("shopGoods");
  if (!grid) return;
  grid.innerHTML = `
    <div class="shop-empty-goods is-loading">
      <div class="qr-loading"></div>
      <p>正在获取商品列表…</p>
    </div>
  `;
}

function renderShopGoods() {
  const grid = $("shopGoods");
  if (!grid) return;
  const filtered = getFilteredGoods();
  if (!filtered.length) {
    const emptyHint = shopGoods.length
      ? "当前筛选条件下没有商品"
      : "暂无商品数据，可点击右上角刷新获取。";
    grid.innerHTML = `<div class="empty-state">${emptyHint}</div>`;
    renderShopPagination();
    return;
  }
  const totalPages = Math.ceil(filtered.length / SHOP_PAGE_SIZE);
  if (shopCurrentPage > totalPages) {
    shopCurrentPage = totalPages;
  }
  if (shopCurrentPage < 1) {
    shopCurrentPage = 1;
  }
  const start = (shopCurrentPage - 1) * SHOP_PAGE_SIZE;
  const pagedGoods = filtered.slice(start, start + SHOP_PAGE_SIZE);
  grid.innerHTML = pagedGoods
    .map((item) => shopGoodCard(item, shopGoods.indexOf(item)))
    .join("");
  bindShopGoodsEvents();
  renderShopPagination();
}

function renderShopPagination() {
  const container = $("shopPagination");
  if (!container) return;
  const filtered = getFilteredGoods();
  const totalPages = Math.ceil(filtered.length / SHOP_PAGE_SIZE);
  if (totalPages <= 1) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  container.style.display = "";
  const pages = getVisiblePages(shopCurrentPage, totalPages);
  let html = `<div class="shop-pagination-wrap">`;
  html += `
    <button class="ghost shop-page-btn" ${shopCurrentPage <= 1 ? "disabled" : ""} data-shop-page="${shopCurrentPage - 1}">
      上一页
    </button>
  `;
  for (const p of pages) {
    if (p === "...") {
      html += `<span class="shop-page-ellipsis">…</span>`;
    } else {
      const activeClass = p === shopCurrentPage ? "is-active" : "";
      html += `
        <button class="ghost shop-page-btn ${activeClass}" data-shop-page="${p}">
          ${p}
        </button>
      `;
    }
  }
  html += `
    <button class="ghost shop-page-btn" ${shopCurrentPage >= totalPages ? "disabled" : ""} data-shop-page="${shopCurrentPage + 1}">
      下一页
    </button>
  `;
  html += `</div>`;
  container.innerHTML = html;
  container.querySelectorAll("[data-shop-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetPage = Number(btn.dataset.shopPage);
      if (targetPage >= 1 && targetPage <= totalPages && targetPage !== shopCurrentPage) {
        shopCurrentPage = targetPage;
        renderShopGoods();
        const topEl = $("shopGameFilter") || $("shopGoods");
        topEl?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
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

function shopGoodCard(good, index) {
  const isSoldOut = isShopGoodSoldOut(good);
  const canPlan = canShopGoodAddPlan(good);
  const canExchange = canShopGoodExchangeNow(good);
  const isExchanging =
    shopRequestInFlight && shopExchangeNowGoodsId === String(good.goods_id || "");
  const statusBadge = isSoldOut
    ? '<span class="shop-tag sold-out">已售罄</span>'
    : '<span class="shop-tag ok">可兑换</span>';
  return `
    <article class="shop-good-card ${isSoldOut ? "is-sold-out" : ""}" data-shop-good="${index}">
      <div class="shop-good-cover-wrap">
        <img class="shop-good-cover" src="${escapeAttr(good.icon || "")}" alt="${escapeAttr(good.goods_name || "商品")}" loading="lazy" />
        <div class="shop-good-tags">
          ${statusBadge}
          ${good.game_name ? `<span class="shop-tag">${escapeHtml(good.game_name)}</span>` : ""}
        </div>
      </div>
      <div class="shop-good-body">
        <h3 class="shop-good-title" title="${escapeAttr(good.goods_name || "")}">${escapeHtml(good.goods_name || "未命名商品")}</h3>
        <div class="shop-good-meta">
          <strong>${escapeHtml(String(good.price ?? "-"))} <small>米游币</small></strong>
          <span>库存 ${escapeHtml(String(good.stock ?? "-"))}</span>
        </div>
        <p class="shop-good-time">${escapeHtml(good.next_time_display || good.time_display || "")}</p>
        <div class="shop-good-actions">
          <button class="ghost icon-only" type="button" data-shop-plan-add="${index}" ${canPlan ? "" : "disabled"} title="${canPlan ? "加入兑换计划" : "商品已售罄"}">
            <svg><use href="#i-plus"></use></svg>
          </button>
          <button class="primary" type="button" data-shop-exchange-now="${index}" ${canExchange && !isExchanging ? "" : "disabled"}>
            <svg><use href="#i-play"></use></svg>
            <span>${isExchanging ? "兑换中…" : "立即兑换"}</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderShopPlans() {
  const container = $("shopPlans");
  if (!container) return;
  const plans = config.shop_exchange?.plans || [];
  if (!plans.length) {
    container.innerHTML = `<div class="empty-state">暂无兑换计划，可从左侧商品卡片点击加号添加。</div>`;
    return;
  }
  container.innerHTML = plans
    .map((plan, index) => shopPlanRow(plan, index))
    .join("");
  bindShopPlanEvents();
}

function shopPlanAccountIndex(plan, accounts) {
  const stuid = String(plan.account_stuid || "").trim();
  if (!stuid) return Number(plan.account_index ?? -1);
  return (accounts || []).findIndex(
    (account) => String(account.stuid || "").trim() === stuid,
  );
}

function shopPlanRow(plan, index) {
  const isOpen = shopOpenPlans.has(index);
  const accounts = config.accounts || [];
  const resolvedAccountIndex = shopPlanAccountIndex(plan, accounts);
  const accountOptions = accounts.length
    ? accounts
        .map((account, accIndex) => {
          const selected = accIndex === resolvedAccountIndex ? "selected" : "";
          const stuid = String(account.stuid || "").trim();
          return `<option value="${accIndex}" data-stuid="${escapeAttr(stuid)}" ${selected}>${escapeHtml(accountLabel(account))}</option>`;
        })
        .join("")
    : `<option value="">暂无可用账号</option>`;
  const accountSelectOptions =
    resolvedAccountIndex < 0 && plan.account_stuid
      ? `<option value="" data-stuid="${escapeAttr(plan.account_stuid)}" selected>账号已删除（UID ${escapeHtml(plan.account_stuid)}）</option>${accountOptions}`
      : accountOptions;
  const isVirtual = Number(plan.type || 0) === 2;
  return `
    <article class="shop-plan-card" data-shop-plan="${index}">
      <div class="shop-plan-head">
        <div class="shop-plan-main">
          <label class="check-row compact">
            <input data-shop-plan-field="enable" type="checkbox" ${plan.enable !== false ? "checked" : ""} data-autosave />
            <strong>${escapeHtml(plan.goods_name || plan.goods_id || `计划 ${index + 1}`)}</strong>
          </label>
          <p class="shop-plan-subtitle">${shopPlanStatus(plan, index)}</p>
        </div>
        <div class="shop-plan-actions">
          <button class="ghost icon-only" type="button" data-shop-plan-run="${index}" title="立即执行一次兑换">
            <svg><use href="#i-play"></use></svg>
          </button>
          <button class="ghost icon-only" type="button" data-shop-plan-toggle="${index}" title="${isOpen ? "收起设置" : "展开设置"}">
            <svg><use href="${isOpen ? "#i-x" : "#i-edit"}"></use></svg>
          </button>
          <button class="ghost icon-only" type="button" data-shop-plan-remove="${index}" title="删除计划">
            <svg><use href="#i-trash"></use></svg>
          </button>
        </div>
      </div>
      <div class="shop-plan-drawer ${isOpen ? "open" : ""}">
        <div class="form-grid two compact">
          <label>
            <span>执行账号</span>
            <div class="select-wrapper">
              <select data-shop-plan-field="account_index" data-autosave>
                ${accountSelectOptions}
              </select>
              <svg class="select-arrow" width="12" height="8" aria-hidden="true">
                <use href="#arrow-down"/>
              </svg>
            </div>
          </label>
          <label>
            <span>定时兑换时间</span>
            <input data-shop-plan-field="exchange_at" type="datetime-local" step="1" value="${escapeAttr(timestampToLocalInput(plan.exchange_at))}" data-autosave />
          </label>
        </div>
        <div class="form-grid two compact">
          <label class="check-row">
            <input data-shop-plan-field="auto" type="checkbox" ${plan.auto !== false ? "checked" : ""} data-autosave />
            <span>到点自动兑换</span>
          </label>
        </div>
        ${
          isVirtual
            ? `
              <div class="shop-plan-meta-box">
                <div class="shop-plan-meta-text">
                  <div><strong>游戏角色：</strong><span>${escapeHtml(shopRoleDisplay(plan))}</span></div>
                  <div><strong>区服信息：</strong><span>${escapeHtml(shopServerDisplay(plan))}</span></div>
                </div>
                <button class="ghost icon-only" type="button" data-shop-plan-refresh-role="${index}" title="刷新角色信息">
                  <svg><use href="#i-refresh"></use></svg>
                </button>
              </div>
            `
            : `
              <label class="compact">
                <span>收货地址</span>
                <div class="shop-plan-address-row">
                  <div class="select-wrapper" style="flex: 1;">
                    <select data-shop-plan-field="address_id" data-address-select data-autosave>
                      ${shopPlanAddressSelectHtml(plan)}
                    </select>
                    <svg class="select-arrow" width="12" height="8" aria-hidden="true">
                      <use href="#arrow-down"/>
                    </svg>
                  </div>
                  <button class="ghost icon-only" type="button" data-shop-plan-refresh-address="${index}" title="刷新收货地址">
                    <svg><use href="#i-refresh"></use></svg>
                  </button>
                </div>
              </label>
            `
        }
      </div>
      <input data-shop-plan-field="goods_id" type="hidden" value="${escapeAttr(plan.goods_id || "")}" />
      <input data-shop-plan-field="goods_name" type="hidden" value="${escapeAttr(plan.goods_name || "")}" />
      <input data-shop-plan-field="icon" type="hidden" value="${escapeAttr(plan.icon || "")}" />
      <input data-shop-plan-field="price" type="hidden" value="${escapeAttr(plan.price ?? "")}" />
      <input data-shop-plan-field="stock" type="hidden" value="${escapeAttr(plan.stock ?? "")}" />
      <input data-shop-plan-field="type" type="hidden" value="${escapeAttr(plan.type ?? "")}" />
      <input data-shop-plan-field="game" type="hidden" value="${escapeAttr(plan.game || "")}" />
      <input data-shop-plan-field="game_biz" type="hidden" value="${escapeAttr(plan.game_biz || "")}" />
      <input data-shop-plan-field="device_fp" type="hidden" value="${escapeAttr(plan.device_fp || "")}" />
      <input data-shop-plan-field="uid" type="hidden" value="${escapeAttr(plan.uid || "")}" />
      <input data-shop-plan-field="region" type="hidden" value="${escapeAttr(plan.region || "")}" />
      <input data-shop-plan-field="role_name" type="hidden" value="${escapeAttr(plan.role_name || "")}" />
      <input data-shop-plan-field="region_name" type="hidden" value="${escapeAttr(plan.region_name || "")}" />
      <input data-shop-plan-field="last_result" type="hidden" value="${escapeAttr(plan.last_result || "")}" />
      <input data-shop-plan-field="last_attempt_key" type="hidden" value="${escapeAttr(plan.last_attempt_key || "")}" />
      <input data-shop-plan-field="last_run" type="hidden" value="${escapeAttr(plan.last_run || "")}" />
    </article>
  `;
}

function bindShopGoodsEvents() {
  document.querySelectorAll("[data-shop-plan-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const good = getFilteredGoods()[Number(button.dataset.shopPlanAdd)];
      addShopPlan(good).catch((error) => showToast(error.message));
    });
  });
  document.querySelectorAll("[data-shop-exchange-now]").forEach((button) => {
    button.addEventListener("click", () => {
      const good = getFilteredGoods()[Number(button.dataset.shopExchangeNow)];
      exchangeGoodNow(good).catch((error) => showToast(error.message));
    });
  });
}

function bindShopPlanEvents() {
  document.querySelectorAll("[data-shop-plan-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.shopPlanToggle);
      if (shopOpenPlans.has(index)) {
        shopOpenPlans.delete(index);
      } else {
        shopOpenPlans.add(index);
      }
      renderShopPlans();
    });
  });
  document.querySelectorAll("[data-shop-plan-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      collectConfig();
      const index = Number(button.dataset.shopPlanRemove);
      config.shop_exchange.plans.splice(index, 1);
      shopOpenPlans.delete(index);
      renderShopPlans();
      saveConfig("兑换计划已删除").catch((error) => showToast(error.message));
    });
  });
  document.querySelectorAll("[data-shop-plan-run]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.shopPlanRun);
      executePlanOnce(index, button).catch((error) => showToast(error.message));
    });
  });
  document
    .querySelectorAll("[data-shop-plan-refresh-role]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.shopPlanRefreshRole);
        refreshShopPlanRole(index).catch((error) => showToast(error.message));
      });
    });
  document
    .querySelectorAll("[data-shop-plan-refresh-address]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.shopPlanRefreshAddress);
        refreshShopPlanAddresses(index, false).catch((error) =>
          showToast(error.message),
        );
      });
    });
}

function collectShopExchange() {
  const existing = config?.shop_exchange || {};
  const shop = {
    enable: $("shopEnable") ? $("shopEnable").checked : Boolean(existing.enable),
    retry_seconds: $("shopRetrySeconds")
      ? Number($("shopRetrySeconds").value || 20)
      : (existing.retry_seconds ?? 20),
    retry_interval: $("shopRetryInterval")
      ? Number($("shopRetryInterval").value || 0.4)
      : (existing.retry_interval ?? 0.4),
    plans: [],
  };
  const planRows = document.querySelectorAll("[data-shop-plan]");
  if (planRows.length === 0 && Array.isArray(existing.plans) && existing.plans.length > 0) {
    // 保护机制：DOM 未渲染兑换计划节点时，保留内存中现有的计划，防止计划被置空
    shop.plans = existing.plans.map(p => ({ ...p }));
    return shop;
  }
  planRows.forEach((row) => {
    const rowIndex = Number(row.dataset?.shopPlan ?? -1);
    const existingPlan = (Array.isArray(existing.plans) && rowIndex >= 0 && rowIndex < existing.plans.length)
      ? existing.plans[rowIndex]
      : {};
    const plan = { ...existingPlan };
    row.querySelectorAll("[data-shop-plan-field]").forEach((field) => {
      const key = field.dataset?.shopPlanField;
      if (!key) return;
      if (field.type === "checkbox") {
        plan[key] = field.checked;
      } else if (key === "account_index") {
        const selectedOption = field.selectedOptions?.[0];
        const selectedStuid = selectedOption?.dataset?.stuid;
        if (selectedStuid) {
          plan.account_stuid = selectedStuid;
        }
        if (field.value !== "" && field.value !== undefined) {
          plan.account_index = Number(field.value);
        }
      } else if (key === "exchange_at") {
        plan[key] = localInputToTimestamp(field.value);
      } else if (key === "type") {
        plan[key] = Number(field.value || 0);
      } else {
        plan[key] = String(field.value || "").trim();
      }
    });
    const accountIndex = shopPlanAccountIndex(plan, config?.accounts || []);
    if (accountIndex >= 0) plan.account_index = accountIndex;
    if (plan.goods_id) shop.plans.push(plan);
  });
  return shop;
}

async function addShopPlan(good) {
  if (!good) return;
  if (!canShopGoodAddPlan(good))
    throw new Error("商品已售罄，不能加入兑换计划");

  const accountIndex = await chooseShopPlanAccount(good);
  if (accountIndex === null) return;

  collectConfig();
  config.shop_exchange = config.shop_exchange || {
    enable: true,
    retry_seconds: 20,
    retry_interval: 0.4,
    plans: [],
  };

  if (!(config.accounts || [])[accountIndex]?.stuid) {
    throw new Error("请先添加并登录账号");
  }

  const existingIndex = config.shop_exchange.plans.findIndex(
    (p) => p.goods_id === good.goods_id && p.account_index === accountIndex,
  );

  if (existingIndex >= 0) {
    showToast("同账号已有相同计划");
    return;
  }

  const accountName = accountLabel(config.accounts[accountIndex]);
  const checkError = await checkShopAccountLogin(accountIndex);
  if (checkError) {
    showToast(`${accountName} 登录已过期，请重新登录`);
    return;
  }

  const plan = await buildShopPlan(good, accountIndex);
  config.shop_exchange.plans.push(plan);
  const planIndex = config.shop_exchange.plans.length - 1;
  renderShopPlans();
  await refreshShopPlanAddresses(planIndex, true);
  saveConfig("已加入兑换计划").catch((error) => showToast(error.message));
}

async function loadShopGoods() {
  const game = $("shopGameFilter")?.value ?? shopSelectedGame;
  const loadSeq = ++shopGoodsLoadSeq;
  shopSelectedGame = game;
  shopGoodsLoading = true;
  shopFilterStatus = "";
  if ($("shopStatusFilter")) $("shopStatusFilter").value = "";
  renderShopConfig();
  try {
    const data = await api(`/api/shop/goods?game=${encodeURIComponent(game)}`);
    if (loadSeq !== shopGoodsLoadSeq) return;
    shopGoods = data.goods || [];
    shopCurrentPage = 1;
    if (Array.isArray(data.games) && data.games.length) {
      shopGames = data.games;
    }
    showToast("商品列表已刷新");
  } finally {
    if (loadSeq === shopGoodsLoadSeq) {
      shopGoodsLoading = false;
      renderShopConfig();
    }
  }
}

async function exchangeGoodNow(good) {
  if (!good) return;
  if (isShopGoodSoldOut(good)) throw new Error("商品已售罄，不能兑换");
  if (!canShopGoodExchangeNow(good)) throw new Error("商品还未开启兑换");
  collectConfig();
  const accountIndex = await chooseShopExchangeAccount(good);
  if (accountIndex === null) return;
  if (!(config.accounts || [])[accountIndex]?.stuid) {
    throw new Error("请先添加并登录账号");
  }
  shopRequestInFlight = true;
  shopExchangeNowGoodsId = String(good.goods_id || "");
  renderShopGoods();
  try {
    const plan = await buildShopPlan(good, accountIndex);
    await exchangePlanNow(plan);
  } finally {
    shopExchangeNowGoodsId = "";
    shopRequestInFlight = false;
    renderShopGoods();
  }
}

async function exchangePlanNow(planOrIndex) {
  const body =
    typeof planOrIndex === "number"
      ? { plan_index: planOrIndex }
      : { plan: planOrIndex };
  if (body.plan === null || body.plan === undefined)
    throw new Error("兑换计划不存在");
  const response = await api("/api/shop/exchange", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const result = response.result || {};
  if (response.config) {
    config = response.config;
    config.accounts = (config.accounts || []).map((account) => ({
      ...account,
      _draft: false,
    }));
    renderConfig();
  }
  showToast(`兑换请求完成：${result.message || "未知结果"}`);
  await refreshStatus();
}

async function executePlanOnce(planIndex, button) {
  await withButtonLoading(button, "兑换中…", async () => {
    await exchangePlanNow(planIndex);
  });
}

async function buildShopPlan(good, accountIndex) {
  const fpData = await api("/api/shop/device-fp");
  const detail = await api(
    `/api/shop/good-detail?goods_id=${encodeURIComponent(good.goods_id)}`,
  );
  const base = { ...good, ...detail };
  const plan = {
    enable: true,
    auto: true,
    account_index: accountIndex,
    account_stuid: String((config.accounts || [])[accountIndex]?.stuid || ""),
    goods_id: base.goods_id,
    goods_name: base.goods_name,
    icon: base.icon,
    price: base.price,
    stock: base.stock,
    type: Number(base.type || 0),
    exchange_at: base.exchange_timestamp || Math.floor(Date.now() / 1000),
    game: base.game || "",
    game_biz: base.game_biz || "",
    device_fp: fpData.device_fp || "",
    uid: "",
    region: "",
    role_name: "",
    region_name: "",
    address_id: "",
    last_result: "",
    last_attempt_key: "",
    last_run: "",
  };
  if (Number(base.type || 0) === 2) {
    if (!plan.game_biz) {
      throw new Error("商品详情缺少 game_biz，无法自动匹配游戏角色");
    }
    const meta = await api(
      `/api/shop/account-meta?account_index=${accountIndex}&game_biz=${encodeURIComponent(plan.game_biz)}`,
    );
    const role = (meta.roles || [])[0];
    if (!role) {
      throw new Error("未找到该商品对应的绑定游戏角色");
    }
    plan.uid = role.uid || "";
    plan.region = role.region || "";
    plan.role_name = role.nickname || "";
    plan.region_name = role.region_name || "";
  }
  return plan;
}

async function refreshShopPlanRole(index) {
  collectConfig();
  const plan = config.shop_exchange?.plans?.[index];
  if (!plan || !plan.game_biz) return;
  const meta = await api(
    `/api/shop/account-meta?account_index=${plan.account_index}&game_biz=${encodeURIComponent(plan.game_biz)}`,
  );
  const role = (meta.roles || [])[0];
  if (!role) {
    plan.uid = "";
    plan.region = "";
    plan.role_name = "";
    plan.region_name = "";
    renderShopPlans();
    throw new Error("当前账号未找到对应游戏角色");
  }
  plan.uid = role.uid || "";
  plan.region = role.region || "";
  plan.role_name = role.nickname || "";
  plan.region_name = role.region_name || "";
  renderShopPlans();
  await autoSaveConfig();
  showToast("游戏角色已更新");
}

async function refreshShopPlanAddresses(index, autoFill = false) {
  const plan = config.shop_exchange?.plans?.[index];
  if (!plan || Number(plan.type || 0) === 2) return;
  const accountIndex = Number(plan.account_index || 0);
  const select = document.querySelector(
    `[data-shop-plan="${index}"] [data-address-select]`,
  );
  if (!select) return;
  const currentValue = plan.address_id || "";
  select.innerHTML = `<option value="">加载中...</option>`;
  select.disabled = true;
  try {
    const meta = await api(
      `/api/shop/account-meta?account_index=${accountIndex}`,
    );
    const addresses = meta.addresses || [];
    shopPlanAddressCache.set(accountIndex, addresses);
    select.innerHTML = buildAddressOptions(addresses, currentValue);
    if (autoFill && !currentValue && addresses.length) {
      const firstId = String(addresses[0].id || "");
      select.value = firstId;
      plan.address_id = firstId;
    } else if (!autoFill && !currentValue && addresses.length) {
      const firstId = String(addresses[0].id || "");
      select.value = firstId;
    } else if (currentValue && !addresses.some((a) => String(a.id) === currentValue)) {
      select.innerHTML =
        `<option value="${escapeAttr(currentValue)}">${escapeHtml(currentValue)}（已失效）</option>` +
        select.innerHTML;
      select.value = currentValue;
    }
  } catch {
    select.innerHTML = `<option value="${escapeAttr(currentValue)}">${currentValue ? escapeHtml(currentValue) : "获取地址失败"}</option>`;
  } finally {
    select.disabled = false;
  }
}

function shopPlanAddressSelectHtml(plan) {
  const accountIndex = Number(plan.account_index || 0);
  const cached = shopPlanAddressCache.get(accountIndex);
  if (!cached) return `<option value="">加载中...</option>`;
  return buildAddressOptions(cached, plan.address_id || "");
}

function buildAddressOptions(addresses, selectedId) {
  const options = [];
  for (const addr of addresses) {
    const id = String(addr.id || "");
    const label = [addr.name, addr.address].filter(Boolean).join(" - ");
    const sel = id === selectedId ? "selected" : "";
    options.push(
      `<option value="${escapeAttr(id)}" ${sel}>${escapeHtml(label || id)}</option>`,
    );
  }
  return options.join("");
}

async function loadAllPlanAddresses({ autoFill = false } = {}) {
  const plans = config.shop_exchange?.plans || [];
  const tasks = [];
  for (let i = 0; i < plans.length; i++) {
    tasks.push(refreshShopPlanAddresses(i, autoFill).catch(() => {}));
  }
  await Promise.all(tasks);
  if (autoFill) {
    autoSaveConfig().catch(() => {});
  }
}

function shopRoleDisplay(plan) {
  if (!plan.uid) return "不需要";
  return [plan.role_name, plan.uid].filter(Boolean).join(" / ") || plan.uid;
}

function shopServerDisplay(plan) {
  if (!plan.region && !plan.game_biz) return "不需要";
  const readable = plan.region_name
    ? `${plan.region_name}${plan.region ? ` (${plan.region})` : ""}`
    : plan.region;
  return [readable, plan.game_biz].filter(Boolean).join(" / ");
}

function isShopGoodSoldOut(good) {
  return Boolean(good?.sold_out);
}

function canShopGoodAddPlan(good) {
  if (!isShopGoodSoldOut(good)) return true;
  return good?.display_status === "sold_out_with_next";
}

function canShopGoodExchangeNow(good) {
  if (isShopGoodSoldOut(good)) return false;
  return good?.display_status === "online" || good?.display_status === "always";
}

function loggedInAccountChoices() {
  return (config.accounts || [])
    .map((account, index) => ({ account, index }))
    .filter(({ account }) => account?.stuid && account?.cookie);
}

function chooseShopExchangeAccount(good) {
  const choices = loggedInAccountChoices();
  if (!choices.length) {
    throw new Error("请先添加并登录账号");
  }
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card shop-account-dialog" role="dialog" aria-modal="true" aria-labelledby="shopAccountDialogTitle">
        <div class="modal-head">
          <div>
            <h2 id="shopAccountDialogTitle">选择兑换账号</h2>
            <p>${escapeHtml(good.goods_name || "商品兑换")}</p>
          </div>
          <button class="ghost icon-only" type="button" data-modal-cancel title="关闭">
            <svg><use href="#i-x"></use></svg>
          </button>
        </div>
        <label>
          <span>执行账号</span>
          <div class="select-wrapper">
              <select id="shopExchangeAccountSelect">
                    ${choices
              .map(
                  ({ account, index }) =>
                    `<option value="${index}">${escapeHtml(accountLabel(account))}</option>`,
              )
              .join("")}
              </select>
              <svg class="select-arrow" width="12" height="8" aria-hidden="true">
                <use href="#arrow-down"/>
              </svg>
          </div>
        </label>
        <div class="modal-actions">
          <button class="ghost" type="button" data-modal-cancel>取消</button>
          <button class="primary" type="button" data-modal-confirm>
            <svg><use href="#i-play"></use></svg>
            <span>确认兑换</span>
          </button>
        </div>
      </div>
    `;
    document.body.insertBefore(overlay, document.querySelector(".toast"));
    const select = overlay.querySelector("#shopExchangeAccountSelect");
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelectorAll("[data-modal-cancel]").forEach((control) => {
      control.addEventListener("click", () => finish(null));
    });
    overlay
      .querySelector("[data-modal-confirm]")
      ?.addEventListener("click", () => finish(Number(select.value)));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Enter") finish(Number(select.value));
    });
    select.focus();
  });
}

function chooseShopPlanAccount(good) {
  const choices = loggedInAccountChoices();
  if (!choices.length) {
    throw new Error("请先添加并登录账号");
  }
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card shop-account-dialog" role="dialog" aria-modal="true" aria-labelledby="shopPlanDialogTitle">
        <div class="modal-head">
          <div>
            <h2 id="shopPlanDialogTitle">选择计划账号</h2>
            <p>${escapeHtml(good.goods_name || "商品兑换计划")}</p>
          </div>
          <button class="ghost icon-only" type="button" data-modal-cancel title="关闭">
            <svg><use href="#i-x"></use></svg>
          </button>
        </div>
        <label>
          <span>执行账号</span>
          <div class="select-wrapper">
          <select id="shopPlanAccountSelect">
            ${choices
              .map(
                ({ account, index }) =>
                `<option value="${index}">${escapeHtml(accountLabel(account))}</option>`,
                )
              .join("")}
            </select>
            <svg class="select-arrow" width="12" height="8" aria-hidden="true">
                <use href="#arrow-down"/>
            </svg>
          </div>
        </label>
        <div class="modal-actions">
          <button class="ghost" type="button" data-modal-cancel>取消</button>
          <button class="primary" type="button" data-modal-confirm>
            <svg><use href="#i-plus"></use></svg>
            <span>添加计划</span>
          </button>
        </div>
      </div>
    `;
    document.body.insertBefore(overlay, document.querySelector(".toast"));
    const select = overlay.querySelector("#shopPlanAccountSelect");
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelectorAll("[data-modal-cancel]").forEach((control) => {
      control.addEventListener("click", () => finish(null));
    });
    overlay
      .querySelector("[data-modal-confirm]")
      ?.addEventListener("click", () => finish(Number(select.value)));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Enter") finish(Number(select.value));
    });
    select.focus();
  });
}

async function checkShopAccountLogin(accountIndex) {
  try {
    const meta = await api(
      `/api/shop/account-meta?account_index=${accountIndex}`,
    );
    const errors = [
      meta.points_error || "",
      meta.addresses_error || "",
    ];
    for (const err of errors) {
      if (/未登录|登录失效|cookie.*过期|expired/i.test(err)) {
        return err;
      }
    }
    return null;
  } catch (error) {
    if (/未登录|登录失效|cookie.*过期|expired/i.test(error.message)) {
      return error.message;
    }
    return null;
  }
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
    button.classList.remove("is-loading");
    button.disabled = false;
    if (label) label.textContent = originalText;
    shopRequestInFlight = false;
  }
}

function shopPlanStatus(plan, index) {
  const progress = shopRunningProgress[String(index)];
  if (progress) {
    const attempt = Number(progress.attempt || 0);
    const message = progress.message || "兑换中";
    return attempt > 0
      ? `兑换中 · 第 ${attempt} 次尝试 · ${message}`
      : `兑换中 · ${message}`;
  }
  if (plan.last_result) {
    return `${plan.enable === false ? "已暂停，" : ""}最近结果：${plan.last_result}`;
  }
  if (plan.enable === false) return "已暂停";
  if (plan.exchange_at) {
    return `等待 ${formatTime(timestampToIso(plan.exchange_at))}`;
  }
  return "未设置兑换时间";
}

function isEditingShopConfig() {
  const active = document.activeElement;
  return Boolean(
    active?.matches?.(
      "[data-shop-plan-field], #shopEnable, #shopRetrySeconds, #shopRetryInterval",
    ),
  );
}

// 账号变动后服务端会重新绑定兑换计划（下标重算、账号已删除的计划停用），这里把结果同步回界面
async function refreshShopPlans() {
  const latest = await api("/api/config");
  config.shop_exchange = latest.shop_exchange;
  renderShopConfig();
}

// --- Module: login_view.js ---
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

// --- Module: records_view.js ---
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

// --- Module: main.js ---
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

async function runNow() {
  await autoSaveConfig();
  await api("/api/run", { method: "POST", body: "{}" });
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
