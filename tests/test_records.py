# -*- coding: utf-8 -*-
"""任务执行记录持久化与 API 测试。"""

from __future__ import annotations

import pathlib
import tempfile
import time
import unittest
from unittest.mock import MagicMock, Mock, patch

from miyouqian.core.config import get_record_repository, records_path, save_config
from miyouqian.core.records import ExecutionRecord, RecordRepository
from miyouqian.service.runner import run_tasks
from miyouqian.service.web import WebApp


class RecordRepositoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.file_path = pathlib.Path(self.temp_dir.name) / "records.json"
        self.repo = RecordRepository(self.file_path, max_records=3)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_empty_when_file_not_exist(self) -> None:
        self.assertEqual(self.repo.load(), [])
        self.assertIsNone(self.repo.latest())

    def test_append_and_latest(self) -> None:
        rec1 = {"id": "1", "status": "success", "summary_text": "执行 1"}
        rec2 = {"id": "2", "status": "failed", "summary_text": "执行 2"}

        self.repo.append(rec1)
        self.assertEqual(len(self.repo.load()), 1)
        self.assertEqual(self.repo.latest()["id"], "1")

        self.repo.append(rec2)
        records = self.repo.load()
        self.assertEqual(len(records), 2)
        # 最新记录在最前
        self.assertEqual(records[0]["id"], "2")
        self.assertEqual(self.repo.latest()["id"], "2")

    def test_max_records_limit(self) -> None:
        for i in range(5):
            self.repo.append({"id": str(i), "status": "success"})
        records = self.repo.load()
        self.assertEqual(len(records), 3)
        # 应保留最新的 4, 3, 2
        self.assertEqual([r["id"] for r in records], ["4", "3", "2"])

    def test_clear_records(self) -> None:
        self.repo.append({"id": "1", "status": "success"})
        self.assertEqual(len(self.repo.load()), 1)
        self.repo.clear()
        self.assertEqual(self.repo.load(), [])


class RunnerRecordPersistenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = pathlib.Path(self.temp_dir.name) / "config.yaml"
        self.config = {
            "enable": True,
            "accounts": [{"name": "测试账号", "stuid": "1001", "cookie": "dummy"}],
            "storage": {
                "data_dir": "data",
                "account_file": "account.json",
                "records_file": "records.json",
                "log_dir": "logs",
                "log_file": "test.log",
            },
            "features": {"game_checkin": False, "cloud_game_checkin": False, "bbs_tasks": False},
        }
        save_config(self.config_path, self.config)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_run_tasks_persists_record_when_disabled(self) -> None:
        cfg = dict(self.config)
        cfg["enable"] = False
        out = run_tasks(cfg, str(self.config_path), trigger="scheduled")
        self.assertIn("配置 enable=false，已跳过。", out)

        repo = get_record_repository(self.config_path, cfg)
        latest = repo.latest()
        self.assertIsNotNone(latest)
        self.assertEqual(latest["status"], "skipped")
        self.assertEqual(latest["trigger"], "scheduled")

    def test_run_tasks_persists_record_normal_execution(self) -> None:
        out = run_tasks(self.config, str(self.config_path), trigger="cli")
        repo = get_record_repository(self.config_path, self.config)
        latest = repo.latest()
        self.assertIsNotNone(latest)
        self.assertEqual(latest["trigger"], "cli")
        self.assertEqual(latest["total_accounts"], 1)
        self.assertEqual(latest["accounts"][0]["name"], "测试账号")


class WebAppRecordsApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = pathlib.Path(self.temp_dir.name) / "config.yaml"
        self.config = {
            "enable": True,
            "accounts": [],
            "storage": {
                "data_dir": "data",
                "account_file": "account.json",
                "records_file": "records.json",
                "log_dir": "logs",
                "log_file": "test.log",
            },
            "features": {"game_checkin": False, "cloud_game_checkin": False, "bbs_tasks": False},
        }
        save_config(self.config_path, self.config)
        self.app = WebApp(self.config_path)

    def tearDown(self) -> None:
        from loguru import logger
        logger.remove()
        self.temp_dir.cleanup()

    def test_get_and_clear_records(self) -> None:
        self.assertEqual(self.app.get_records(), [])
        self.assertIsNone(self.app.latest_record())

        self.app.records_repo.append({"id": "rec-1", "status": "success", "summary_text": "成功"})
        self.assertEqual(len(self.app.get_records()), 1)
        self.assertEqual(self.app.latest_record()["id"], "rec-1")

        status = self.app.status()
        self.assertIn("latest_record", status)
        self.assertEqual(status["latest_record"]["id"], "rec-1")

        self.app.clear_records()
        self.assertEqual(self.app.get_records(), [])
        self.assertIsNone(self.app.latest_record())


class ExchangeRecordPersistenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = pathlib.Path(self.temp_dir.name) / "config.json"
        self.config = {
            "enable": True,
            "accounts": [{"name": "兑换账号", "stuid": "2001", "cookie": "dummy_cookie"}],
            "storage": {
                "data_dir": "data",
                "account_file": "account.json",
                "records_file": "records.json",
                "log_dir": "logs",
                "log_file": "test.log",
            },
            "shop_exchange": {
                "enable": True,
                "plans": [
                    {
                        "goods_id": "12345",
                        "goods_name": "原石",
                        "account_index": 0,
                        "account_stuid": "2001",
                        "exchange_at": int(time.time()) + 100,
                        "device_fp": "dummy_fp",
                        "enable": True,
                    }
                ],
            },
        }
        save_config(self.config_path, self.config)
        self.app = WebApp(self.config_path)

    def tearDown(self) -> None:
        from loguru import logger
        logger.remove()
        self.temp_dir.cleanup()

    @patch("miyouqian.service.web.ShopExchange")
    def test_exchange_plan_persists_record_and_explicit_status(self, mock_shop_cls) -> None:
        mock_instance = Mock()
        mock_instance.exchange_with_retry.return_value = {
            "ok": True,
            "retcode": 0,
            "message": "OK",
            "attempt": 1,
            "data": {},
        }
        mock_shop_cls.return_value = mock_instance

        res = self.app.shop_exchange_plan_once(0)
        self.assertTrue(res["ok"])

        # 验证记录仓储中有记录
        records = self.app.get_records()
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec["status"], "success")
        self.assertEqual(rec["trigger"], "exchange_manual")
        self.assertIn("【兑换成功】", rec["summary_text"])
        self.assertEqual(rec["accounts"][0]["name"], "兑换账号")
        self.assertEqual(rec["accounts"][0]["stages"][0]["stage"], "米游币商品兑换")
        self.assertEqual(rec["accounts"][0]["stages"][0]["success_items"], ["原石"])

        # 验证 plan 中的 last_result 包含明确成功标记且成功后禁用
        plan = self.app.config["shop_exchange"]["plans"][0]
        self.assertIn("【兑换成功】", plan["last_result"])
        self.assertFalse(plan["enable"])

    @patch("miyouqian.service.web.ShopExchange")
    def test_exchange_plan_failure_persists_record_and_explicit_status(self, mock_shop_cls) -> None:
        mock_instance = Mock()
        mock_instance.exchange_with_retry.return_value = {
            "ok": False,
            "retcode": -100,
            "message": "商品已售罄",
            "attempt": 3,
            "data": {},
        }
        mock_shop_cls.return_value = mock_instance

        res = self.app.shop_exchange_plan_once(0)
        self.assertFalse(res["ok"])

        records = self.app.get_records()
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec["status"], "failed")
        self.assertIn("【兑换失败】", rec["summary_text"])
        self.assertEqual(rec["accounts"][0]["stages"][0]["failed_items"], ["原石"])

        plan = self.app.config["shop_exchange"]["plans"][0]
        self.assertIn("【兑换失败】", plan["last_result"])
        self.assertTrue(plan["enable"])  # 失败不自动禁用


if __name__ == "__main__":
    unittest.main()
