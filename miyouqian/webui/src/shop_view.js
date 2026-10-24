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
