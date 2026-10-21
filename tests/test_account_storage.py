# -*- coding: utf-8 -*-
"""用户账户数据存储、Docker 映射与自动迁移测试。"""

import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

import yaml

from miyouqian.core.accounts import (
    Account,
    AccountDuplicateError,
    AccountRepository,
    normalize_account,
    validate_unique_account_uids,
)
from miyouqian.core.captcha import (
    CaptchaSolverFactory,
    CustomCaptchaSolver,
    DamagouCaptchaSolver,
    TestNineCaptchaSolver,
    solve_bbs_captcha,
    solve_game_captcha,
)
from miyouqian.core.config import (
    account_path,
    load_config,
    save_config,
    upsert_account,
)
from miyouqian.tasks.base import BaseTask, TaskSummary


class AccountStorageAndMigrationTest(unittest.TestCase):
    def test_save_and_load_account_json(self):
        """测试正常保存和加载 account.json。"""
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            cfg_file = tmp_path / "config.yaml"
            acc_file = tmp_path / "account.json"

            config = {
                "accounts": [
                    {
                        "name": "测试账号1",
                        "stuid": "10001",
                        "stoken": "token1",
                        "mid": "mid1",
                        "cookie": "cookie1",
                        "cloud_games": {"tokens": {"genshin": "cloud_token_1", "zzz": ""}},
                    }
                ]
            }
            save_config(cfg_file, config)

            # 验证 account.json 是否成功生成
            self.assertTrue(acc_file.exists())
            with acc_file.open("r", encoding="utf-8") as f:
                saved_accounts = json.load(f)
            self.assertEqual(len(saved_accounts), 1)
            self.assertEqual(saved_accounts[0]["name"], "测试账号1")
            self.assertEqual(saved_accounts[0]["stuid"], "10001")
            self.assertEqual(saved_accounts[0]["cloud_games"]["tokens"]["genshin"], "cloud_token_1")

            # 验证 config.yaml 中的 accounts 已脱敏
            with cfg_file.open("r", encoding="utf-8") as f:
                public_cfg = yaml.safe_load(f)
            self.assertNotIn("stoken", public_cfg["accounts"][0])
            self.assertNotIn("cloud_games", public_cfg["accounts"][0])

            # 重新 load_config，确认凭据被完整加载
            reloaded = load_config(cfg_file)
            self.assertEqual(len(reloaded["accounts"]), 1)
            self.assertEqual(reloaded["accounts"][0]["stoken"], "token1")
            self.assertEqual(reloaded["accounts"][0]["cloud_games"]["tokens"]["genshin"], "cloud_token_1")

    def test_auto_migration_from_credentials_yaml(self):
        """测试当 account.json 不存在时，自动从 credentials.yaml 迁移数据。"""
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            cfg_file = tmp_path / "config.yaml"
            acc_file = tmp_path / "account.json"
            data_dir = tmp_path / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            creds_file = data_dir / "credentials.yaml"

            # 模拟旧版 credentials.yaml
            creds_data = {
                "accounts": [
                    {
                        "name": "旧账号A",
                        "stuid": "20001",
                        "stoken": "stokenA",
                        "mid": "midA",
                        "cookie": "cookieA",
                        "cloud_games": {"tokens": {"genshin": "gA", "zzz": "zA"}},
                    }
                ]
            }
            with creds_file.open("w", encoding="utf-8") as f:
                yaml.safe_dump(creds_data, f)

            # 模拟旧版 config.yaml
            cfg_data = {
                "storage": {"data_dir": "data", "credentials_file": "credentials.yaml"},
                "accounts": [{"name": "旧账号A"}],
            }
            with cfg_file.open("w", encoding="utf-8") as f:
                yaml.safe_dump(cfg_data, f)

            # 验证迁移前 account.json 不存在
            self.assertFalse(acc_file.exists())

            # 执行 load_config 触发自动迁移
            loaded = load_config(cfg_file)

            # 验证自动生成了 account.json 并写入了迁移后的账号
            self.assertTrue(acc_file.exists())
            self.assertEqual(len(loaded["accounts"]), 1)
            acc = loaded["accounts"][0]
            self.assertEqual(acc["name"], "旧账号A")
            self.assertEqual(acc["stuid"], "20001")
            self.assertEqual(acc["stoken"], "stokenA")
            self.assertEqual(acc["cloud_games"]["tokens"]["zzz"], "zA")

    def test_auto_migration_from_config_yaml_accounts(self):
        """测试当 credentials.yaml 不存在但 config.yaml 直接包含账号凭据时自动迁移。"""
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            cfg_file = tmp_path / "config.yaml"
            acc_file = tmp_path / "account.json"

            cfg_data = {
                "accounts": [
                    {
                        "name": "嵌入账号",
                        "stuid": "30001",
                        "stoken": "stoken_embedded",
                        "cookie": "cookie_embedded",
                    }
                ]
            }
            with cfg_file.open("w", encoding="utf-8") as f:
                yaml.safe_dump(cfg_data, f)

            loaded = load_config(cfg_file)
            self.assertTrue(acc_file.exists())
            self.assertEqual(len(loaded["accounts"]), 1)
            self.assertEqual(loaded["accounts"][0]["stuid"], "30001")
            self.assertEqual(loaded["accounts"][0]["stoken"], "stoken_embedded")

    def test_docker_custom_account_path_env(self):
        """测试 Docker 环境变量映射 MIYOUQIAN_ACCOUNT_PATH。"""
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            custom_acc = tmp_path / "custom" / "my_accounts.json"
            cfg_file = tmp_path / "config.yaml"

            custom_data = [
                {
                    "name": "Docker挂载账号",
                    "stuid": "40001",
                    "cookie": "docker_cookie",
                }
            ]
            custom_acc.parent.mkdir(parents=True, exist_ok=True)
            with custom_acc.open("w", encoding="utf-8") as f:
                json.dump(custom_data, f)

            with patch.dict(os.environ, {"MIYOUQIAN_ACCOUNT_PATH": str(custom_acc)}):
                resolved = account_path(cfg_file, {})
                self.assertEqual(resolved, custom_acc)

                loaded = load_config(cfg_file)
                self.assertEqual(len(loaded["accounts"]), 1)
                self.assertEqual(loaded["accounts"][0]["name"], "Docker挂载账号")

    def test_duplicate_uid_rejection(self):
        """测试同一 UID 重复添加时抛出异常。"""
        accounts = [
            {"name": "账号1", "stuid": "12345"},
            {"name": "账号2", "stuid": "12345"},
        ]
        with self.assertRaises(AccountDuplicateError):
            validate_unique_account_uids(accounts)

    def test_account_model_conversion(self):
        """测试 Account 数据模型转换方法。"""
        raw = {
            "name": "超长名字测试1234567890EXTRA",
            "stuid": "9999",
            "cookie": "c",
            "cloud_games": {"tokens": {"genshin": "token_g"}},
        }
        acc = Account.from_dict(raw)
        self.assertEqual(acc.name, "超长名字测试1234")  # 截取前 10 位
        self.assertEqual(acc.stuid, "9999")
        self.assertEqual(acc.cloud_games.genshin, "token_g")

        as_dict = acc.to_dict()
        self.assertEqual(as_dict["cloud_games"]["tokens"]["genshin"], "token_g")
        self.assertIn("tokens", as_dict["cloud_games"])


class CaptchaStrategyPatternTest(unittest.TestCase):
    def test_factory_creates_test_nine_damagou_and_custom(self):
        test_nine_solver = CaptchaSolverFactory.create({"provider": "test_nine"})
        self.assertIsInstance(test_nine_solver, TestNineCaptchaSolver)

        damagou_solver = CaptchaSolverFactory.create({"provider": "damagou"})
        self.assertIsInstance(damagou_solver, DamagouCaptchaSolver)

        custom_solver = CaptchaSolverFactory.create({"provider": "custom"})
        self.assertIsInstance(custom_solver, CustomCaptchaSolver)

        unknown_solver = CaptchaSolverFactory.create({"provider": "unknown"})
        self.assertIsNone(unknown_solver)

    def test_test_nine_solver_success_and_failure(self):
        client = Mock()
        solver = TestNineCaptchaSolver({"provider": "test_nine", "url": "http://127.0.0.1:9645/pass_uni"})
        
        # 成功用例
        client.get_json.return_value = {
            "data": {
                "result": "success",
                "validate": "test_validate_123",
                "challenge": "challenge_abc"
            }
        }
        res = solver.solve(client, "gt_1", "challenge_abc")
        self.assertIsNotNone(res)
        self.assertEqual(res.validate, "test_validate_123")
        self.assertEqual(res.challenge, "challenge_abc")

        # 失败用例
        client.get_json.return_value = {
            "data": {
                "result": "failed",
                "msg": "识别超时"
            }
        }
        messages = []
        fail_res = solver.solve(client, "gt_1", "challenge_abc", emit=messages.append)
        self.assertIsNone(fail_res)
        self.assertIn("识别超时", messages[0])


class TaskTemplateMethodTest(unittest.TestCase):
    def test_task_summary_merge(self):
        summary = TaskSummary(messages=["m1"], success=["s1"], failed=[], skipped=[])
        summary.merge(TaskSummary(messages=["m2"], success=[], failed=["f1"], skipped=["sk1"]))
        self.assertEqual(summary.messages, ["m1", "m2"])
        self.assertEqual(summary.success, ["s1"])
        self.assertEqual(summary.failed, ["f1"])
        self.assertEqual(summary.skipped, ["sk1"])


if __name__ == "__main__":
    unittest.main()
