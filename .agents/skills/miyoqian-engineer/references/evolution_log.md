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
