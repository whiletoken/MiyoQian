// ===========================================================================
// 米游币商品商城与兑换计划管理
// ===========================================================================

function renderShopConfig() {
  if (!$("shopEnable")) return;
  const shop = config.shop_exchange || {};
  $("shopEnable").checked = Boolean(shop.enable ?? false);
  $("shopRetrySeconds").value = shop.retry_seconds ?? 20;
  $("shopRetryInterval").value = shop.retry_interval ?? 0.4;
  // 横幅状态指标已全部清理
  renderShopGameFilter();
  renderShopGoods();
  renderShopGoodsLoadingState();
  renderShopPlans();
}

function renderShopGameFilter() {
  const select = $("shopGameFilter");
  if (!select) return;
  select.innerHTML = shopGames
    .map(
      (game) =>
        `<option value="${escapeAttr(game.key)}" ${game.key === shopSelectedGame ? "selected" : ""}>${escapeHtml(game.name)}</option>`,
    )
    .join("");
}

function getFilteredGoods() {
  if (shopFilterStatus === "sold_out") {
    return shopGoods.filter((good) => isShopGoodSoldOut(good));
  }
  if (shopFilterStatus === "available") {
    return shopGoods.filter(
      (good) => !isShopGoodSoldOut(good) && canShopGoodExchangeNow(good),
    );
  }
  return shopGoods;
}

function renderShopGoodsLoadingState() {
  const select = $("shopGameFilter");
  const button = $("shopRefreshBtn");
  if (select) select.disabled = shopGoodsLoading;
  if (!button) return;
  const label = button.querySelector("span");
  button.disabled = shopGoodsLoading;
  button.classList.toggle("is-loading", shopGoodsLoading);
  if (label) label.textContent = shopGoodsLoading ? "加载中" : "刷新商品";
}

function renderShopGoods() {
  const list = $("shopGoods");
  if (!list) return;

  if (shopGoodsLoading) {
    list.innerHTML = `<div class="empty-state shop-empty shop-loading">
        <span class="qr-loading" aria-hidden="true"></span>
        <strong>商品加载中</strong>
        <span>正在获取商品图片、兑换时间、库存和限购信息…</span>
      </div>`;
    renderShopPagination();
    return;
  }

  const filtered = getFilteredGoods();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / SHOP_PAGE_SIZE));
  if (shopCurrentPage > totalPages) shopCurrentPage = totalPages;

  const start = (shopCurrentPage - 1) * SHOP_PAGE_SIZE;
  const pageGoods = filtered.slice(start, start + SHOP_PAGE_SIZE);

  if (pageGoods.length) {
    list.innerHTML = pageGoods
      .map((good) => shopGoodCard(good, shopGoods.indexOf(good)))
      .join("");
  } else {
    list.innerHTML = `<div class="empty-state shop-empty">
        <strong>暂无商品数据</strong>
        <span>${shopFilterStatus ? "当前筛选条件下没有商品。" : "点击刷新商品后，会显示兑换时间、库存、价格和图片。"}</span>
      </div>`;
  }

  bindShopGoodsEvents();
  renderShopPagination();
}

function renderShopPagination() {
  let container = $("shopPagination");
  const list = $("shopGoods");

  if (!container && list) {
    container = document.createElement("div");
    container.id = "shopPagination";
    container.className = "shop-pagination";
    list.parentNode.insertBefore(container, list.nextSibling);
  }

  if (!container) return;

  const filteredCount = shopGoodsLoading ? 0 : getFilteredGoods().length;
  if (filteredCount <= SHOP_PAGE_SIZE) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";

  const total = Math.max(1, Math.ceil(filteredCount / SHOP_PAGE_SIZE));
  if (shopCurrentPage > total) shopCurrentPage = total;
  const current = shopCurrentPage;

  let html = `
    <button class="ghost page-btn" data-page="prev" ${current <= 1 ? "disabled" : ""}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M7 1L3 5l4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
    </button>
  `;

  const pages = getVisiblePages(current, total);
  for (const p of pages) {
    if (p === "...") {
      html += `<span class="page-ellipsis">…</span>`;
    } else {
      html += `<button class="ghost page-btn ${p === current ? "is-active" : ""}" data-page="${p}">${p}</button>`;
    }
  }

  html += `
    <button class="ghost page-btn" data-page="next" ${current >= total ? "disabled" : ""}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
    </button>
    <span class="page-info">共 ${filteredCount} 件 · ${current}/${total} 页</span>
  `;

  container.innerHTML = html;

  container.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page === "prev" && shopCurrentPage > 1) {
        shopCurrentPage--;
      } else if (page === "next" && shopCurrentPage < total) {
        shopCurrentPage++;
      } else if (Number(page)) {
        shopCurrentPage = Number(page);
      }
      renderShopGoods();
      const topEl = $("shopGameFilter") || $("shopGoods");
      topEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// getVisiblePages is defined in utils.js

function shopGoodCard(good, index) {
  const soldOut = isShopGoodSoldOut(good);
  const canAddPlan = canShopGoodAddPlan(good);
  const exchangeNow = canShopGoodExchangeNow(good);
  const exchanging = shopExchangeNowGoodsId === String(good.goods_id || "");
  const exchangeLabel =
    good.display_status === "sold_out_with_next" ? "下次兑换" : "兑换";
  const exchangeButtonText = exchanging
    ? "兑换中…"
    : soldOut
      ? "已售罄"
      : exchangeNow
        ? "兑换"
        : "即将开始";
  const exchangeButtonTitle = exchanging
    ? "正在发送兑换请求"
    : soldOut
      ? "商品已售罄"
      : exchangeNow
        ? "立即发送兑换请求"
        : "商品还未开启兑换";
  const image = good.icon
    ? `<img src="${escapeAttr(good.icon)}" alt="${escapeAttr(good.goods_name)}" loading="lazy" />`
    : `<div class="shop-image-fallback">无图</div>`;
  return `
    <article class="shop-good ${soldOut ? "is-sold-out" : ""}" data-shop-good="${index}">
      <div class="shop-good-image">${image}</div>
      <div class="shop-good-main">
        <div class="shop-good-title">
          <strong>${escapeHtml(good.goods_name)}</strong>
          ${soldOut ? "<span>已售罄</span>" : ""}
        </div>
        <div class="shop-good-meta">
          <span>${exchangeLabel} ${escapeHtml(good.exchange_time || "-")}</span>
          <span class="${soldOut ? "sold-out" : ""}">${soldOut ? "已售罄" : `库存 ${escapeHtml(good.stock || "-")}`}</span>
          <span>${escapeHtml(String(good.price ?? 0))} 米游币</span>
          <span>${escapeHtml(good.limit || "-")}</span>
        </div>
      </div>
      <div class="shop-good-actions">
        <button class="ghost" type="button" data-shop-add="${index}" title="${canAddPlan ? "加入兑换计划" : "商品已售罄"}" ${canAddPlan ? "" : "disabled"}>
          <svg><use href="#i-plus"></use></svg>
          <span>计划</span>
        </button>
        <button class="primary ${exchanging ? "is-loading" : ""}" type="button" data-shop-now="${index}" title="${exchangeButtonTitle}" ${exchangeNow && !exchanging ? "" : "disabled"}>
          <svg><use href="#i-play"></use></svg>
          <span>${exchangeButtonText}</span>
        </button>
      </div>
    </article>
  `;
}

function renderShopPlans() {
  const list = $("shopPlans");
  if (!list) return;
  document
    .querySelectorAll("details.shop-plan[open]")
    .forEach((plan) => shopOpenPlans.add(plan.dataset.shopPlan));
  const plans = config.shop_exchange?.plans || [];
  list.innerHTML = plans.length
    ? plans.map((plan, index) => shopPlanRow(plan, index)).join("")
    : `<div class="empty-state">
        <strong>暂无兑换计划</strong>
        <span>从商品列表加入计划后，可设置账号、时间和可选的收货地址或游戏角色。</span>
      </div>`;
  bindShopPlanEvents();
}

function shopPlanAccountIndex(plan, accounts) {
  const stuid = String(plan.account_stuid || "").trim();
  if (!stuid) return Number(plan.account_index ?? 0);
  return (accounts || []).findIndex(
    (account) => String(account.stuid || "").trim() === stuid,
  );
}

function shopPlanRow(plan, index) {
  const accounts = config.accounts || [];
  const paused = plan.enable === false;
  const running = Boolean(shopRunningProgress[String(index)]);
  const open = shopOpenPlans.has(String(index)) ? "open" : "";
  const roleDisplay = shopRoleDisplay(plan);
  const serverDisplay = shopServerDisplay(plan);
  const selectedAccount = shopPlanAccountIndex(plan, accounts);
  const missingOption =
    selectedAccount < 0 && plan.account_stuid
      ? `<option value="" data-stuid="${escapeAttr(plan.account_stuid)}" selected>账号已删除（UID ${escapeHtml(plan.account_stuid)}）</option>`
      : "";
  const accountOptions =
    accounts.length || missingOption
      ? missingOption +
        accounts
          .map((account, accountIndex) => {
            const selected = accountIndex === selectedAccount ? "selected" : "";
            const stuid = String(account.stuid || "").trim();
            return `<option value="${accountIndex}" data-stuid="${escapeAttr(stuid)}" ${selected}>${escapeHtml(accountLabel(account))}</option>`;
          })
          .join("")
      : `<option value="0">暂无账号</option>`;
  return `
    <details class="shop-plan ${paused ? "is-paused" : ""}" data-shop-plan="${index}" ${open}>
      <summary class="shop-plan-summary">
        <span class="shop-plan-title">
          <strong>${escapeHtml(plan.goods_name || plan.goods_id)}</strong>
          <small>${escapeHtml(shopPlanStatus(plan, index))}</small>
        </span>
        <span class="shop-plan-badges">
          <span class="plan-badge ${running ? "running" : paused ? "paused" : "active"}">${running ? "兑换中" : paused ? "已暂停" : "自动"}</span>
          <span class="disclosure" aria-hidden="true"></span>
        </span>
      </summary>
      <div class="shop-plan-body">
        <div class="shop-plan-head">
          <label class="check-row">
            <input data-shop-plan-field="enable" type="checkbox" ${plan.enable !== false ? "checked" : ""} data-autosave />
            <span>启用该计划</span>
          </label>
          <button class="ghost icon-only" type="button" data-shop-remove="${index}" title="删除计划">
            <svg><use href="#i-trash"></use></svg>
          </button>
        </div>
        <div class="form-grid two compact">
          <label>
            <span>执行账号</span>
            <div class="select-wrapper">
               <select data-shop-plan-field="account_index" data-autosave>${accountOptions}</select>
               <svg class="select-arrow" width="12" height="8" aria-hidden="true">
                   <use href="#arrow-down"/>
               </svg>
            </div>
          </label>
          <label>
            <span>兑换时间</span>
            <input data-shop-plan-field="exchange_at" type="datetime-local" value="${escapeAttr(timestampToLocalInput(plan.exchange_at))}" data-autosave />
          </label>
          ${Number(plan.type || 0) !== 2 ? `
          <label>
            <span>收货地址</span>
            <div class="select-wrapper">
              <select data-shop-plan-field="address_id" data-autosave data-address-select>
                  ${shopPlanAddressSelectHtml(plan)}
              </select>
               <svg class="select-arrow" width="12" height="8" aria-hidden="true">
                   <use href="#arrow-down"/>
               </svg>
            </div>
          </label>` : ""}
          <div class="readonly-field">
            <span>游戏角色</span>
            <strong>${escapeHtml(roleDisplay)}</strong>
          </div>
          <div class="readonly-field">
            <span>服务器</span>
            <strong>${escapeHtml(serverDisplay)}</strong>
          </div>
        </div>
        <input data-shop-plan-field="auto" type="hidden" value="${plan.auto === false ? "false" : "true"}" />
        <input data-shop-plan-field="goods_id" type="hidden" value="${escapeAttr(plan.goods_id || "")}" />
        <input data-shop-plan-field="goods_name" type="hidden" value="${escapeAttr(plan.goods_name || "")}" />
        <input data-shop-plan-field="icon" type="hidden" value="${escapeAttr(plan.icon || "")}" />
        <input data-shop-plan-field="price" type="hidden" value="${escapeAttr(plan.price ?? 0)}" />
        <input data-shop-plan-field="stock" type="hidden" value="${escapeAttr(plan.stock || "")}" />
        <input data-shop-plan-field="type" type="hidden" value="${escapeAttr(plan.type ?? 0)}" />
        <input data-shop-plan-field="game" type="hidden" value="${escapeAttr(plan.game || "")}" />
        <input data-shop-plan-field="device_fp" type="hidden" value="${escapeAttr(plan.device_fp || "")}" />
        <input data-shop-plan-field="uid" type="hidden" value="${escapeAttr(plan.uid || "")}" />
        <input data-shop-plan-field="region" type="hidden" value="${escapeAttr(plan.region || "")}" />
        <input data-shop-plan-field="game_biz" type="hidden" value="${escapeAttr(plan.game_biz || "")}" />
        <input data-shop-plan-field="role_name" type="hidden" value="${escapeAttr(plan.role_name || "")}" />
        <input data-shop-plan-field="region_name" type="hidden" value="${escapeAttr(plan.region_name || "")}" />
        <input data-shop-plan-field="last_result" type="hidden" value="${escapeAttr(plan.last_result || "")}" />
        <input data-shop-plan-field="last_attempt_key" type="hidden" value="${escapeAttr(plan.last_attempt_key || "")}" />
        <input data-shop-plan-field="last_run" type="hidden" value="${escapeAttr(plan.last_run || "")}" />
        <div class="shop-plan-foot">
          <span>${escapeHtml(shopPlanStatus(plan, index))}</span>
          <button class="ghost" type="button" data-shop-plan-now="${index}" title="立即执行该兑换计划">
            <svg><use href="#i-play"></use></svg>
            <span>立即兑换</span>
          </button>
        </div>
      </div>
    </details>
  `;
}

function bindShopGoodsEvents() {
  document.querySelectorAll("[data-shop-add]").forEach((button) => {
    button.addEventListener("click", () =>
      withButtonLoading(button, "添加中…", () =>
        addShopPlan(shopGoods[Number(button.dataset.shopAdd)]),
      ),
    );
  });
  document.querySelectorAll("[data-shop-now]").forEach((button) => {
    button.addEventListener("click", () =>
      exchangeGoodNow(shopGoods[Number(button.dataset.shopNow)]).catch(
        (error) => showToast(error.message),
      ),
    );
  });
}

function bindShopPlanEvents() {
  document.querySelectorAll("details.shop-plan").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.open) shopOpenPlans.add(details.dataset.shopPlan);
      else shopOpenPlans.delete(details.dataset.shopPlan);
    });
  });
  document.querySelectorAll("[data-shop-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      collectConfig();
      config.shop_exchange.plans.splice(Number(button.dataset.shopRemove), 1);
      renderShopPlans();
      autoSaveConfig()
        .then(() => showToast("兑换计划已删除"))
        .catch((error) => showToast(error.message));
    });
  });
  document.querySelectorAll("[data-shop-plan-now]").forEach((button) => {
    button.addEventListener("click", () => {
      collectConfig();
      withButtonLoading(button, "兑换中…", () =>
        exchangePlanNow(Number(button.dataset.shopPlanNow)),
      );
    });
  });
  document
    .querySelectorAll('[data-shop-plan-field="account_index"]')
    .forEach((select) => {
      select.addEventListener("change", () => {
        const row = select.closest("[data-shop-plan]");
        const index = Number(row?.dataset.shopPlan);
        collectConfig();
        refreshShopPlanRole(index)
          .catch((error) => showToast(error.message))
          .then(() => refreshShopPlanAddresses(index))
          .catch((error) => showToast(error.message));
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
  const filterVal = $("shopGameFilter")?.value;
  const game = (filterVal !== undefined && filterVal !== null) ? filterVal : shopSelectedGame;
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
      if (!shopGames.some((g) => g.key === shopSelectedGame)) {
        const genshin = data.games.find((g) => g.key === "hk4e" || g.name?.includes("原神"));
        if (genshin) shopSelectedGame = genshin.key;
      }
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
