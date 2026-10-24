# -*- coding: utf-8 -*-
"""本地 Web 控制台服务核心编排与协调器。"""

from __future__ import annotations

import copy
import json
import pathlib
import threading
from datetime import datetime
from typing import Any

from ..core.config import (
    bind_shop_plan_accounts,
    get_record_repository,
    load_config,
    log_path,
    normalize_config,
    save_config,
    validate_unique_account_uids,
)
from ..core.logs import append_log, configure_logger, format_line, tail_log
from .exchange_scheduler import ExchangeScheduler
from .runner import run_tasks
from .scheduler import DailyScheduler
from .web_diff import (
    diff_config,
    display_account_name,
    format_config_value,
    mask_sensitive_value,
    merge_account_credentials,
    redact_config_value,
    should_log_config_change,
)
from .web_login import WebLoginMixin
from .web_server import AUTH_COOKIE, WEB_ROOT, Handler, create_server, first_query, serve
from .web_shop import WebShopMixin

__all__ = [
    "AUTH_COOKIE",
    "Handler",
    "WEB_ROOT",
    "WebApp",
    "create_server",
    "diff_config",
    "display_account_name",
    "first_query",
    "format_config_value",
    "mask_sensitive_value",
    "merge_account_credentials",
    "redact_config_value",
    "serve",
    "should_log_config_change",
]


class WebApp(WebLoginMixin, WebShopMixin):
    """Web 控制台核心协调器，聚合配置、调度、记录、登录与兑换能力。"""

    def __init__(self, config_path: pathlib.Path, host: str = "127.0.0.1", port: int = 5890) -> None:
        self.config_path = config_path
        self.config = load_config(config_path)
        self.host = host
        self.port = port
        self.log_file = log_path(config_path, self.config)
        configure_logger(self.log_file)
        self.records_repo = get_record_repository(config_path, self.config)
        self.lock = threading.RLock()
        self.logs: list[str] = tail_log(self.log_file, lines=150)
        self.login_state: dict[str, Any] = {"running": False, "status": "idle"}
        self._qr_refresh = threading.Event()
        self._login_cancel = threading.Event()
        self._login_generation = 0
        self.scheduler = DailyScheduler(
            self.config,
            self.run_all,
            lambda message: self.log(message, "scheduler"),
            get_records_fn=lambda: self.records_repo.load(),
        )
        self.exchange_scheduler = ExchangeScheduler(
            self.config,
            self.run_shop_exchange_plan,
            lambda message: self.log(message, "exchange"),
        )

    @property
    def need_auth(self) -> bool:
        return False

    @property
    def password_is_set(self) -> bool:
        return False

    def auth_setup(self, password: str) -> str:
        return ""

    def auth_login(self, password: str) -> str:
        return ""

    def auth_status(self) -> dict[str, Any]:
        return {
            "need_auth": False,
            "password_set": False,
        }

    def start(self) -> None:
        now_dt = datetime.now().astimezone()
        tz_str = now_dt.strftime("%Z (UTC%z)")
        self.log(f"系统服务启动: 当前系统时间 {now_dt.strftime('%Y-%m-%d %H:%M:%S')}，时区 {tz_str}", "system")
        self.scheduler.start()
        self.exchange_scheduler.start()

    def stop(self) -> None:
        self.scheduler.stop()
        self.exchange_scheduler.stop()

    def log(self, message: str, component: str = "web") -> None:
        line = format_line(message, component)
        with self.lock:
            self.logs.append(line)
            self.logs = self.logs[-500:]
            log_file = self.log_file
        append_log(log_file, line, component=component)

    def run_all(self, trigger: str = "scheduled") -> list[str]:
        try:
            fresh_config = load_config(self.config_path)
            with self.lock:
                self.config = fresh_config
                self.records_repo = get_record_repository(self.config_path, self.config)
        except Exception as exc:
            self.log(f"读取最新配置文件异常: {exc}，使用当前内存配置继续", "task")
        with self.lock:
            config = self.config
        self.log("任务编排开始", "task")
        lines = run_tasks(
            config,
            str(self.config_path),
            emit_component=lambda message, component: self.log(message, component),
            trigger=trigger,
        )
        self.log("任务编排完成", "task")
        return []

    def get_records(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.lock:
            return self.records_repo.load(limit=limit)

    def clear_records(self) -> None:
        with self.lock:
            self.records_repo.clear()
        self.log("任务执行记录已清空", "system")

    def latest_record(self) -> dict[str, Any] | None:
        with self.lock:
            return self.records_repo.latest()

    def status(self) -> dict[str, Any]:
        with self.lock:
            logs = list(self.logs[-300:])
            login_state = dict(self.login_state)
            shop_exchange = copy.deepcopy(self.config.get("shop_exchange", {}))
            latest_rec = self.records_repo.latest()
        return {
            "scheduler": self.scheduler.status(),
            "exchange_scheduler": self.exchange_scheduler.status(),
            "shop_exchange": shop_exchange,
            "login": login_state,
            "latest_record": latest_rec,
            "logs": logs,
        }

    def get_config(self) -> dict[str, Any]:
        with self.lock:
            return json.loads(json.dumps(self.config, ensure_ascii=False))

    def set_config(self, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("配置必须是 JSON 对象")
        normalize_config(payload)
        validate_unique_account_uids(payload)
        with self.lock:
            old_config = copy.deepcopy(self.config)
            # 防御性保护：账号敏感凭据合并继承，防止非敏感页面更新配置时丢失 credentials
            old_accounts = old_config.get("accounts") or []
            new_accounts = payload.get("accounts") or []
            if old_accounts and new_accounts:
                merge_account_credentials(new_accounts, old_accounts)
            elif old_accounts and not new_accounts and "accounts" not in payload:
                payload["accounts"] = copy.deepcopy(old_accounts)

            # 防御性保护：兑换计划保护，防止其他页面自动保存时因未提供 plans 导致计划被置空
            old_plans = old_config.get("shop_exchange", {}).get("plans") or []
            new_plans = payload.get("shop_exchange", {}).get("plans") or []
            if old_plans and not new_plans and "plans" not in payload.get("shop_exchange", {}):
                payload.setdefault("shop_exchange", {})["plans"] = copy.deepcopy(old_plans)

            normalize_config(payload)
            bind_shop_plan_accounts(payload)
            changes = diff_config(old_config, payload)
            self.config = payload
            save_config(self.config_path, self.config)
            self.log_file = log_path(self.config_path, self.config)
            configure_logger(self.log_file)
            self.records_repo = get_record_repository(self.config_path, self.config)
            self.scheduler.reload(self.config)
            self.exchange_scheduler.reload(self.config)
        visible_changes = [change for change in changes if should_log_config_change(*change)]
        if visible_changes:
            self.log(f"配置已保存，共 {len(visible_changes)} 项变更", "config")
            for path, old_value, new_value in visible_changes[:50]:
                self.log(
                    f"配置项变更 {path}: {format_config_value(path, old_value)} -> {format_config_value(path, new_value)}",
                    "config",
                )
            if len(visible_changes) > 50:
                self.log(f"配置项变更过多，已省略 {len(visible_changes) - 50} 项", "config")
        else:
            self.log("配置已保存，未检测到配置项变化", "config")
