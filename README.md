# 米游签 (MiYoQian)

<div align="center">
  <h1 align="center">
    <img src="./miyouqian/webui/assets/myq_logo.png" width="200" alt="米游签" style="border-radius:10px">
  </h1>
  <p>小而美、高健壮性的米游社日常自动化与签到助手，支持扫码登录、多账号管理、游戏社区签到、云游戏签到、米游币任务、商品定时兑换、任务记录持久化与开箱即用的现代化 Web 控制台。</p>
  <p>
    <img alt="Python" src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&style=flat-square">
    <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-1E9BFA?style=flat-square">
    <img alt="Docker" src="https://img.shields.io/badge/Docker-Multi--stage-2496ED?logo=docker&style=flat-square">
    <img alt="Encoding" src="https://img.shields.io/badge/encoding-UTF--8-2EA44F?style=flat-square">
  </p>
</div>

---

## 📌 项目简介

**米游签** 是一款注重软件工程质量、注重隐私安全与系统稳定性的自动化工具。支持米游社 APP 扫码一键写入凭证，无需手动抓包提取复杂 Cookie。

在全新版本中，项目全面实施了**仓储模式架构 (Repository Pattern)**、**账号数据解耦持久化 (`account.json`)**、**任务执行记录持久化** 与 **Web 控制台执行记录看板**，彻底解决以往依赖纯文本控制台日志判断任务执行状态不靠谱的痛点。

<img src="./assets/home.png" alt="控制台预览" style="max-width:100%;border-radius:10px">

> [!IMPORTANT]
> - 本项目仅供学习与个人日常自用，**请勿在公开论坛或其它平台大范围推广传播**。
> - 自动化签到与任务请保持合理、保守的调用频率，降低账号风控风险。

---

## ✨ 核心特性

- 📱 **扫码登录**：支持米游社 APP 扫码，自动获取并生成签名所需的 `stoken`、`stuid`、`mid` 和 `cookie`，无需手动抓包。
- 👥 **多账号与原子持久化**：账号数据独立存放于 `account.json`，采用同目录临时文件原子替换与 `0o600` 权限保护；老版本 `credentials.yaml` 自动无感迁移。
- 🎮 **游戏社区签到**：支持原神、崩坏：星穹铁道、绝区零、崩坏3、未定事件簿、崩坏学园2，支持多角色独立签到与特定角色黑名单过滤。
- ☁️ **云游戏签到**：原生支持云原神、云绝区零每日时长签到领取。
- 🪙 **米游币日常任务**：支持社区签到、看帖、点赞、分享及自动取消点赞。
- 🎁 **米游币商品定时兑换**：支持按分区浏览商品库、库存监控、毫秒级定时抢兑与失败快速重试。
- 📊 **任务执行记录看板（新）**：每次执行（定时/手动/CLI）均生成结构化记录（耗时、状态、分账号及子阶段结果、错误原因），并在 Web 控制台专属 Tab 中直观展示与审查。
- 🛡️ **调度器防崩与状态透传（新）**：每日调度器线程内建全局异常捕获与自愈机制，Jitter 随机延后状态在 WebUI 实时显示（“延后中·预计 XX:XX:XX 执行”），热更配置即时生效。
- 🧩 **全自动过验证码**：支持打码狗与遵循规范的自定义打码接口，极验 Challenge 防失效保护与幂等控制。
- 🧹 **源码零污染**：全局自动将字节码重定向至最外层 `.cache/pycache`，打包输出归集至 `dist/`，保持工作区绝对洁净。

---

## 🎮 支持的游戏与业务

### 1. 游戏社区签到

| 游戏 | 配置标识 (`key`) | 默认状态 | 说明 |
| :--- | :--- | :--- | :--- |
| **原神** | `genshin` | 启用 | 支持获取角色列表并逐一签到，支持角色黑名单 |
| **崩坏：星穹铁道** | `starrail` | 启用 | 支持开拓者角色签到与奖励领取 |
| **绝区零** | `zzz` | 启用 | 支持绳匠角色签到与奖励领取 |
| **崩坏3** | `honkai3rd` | 可选 | 需在 Web 控制台或配置中按需勾选开启 |
| **未定事件簿** | `tears` | 可选 | 需在 Web 控制台或配置中按需勾选开启 |
| **崩坏学园2** | `honkai2` | 可选 | 需在 Web 控制台或配置中按需勾选开启 |

### 2. 云游戏签到

云游戏签到需使用专用的 `x-rpc-combo_token`（非普通米游社 Cookie）。在 Web 控制台启用云游戏后，点击账号行右侧的**云图标**填入对应 Token 即可：

| 云游戏 | 配置标识 | 状态 | Token 抓取与获取说明 |
| :--- | :--- | :--- | :--- |
| **云原神** | `genshin` | 支持 | 浏览器打开 [云原神网页版](https://ys.mihoyo.com/cloud/#/) 并登录，F12 打开网络面板过滤 `wallet/wallet/get` 请求，复制请求头中的 `X-Rpc-Combo_token` |
| **云绝区零** | `zzz` | 支持 | 需通过手机抓包获取（云绝区零无网页版），复制请求头中的 `X-Rpc-Combo_token` |
| **云星穹铁道** | `starrail` | 不可选 | 官方机制为版本更新直发 600 分钟，无需每日签到获取时长 |

---

## 📁 数据存储与配置文件结构

本项目采用**配置与私密数据严格解耦**的标准架构：

```text
├── config.yaml          # 应用常规设置（任务开关、调度时间、Web端口等，脱敏）
├── account.json         # 核心账号凭据与数据（Cookie、stoken、云游戏Tokens，敏感私密）
├── data/
│   └── records.json     # 结构化任务执行记录（每次执行的结果、状态、耗时与明细）
└── logs/
    └── miyouqian.log    # 运行滚动纯文本日志
```

> [!TIP]
> **旧版无缝平滑自动迁移**：
> 如果您是从旧版本升级，系统在首次启动时会自动检测旧版的 `data/credentials.yaml` 或 `config.yaml` 中遗留的账号信息，并全自动无损转录至全新的 `account.json`。旧文件将保留作为备份，升级过程完全无需人工干预。

---

## 🚀 部署指南

### 方式一：Docker 容器化部署（强烈推荐）

适用于各类 Linux 服务器、群晖/威联通/极空间 NAS 等环境。镜像采用**多阶段构建**，容器内已预置配置**阿里云 Debian APT 镜像源**与**阿里云 PyPI 源**，大幅提升国内依赖构建成功率。

`docker/docker-compose.yml` 预置集成了专为米游社定制的 **极验识别微服务 (test_nine)**，开箱即用：

#### 1. 获取并启动服务

```bash
git clone https://github.com/whiletoken/MiyoQian.git
cd MiyoQian/docker

# 构建并后台启动全部服务（MiyoQian 主程序 + 极验识别容器）
docker compose up -d --build
```

启动完成后：
- 浏览器访问 `http://<宿主机IP>:5890` 即可进入 Web 控制台；
- 极验识别容器（`test_nine`）监听在 `9645` 端口，容器内部网络通信地址为 `http://test_nine:9645/pass_uni`。

> [!NOTE]
> - 容器内时区已默认配置为 `Asia/Shanghai`；
> - 默认使用 Docker 独立命名卷 `miyouqian_state` 挂载在 `/app/state`，配置、凭据与任务记录在容器重建后均会自动持久化，不会丢失；
> - 若国内服务器无法直连拉取 Docker Hub 基础镜像，推荐在 `/etc/docker/daemon.json` 配置加速器，或在构建时指定公共代理镜像：`BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim-bookworm docker compose up -d --build`。

#### 2. 映射宿主机已有文件（可选）

如需直接把宿主机上的 `account.json` 或 `config.yaml` 映射进容器，可修改 `docker/docker-compose.yml` 中的 `volumes`：

```yaml
services:
  miyouqian:
    volumes:
      - ./config.yaml:/app/state/config.yaml
      - ./account.json:/app/state/account.json
      - ./data:/app/state/data
      - ./logs:/app/state/logs
```

---

### 方式二：本地运行部署 (uv 极速管理)

推荐使用新一代 Python 包管理工具 [uv](https://astral.sh/uv) 运行。

#### 1. 安装 uv 并克隆仓库

- **Windows (PowerShell)**:
  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```
- **Linux / macOS**:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

```bash
git clone https://github.com/whiletoken/MiyoQian.git
cd MiyoQian
```

#### 2. 初始化环境并启动 Web 服务

```bash
# 同步安装运行依赖
uv sync

# 启动 Web 控制台（支持自动重定向缓存至 .cache/）
uv run python main.py
```

终端打印输出控制台地址后，在浏览器打开 `http://127.0.0.1:5890` 即可开始使用。

---

### 方式三：GitHub Actions 自动化签到（免服务器）

适合没有长期开机电脑或云服务器的用户。Actions 每天定时运行签到并沉淀结果：

1. 点击本仓库右上角 **`Use this template`** -> **`Create a new repository`** 创建您自己的私有仓库（**切勿使用 Fork，Fork 会因运行时长耗尽上游资源导致被封**）；
2. 在本地或 Docker 环境完成一次扫码登录，获取生成的 `config.yaml` 和 `account.json`；
3. 进入您的 GitHub 仓库：`Settings -> Secrets and variables -> Actions -> New repository secret`，添加以下 Secrets：
   - `MIYOUQIAN_CONFIG`: 填入 `config.yaml` 完整文本；
   - `MIYOUQIAN_ACCOUNTS`: 填入 `account.json` 完整文本；
4. 在 `.github/workflows/checkin.yml` 中调整所需的 Cron 定时表达式，Actions 将按时自动触发签到。

---

## 🖥️ Web 控制台使用详解

Web 控制台划分为三大工作视窗：

```text
┌────────────────────────────────────────────────────────┐
│  米游签 [本地控制台]         [ 签到 ]  [ 记录 ]  [ 兑换 ]  │
├────────────────────────────────────────────────────────┤
│                                                        │
│  [签到控制台] : 账号扫码登录、功能开关、每日定时与运行日志    │
│  [执行记录]   : 结构化历史批次、分账号结果、奖励统计与当次日志│
│  [商品兑换]   : 分区商品检索、实时库存监控、抢兑计划管理     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 1. 签到控制台 (`Dashboard`)
- **运行指标**：顶部实时呈现“账号数”、“自动调度状态”、“下次执行时间”与“最近执行结果”。若处于 Jitter 波动期间，调度状态会贴心呈现 `延后中 (预计 XX:XX 开始)`。
- **账号管理**：点击“添加”创建账号槽位，点击“登录”唤起米游社 APP 扫码（APP 内操作：我的 -> 左上角扫一扫）。
- **任务开关**：灵活勾选游戏签到、云游戏签到、米游币任务及论坛子项。
- **每日调度**：支持设置每日基准执行时间（如 `09:00`）与随机波动分钟数（如 `45` 分钟），模拟真实人工操作；支持“服务启动后立即执行一次”。

### 2. 执行记录看板 (`Records` 新增)
彻底告别“翻日志猜结果”的旧体验：
- **执行指标概览**：统计历史总批次数、最近执行状态、最近执行时间与整体成功率。
- **批次结果折叠卡片**：
  - 徽章标签标注当次触发方式（`定时调度` / `手动触发` / `命令行`）及全局状态（`全部成功` / `部分成功` / `执行失败` / `已跳过`）；
  - 单击卡片展开，清晰展示当前批次下**各账号各游戏签到获得的具体奖励道具**、**米游币完成的条目**或**失败原因**；
  - 内置“查看当次完整执行日志”抽屉，便于深入追溯细节；
- **记录管理**：支持一键“刷新记录”与“清空历史记录”。

### 3. 商品兑换看板 (`Shop`)
- **商品浏览**：按游戏分区加载米游币商城最新可兑换实物与游戏道具；
- **兑换计划**：支持设置商品 ID、绑定账号、收货地址或游戏内 UID，可设定到毫秒级的定时自动抢兑，并支持配置重试次数与间隔。

---

## ⌨️ 命令行 (CLI) 快速用法

除 Web 控制台外，本项目提供完整的命令行操作接口：

```bash
# 初始化生成默认配置文件
uv run python main.py init

# 命令行米游社 APP 扫码登录并自动写入凭证至 account.json
uv run python main.py login --account main

# 执行一次全量签到任务（自动落盘至 records.json）
uv run python main.py run

# 仅执行指定账号
uv run python main.py run --account main

# 仅执行游戏社区签到与云游戏
uv run python main.py run --games-only

# 仅执行米游币社区任务
uv run python main.py run --bbs-only

# 仅执行指定游戏
uv run python main.py run --game genshin --game starrail

# 以常驻 Web 控制台方式启动，并指定监听端口
uv run python main.py serve --host 0.0.0.0 --port 5890

# 显示当前配置与已配置账号概览
uv run python main.py show
```

---

## 🔒 验证码对接规范 (Captcha)

米游币任务与部分签到可能遭遇极验 (Geetest) 九宫格、便笺、滑块或文字点选验证。项目默认跳过验证码，如需自动识别，可在 Web 控制台开启：

1. **米游社极验本地/容器服务 (test_nine)**：针对米游社各类题型专门微调的开源识别服务。若使用 `docker-compose.yml` 启动，接口地址直接填写 `http://test_nine:9645/pass_uni`；若在宿主机直接运行填 `http://127.0.0.1:9645/pass_uni` 即可，0 额外调用成本；
2. **打码狗 (Damagou)**：填入用户 `userkey` 即可直接使用；
3. **自定义打码服务**：遵循项目自有的标准接口调用规范。完整请求协议、返回数据信封与状态码定义见 [`miyouqian/webui/custom-captcha-api.md`](miyouqian/webui/custom-captcha-api.md)。

> [!NOTE]
> 项目内建 Challenge 保护机制：非限流排队错误绝不重放同一个 Challenge，规避二次提交被秒拒与重复计费。

---

## ❓ 常见问题 (FAQ)

<details>
<summary><strong>Q: 账号和 Cookie 凭据保存在哪里？如何备份？</strong></summary>

所有账号的敏感鉴权凭证（`stoken`、`cookie`、`stuid`、云游戏 Tokens）统一存储于根目录或状态目录下的 **`account.json`** 中。常规业务开关在 `config.yaml`。若需迁移或备份，只需妥善保管 `account.json` 即可。
</details>

<details>
<summary><strong>Q: 早上设了 09:00 定时，为什么到 09:10 看还没有签到成功？</strong></summary>

请检查配置中的 **随机波动分钟 (`jitter_minutes`)**。默认设置为 45 分钟，即系统会在 09:00 到 09:45 之间随机选择一个时间点触发。在此期间，Web 控制台的自动调度状态会清晰显示为 `延后中 (预计 09:XX:XX 开始执行)`。同时，可在全新的「记录」页面中精确查看历史批次完成的时间与明细。
</details>

<details>
<summary><strong>Q: 为什么 Docker 容器里的定时任务感觉晚了 8 小时？</strong></summary>

这是典型的容器时区问题。使用标准命令行 `docker run` 启动时，如果未配置时区，容器系统时钟默认为 UTC（比北京时间慢 8 小时）。推荐直接使用本项目提供的 `docker compose` 启动，其默认注入了 `TZ=Asia/Shanghai`。Web 控制台每次启动也会在日志首行显式输出当前检测到的系统本地时间与时区。
</details>

<details>
<summary><strong>Q: 从旧版升级后，旧数据会自动迁移吗？</strong></summary>

是的。系统启动时会检测是否存在 `account.json`，若为空则会自动读取旧版的 `data/credentials.yaml` 和 `config.yaml`，提取并平滑转录账号数据。迁移成功后旧文件保留作为备份，老用户无感升级。
</details>

---

## 📄 免责声明

1. 本项目仅供学习、研究 Python 异步/同步网络编程以及个人日常管理米游社账号使用，严禁用于任何商业牟利或侵权场景。
2. 使用本工具自动化执行签到任务存在因米哈游风控规则更新导致的任务失败或账号限制风险，开发者不对因使用本程序产生的任何损失负责。
3. 请严格妥善保管好您自己的 `account.json` 凭据文件，请勿上传到任何公共公开的代码仓库中。

---

## 💡 致谢与灵感

- [Womsxd/MihoyoBBSTools](https://github.com/Womsxd/MihoyoBBSTools)
- [jiarui666/mihoyo_qr_login](https://github.com/jiarui666/mihoyo_qr_login)
- [linux.do](https://linux.do/) 交流社区
