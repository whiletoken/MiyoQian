# -*- coding: utf-8 -*-
"""每日调度器与日志健壮性测试。"""

from __future__ import annotations

import pathlib
import tempfile
import threading
import time
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

from miyouqian.core.logs import configure_logger, tail_log
from miyouqian.service.scheduler import DailyScheduler, parse_time
from miyouqian.service.web import WebApp


class DailySchedulerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.config = {
            "schedule": {
                "enable": True,
                "time": "09:00",
                "jitter_minutes": 0,
                "run_on_start": False,
            }
        }
        self.logs: list[str] = []

    def log(self, message: str) -> None:
        self.logs.append(message)

    def test_parse_time(self) -> None:
        self.assertEqual(parse_time("09:30"), (9, 30))
        self.assertEqual(parse_time("00:00"), (0, 0))
        self.assertEqual(parse_time("23:59"), (23, 59))
        with self.assertRaises(ValueError):
            parse_time("24:00")
        with self.assertRaises(ValueError):
            parse_time("invalid")

    def test_status_fields(self) -> None:
        scheduler = DailyScheduler(self.config, lambda: ["done"], self.log)
        status = scheduler.status()
        self.assertTrue(status["enabled"])
        self.assertFalse(status["running"])
        self.assertFalse(status["thread_alive"])
        self.assertFalse(status["jitter_waiting"])
        self.assertEqual(status["jitter_until"], "")

        scheduler.start()
        try:
            status_running = scheduler.status()
            self.assertTrue(status_running["thread_alive"])
        finally:
            scheduler.stop()

    def test_run_once_captures_traceback(self) -> None:
        def failing_run():
            raise RuntimeError("模拟底层请求崩溃")

        scheduler = DailyScheduler(self.config, failing_run, self.log)
        scheduler._run_once()

        self.assertIn("RuntimeError: 模拟底层请求崩溃", scheduler._last_error)
        self.assertTrue(any("Traceback (most recent call last)" in line for line in self.logs))
        self.assertTrue(any("签到任务失败: 模拟底层请求崩溃" in line for line in self.logs))

    def test_wait_jitter_wakes_on_reload(self) -> None:
        scheduler = DailyScheduler(
            {"schedule": {"enable": True, "time": "09:00", "jitter_minutes": 60}},
            lambda: ["ok"],
            self.log,
        )

        jitter_thread = threading.Thread(
            target=lambda: scheduler._wait_jitter(
                {"jitter_minutes": 60},
                due_run=datetime.now(),
            )
        )
        jitter_thread.daemon = True
        jitter_thread.start()

        # 等待线程进入等待状态
        time.sleep(0.1)
        self.assertTrue(scheduler._jitter_waiting)
        self.assertIsNotNone(scheduler._jitter_until)

        # 模拟外部调用 reload 修改配置
        scheduler.reload({"schedule": {"enable": True, "time": "10:00", "jitter_minutes": 10}})
        jitter_thread.join(timeout=2.0)
        self.assertFalse(jitter_thread.is_alive())
        self.assertFalse(scheduler._jitter_waiting)
        self.assertTrue(any("取消当前随机延后等待" in line for line in self.logs))

    def test_loop_crash_resilience(self) -> None:
        scheduler = DailyScheduler(self.config, lambda: ["ok"], self.log)
        call_count = [0]

        original_compute = scheduler._compute_next_base_run

        def flawed_compute(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise ValueError("模拟主循环异常")
            return original_compute(*args, **kwargs)

        scheduler._compute_next_base_run = flawed_compute
        scheduler.start()
        try:
            time.sleep(0.3)
            # 线程不应该因为一次异常退出，自愈后继续保活
            self.assertTrue(scheduler.status()["thread_alive"])
            self.assertTrue(any("调度器主循环异常" in line for line in self.logs))
        finally:
            scheduler.stop()


class WebAppLogAndConfigReloadTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = pathlib.Path(self.temp_dir.name) / "config.yaml"
        self.log_file = pathlib.Path(self.temp_dir.name) / "logs" / "test.log"
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

        self.initial_config = {
            "enable": True,
            "accounts": [{"stuid": "1001", "name": "acc1", "cookie": "c1"}],
            "storage": {
                "data_dir": "data",
                "account_file": "account.json",
                "credentials_file": "credentials.yaml",
                "log_dir": "logs",
                "log_file": "test.log",
            },
            "features": {"game_checkin": False, "cloud_game_checkin": False, "bbs_tasks": False},
        }
        from miyouqian.core.config import save_config
        save_config(self.config_path, self.initial_config)

    def tearDown(self) -> None:
        from loguru import logger
        logger.remove()
        self.temp_dir.cleanup()

    def test_webapp_startup_tails_history_logs(self) -> None:
        # 先写入若干条历史日志
        self.log_file.write_text(
            "2026-10-21 09:00:00  [task]  历史执行 1\n"
            "2026-10-21 09:00:01  [task]  历史执行 2\n",
            encoding="utf-8",
        )

        app = WebApp(self.config_path)
        self.assertEqual(len(app.logs), 2)
        self.assertIn("历史执行 1", app.logs[0])
        self.assertIn("历史执行 2", app.logs[1])

    def test_webapp_run_all_reloads_fresh_config_and_accounts(self) -> None:
        from miyouqian.core.config import save_config

        app = WebApp(self.config_path)
        self.assertEqual(len(app.config.get("accounts", [])), 1)

        # 外部在磁盘上增加了第二个账号并保存
        updated_config = dict(self.initial_config)
        updated_config["accounts"] = [
            {"stuid": "1001", "name": "acc1", "cookie": "c1"},
            {"stuid": "1002", "name": "acc2", "cookie": "c2"},
        ]
        save_config(self.config_path, updated_config)

        # 调用 app.run_all 时，应自动重载磁盘上的最新 2 个账号
        captured_accounts = []

        def mock_run_tasks(cfg, *args, **kwargs):
            captured_accounts.extend(cfg.get("accounts", []))
            return []

        with patch("miyouqian.service.web.run_tasks", side_effect=mock_run_tasks):
            app.run_all()

        self.assertEqual(len(captured_accounts), 2)
        self.assertEqual(len(app.config.get("accounts", [])), 2)
        self.assertEqual(app.config["accounts"][1]["stuid"], "1002")


if __name__ == "__main__":
    unittest.main()
