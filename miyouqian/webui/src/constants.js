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
let shopGames = [
  { key: "hk4e", name: "原神" },
  { key: "", name: "全部分区" },
];
let shopSelectedGame = "hk4e";
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
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth();
let calSelectedDate = "";

const $ = (id) => document.getElementById(id);
