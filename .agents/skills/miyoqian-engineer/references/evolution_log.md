# MiyoQian 技能持续演进账本 (Continuous Evolution Ledger)

本文件持久化记录项目在迭代过程中沉淀的架构决策、规范变更、踩坑避坑经验及特定偏好。
所有 AI Agent 在执行重构与开发前均需参考本文件，并在完成演进后由 `scripts/evolve_skill.py` 自动追加新纪要。

--------------------------------------------------------------------------------

### [2026-10-21 09:35:00] PERF: Docker 镜像精简与构建源加速
- **记录者**: Antigravity Agent
- **演进类型**: `perf`
- **核心要点**:
  1. Dockerfile 改用多阶段构建（builder 阶段下载安装，runner 阶段仅保留运行环境），剔除构建工具与中间缓存。
  2. 针对国内构建网络卡顿，动态注入国内 PyPI 镜像源与 Docker Hub 源。
  3. 彻底移除 `# syntax=docker/dockerfile:1` 避免在线拉取导致构建死锁。
  4. 虚拟环境通过 `COPY --chown` 一步到位，避免重复 `chown -R` 导致镜像体积翻倍。
- **门禁校验**: Dockerfile 格式校验通过，构建流程精简无死锁。
---

### [2026-10-21 12:40:00] ARCH: 剥离消息推送子系统与降低系统负担
- **记录者**: Antigravity Agent
- **演进类型**: `arch`
- **核心要点**:
  1. 彻底删除全部消息推送模块（notifier.py、qq_bot.py、onebot.py、templates/push/ 目录）。
  2. 移除 WebUI、CLI、配置管理中的全部推送路由与通道依赖（削减 5000+ 行非核心代码）。
  3. 系统定位收敛为纯粹、高可靠的签到自动化工具，大幅降低外部网络与第三方即时通信协议的不稳定性。
- **门禁校验**: 关联测试清理完毕，残留配置兼容性测试通过。
---

### [2026-10-21 13:06:00] STORAGE: 账户持久化解耦与自动平滑迁移
- **记录者**: Antigravity Agent
- **演进类型**: `storage`
- **核心要点**:
  1. 将账户凭据从 `config.yaml` / `credentials.yaml` 中彻底剥离至 `account.json`。
  2. 支持 Docker 容器化独立挂载映射（如 `-v ./account.json:/app/data/account.json`）。
  3. 引入仓储模式（`AccountRepository`），采用原子写入机制（临时文件 -> fsync -> chmod 0o600 -> replace），防止数据损坏。
  4. 引入平滑无感自动迁移机制：如果检测到已有配置或旧凭证，系统自启动时自动转录至 `account.json`，确保老用户无感升级。
- **门禁校验**: 50 项单元测试全绿通过，覆盖重复账号、缺失文件、原子保存与自动迁移场景。
---

### [2026-10-21 13:16:00] CACHE: 缓存隔离与源码零污染规范落地
- **记录者**: Antigravity Agent
- **演进类型**: `cache`
- **核心要点**:
  1. 引入根目录 `sitecustomize.py`，全局拦截并将 `sys.pycache_prefix` 及 `PYTHONPYCACHEPREFIX` 重定向至 `.cache/pycache`。
  2. 统一构建编译产物输出至根目录 `dist/`，清理所有源文件目录内的编译杂质。
  3. 在 `pyproject.toml` 中配置 `cache_dir = ".cache/pytest"` 归集测试缓存。
  4. 源码及测试目录全面实现零 `.pyc` 污染，严格纳入 `.gitignore` 与 `.dockerignore` 审计。
- **门禁校验**: 目录树扫描通过，无任何源码杂质产生。
---

### [2026-10-21 13:18:00] RULE: 幂等性网络重试与任务粒度故障隔离
- **记录者**: Antigravity Agent
- **演进类型**: `rule`
- **核心要点**:
  1. 明确 HTTP 重试边界：仅幂等 GET 请求在网络超时阶段退避重试，POST 请求与单次 Geetest challenge 绝不重试。
  2. 确立逐级故障隔离原则：单账号失败不影响整体、单游戏失败不影响其他游戏、单条看帖/点赞失败不影响整体米游币进度。
- **门禁校验**: 任务隔离性单元测试与网络重试测试全绿通过。
---

### [2026-10-21 13:35:23] FIX: 调度器防崩自愈、时区透传、动态重载与异步日志队列全链路增强
- **记录者**: Antigravity Agent
- **演进类型**: `fix`
- **核心要点**:
1. 调度器主循环防崩：DailyScheduler._loop 增加顶层异常防护与 10s 间隔自动自愈机制，避免守护线程意外死亡。\n2. Jitter 延后状态透传与中断感知：_wait_jitter 记录预计执行时间并在 WebUI 呈现，配置在延后期间热更时立即唤醒重排。\n3. 异常全堆栈追踪：_run_once 捕获异常时记录完整 traceback，根除日志吞噬隐患。\n4. 执行前动态热重载：WebApp.run_all 在每次任务编排前自动从磁盘重载最新配置与账号，消除内存脱节。\n5. WebUI 启动日志回显：WebApp 启动时自动 tail 磁盘日志，避免重启页面白板。\n6. 异步并发日志安全：logger 配置 enqueue=True，且服务启动时透传当前系统时间与时区。
- **门禁校验**: 测试套件 100% 通过，工程规范校验通过。
---

### [2026-10-21 13:58:56] STORAGE: 任务执行结果持久化与 WebUI 记录看板
- **记录者**: Antigravity Agent
- **演进类型**: `storage`
- **核心要点**:
1. 任务结果持久化解耦：引入 RecordRepository 仓储模式，每次任务执行（定时调度、命令行、手动触发）均生成结构化执行记录并原子写入 records.json。\n2. 结构化执行度量：记录包含每次执行的时间戳、耗时、触发源、全局状态（成功/部分成功/失败/跳过）、分账号与分阶段明细及完整日志。\n3. WebUI 执行记录看板：新增 '记录' Tab 标签页与 /api/records 接口，支持查看历史批次、分账号详情、成功失败明细、查看当次完整日志与一键清空历史。\n4. 控制台状态联动：仪表盘 '最近结果' 优先显示持久化执行记录与摘要，彻底摆脱单靠纯文本日志判断任务状态的不靠谱现状。
- **门禁校验**: 测试套件 100% 通过，工程规范校验通过。
---

### [2026-10-21 14:40:55] PERF: Docker基础镜像改用阿里云源并接入米游社极验test_nine微服务
- **记录者**: Antigravity Agent
- **演进类型**: `perf`
- **核心要点**:
1. Dockerfile与docker-compose基础镜像全面切换为阿里云ACR镜像(registry.cn-hangzhou.aliyuncs.com/library/python:3.11-slim-bookworm)，并配置Debian阿里云APT加速源; 2. 在docker-compose.yml集成米游社极验验证码识别微服务luguoyixiazi/test_nine; 3. 在miyouqian/core/captcha.py实现TestNineCaptchaSolver策略，兼容标准/扁平JSON响应，不重试防止challenge失效; 4. WebUI和config.example.yaml与README完善对接支持。
- **门禁校验**: 测试套件 100% 通过，工程规范校验通过。
---

### [2026-10-21 19:47:42] STORAGE: 兑换任务日志与记录结构化持久化、验证码反显修复与全量配置JSON化
- **记录者**: Antigravity Agent
- **演进类型**: `storage`
- **核心要点**:
1. 兑换任务日志清晰化：在 ShopExchange 与 WebApp 中明确标记【兑换成功】与【兑换失败】，消除状态歧义；2. 兑换执行结果持久化：将兑换任务执行结果统一持久化至 RecordRepository (records.json)，Web 控制台记录看板无缝展示；3. 验证码识别反显修复：在 normalize_captcha_channels 补齐 test_nine 极验通道白名单与默认字典，修复前端反显与隐藏字段采集；4. 全量配置 JSON 化：支持将系统脱敏配置统一持久化保存至 config.json，具备原子替换写入并无损兼容自动迁移旧版 config.yaml。
- **门禁校验**: 测试套件 100% 通过，工程规范校验通过。
---

### [2026-10-22 08:36:54] ARCH: 移除 Web 控制台密码登录与认证限制，实现页面直接免密访问
- **记录者**: Antigravity Agent
- **演进类型**: `arch`
- **核心要点**:
1. 架构精简：剥离 Web 控制台强制设置与校验外网密码的认证机制，移除 session 管理、密码散列与校验函数；2. 路由无阻：全面开放 Web 静态资源与全部 /api/* 接口直接访问，保留 /api/auth/* 协议兼容存根；3. 前端轻量化：移除 app.js 弹窗遮罩逻辑 (showAuthPage、checkAuthAndInit) 与 app.css 对应样式，页面加载直接进入主程序；4. 模板与配置解耦：清理 config.example.json、config.example.yaml 与 config.py 中废弃的 web.password 默认项；5. 自动化测试保障：新增 test_web_service.py 覆盖无凭证直接访问、配置热更与老路由兼容，同步更新 node 端 shop plan 驱动测试。
- **门禁校验**: 测试套件 100% 通过，工程规范校验通过。
---
