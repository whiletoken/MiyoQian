const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../miyouqian/webui/app.js"),
  "utf8",
);
assert.match(source, /\nstartApp\(\);\s*$/);

const ui = vm.createContext({
  document: {
    querySelectorAll: () => [],
    getElementById: () => ({ addEventListener() {}, textContent: "", innerHTML: "", classList: { add() {}, remove() {}, toggle() {} } }),
    addEventListener() {},
  },
  console: console,
});
vm.runInContext(source.replace(/\nstartApp\(\);\s*$/, "\n"), ui);

test("getRecordDateKey extracts date from timestamp or id", () => {
  const rec1 = { timestamp: "2026-10-24 19:30:00", id: "20261024_193000" };
  const rec2 = { id: "20261023_090000" };
  const rec3 = { timestamp: "2026-10-22T08:00:00+08:00" };
  assert.equal(ui.getRecordDateKey(rec1), "2026-10-24");
  assert.equal(ui.getRecordDateKey(rec2), "2026-10-23");
  assert.equal(ui.getRecordDateKey(rec3), "2026-10-22");
});

test("extractRewardsFromRecord parses game awards and cloud times", () => {
  const rec = {
    accounts: [
      {
        name: "测试账号",
        stages: [
          {
            stage: "游戏社区签到",
            success_items: ["原神 旅行者(1001) 已签到 「原石」x20", "星穹铁道 开拓者(2002) 「星琼」x20"],
          },
          {
            stage: "云游戏签到",
            success_items: ["云原神 获得 15 分钟免费时长"],
          },
        ],
      },
    ],
    messages: ["米游币今日进度：已获得 130，还可获得 0，本次新增 130"],
  };

  const rewards = ui.extractRewardsFromRecord(rec);
  assert.ok(rewards.length >= 3);
  const titles = rewards.map((r) => r.title);
  assert.ok(titles.some((t) => t.includes("「原石」x20")));
  assert.ok(titles.some((t) => t.includes("「星琼」x20")));
  assert.ok(titles.some((t) => t.includes("15分钟")));
  assert.ok(titles.some((t) => t.includes("米游币 +130")));
});

test("default shopSelectedGame is hk4e (原神)", () => {
  const selected = vm.runInContext("shopSelectedGame", ui);
  const games = vm.runInContext("shopGames", ui);
  assert.equal(selected, "hk4e");
  assert.ok(games.some((g) => g.key === "hk4e" && g.name.includes("原神")));
});
