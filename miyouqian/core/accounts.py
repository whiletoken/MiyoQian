# -*- coding: utf-8 -*-
"""用户账户数据管理与持久化仓储（Repository 模式）。"""

from __future__ import annotations

import copy
import json
import os
import pathlib
from dataclasses import dataclass, field
from typing import Any

from loguru import logger
import yaml

SENSITIVE_ACCOUNT_FIELDS = ("cookie", "stuid", "stoken", "mid")
SUPPORTED_CLOUD_GAME_KEYS = ("genshin", "zzz")


class AccountError(Exception):
    """账号相关基础异常。"""


class AccountDuplicateError(AccountError, ValueError):
    """账号重复异常。"""


class AccountNotFoundError(AccountError, ValueError):
    """账号不存在异常。"""


@dataclass
class CloudGameTokens:
    """云游戏 Token 凭据。"""
    genshin: str = ""
    zzz: str = ""

    @classmethod
    def from_dict(cls, data: Any) -> CloudGameTokens:
        if not isinstance(data, dict):
            return cls()
        tokens = data.get("tokens", {}) if "tokens" in data else data
        if not isinstance(tokens, dict):
            tokens = {}
        return cls(
            genshin=str(tokens.get("genshin") or "").strip(),
            zzz=str(tokens.get("zzz") or "").strip(),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tokens": {
                "genshin": self.genshin,
                "zzz": self.zzz,
            }
        }


@dataclass
class Account:
    """用户账号领域模型。"""
    name: str = ""
    stuid: str = ""
    stoken: str = ""
    mid: str = ""
    cookie: str = ""
    cloud_games: CloudGameTokens = field(default_factory=CloudGameTokens)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Account:
        name = str(data.get("name") or "")[:10]
        stuid = str(data.get("stuid") or "").strip()
        stoken = str(data.get("stoken") or "")
        mid = str(data.get("mid") or "")
        cookie = str(data.get("cookie") or "")
        cloud_games = CloudGameTokens.from_dict(data.get("cloud_games"))
        return cls(
            name=name,
            stuid=stuid,
            stoken=stoken,
            mid=mid,
            cookie=cookie,
            cloud_games=cloud_games,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "stuid": self.stuid,
            "stoken": self.stoken,
            "mid": self.mid,
            "cookie": self.cookie,
            "cloud_games": self.cloud_games.to_dict(),
        }

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "stuid": self.stuid,
        }


def normalize_account(account: dict[str, Any]) -> dict[str, Any]:
    """规范化账号字典结构。"""
    acc = copy.deepcopy(account)
    acc["name"] = str(acc.get("name") or "")[:10]
    for field_name in SENSITIVE_ACCOUNT_FIELDS:
        acc[field_name] = str(acc.get(field_name) or "")
    cloud_games = acc.get("cloud_games")
    if not isinstance(cloud_games, dict):
        cloud_games = {}
    tokens = cloud_games.get("tokens")
    if not isinstance(tokens, dict):
        tokens = {}
    acc["cloud_games"] = {
        "tokens": {
            key: str(tokens.get(key) or "")
            for key in SUPPORTED_CLOUD_GAME_KEYS
        }
    }
    return acc


def validate_unique_account_uids(target: dict[str, Any] | list[dict[str, Any]]) -> None:
    """检查账号列表中 UID 是否重复。"""
    accounts = target.get("accounts", []) if isinstance(target, dict) else target
    seen: dict[str, int] = {}
    for index, account in enumerate(accounts, start=1):
        if not isinstance(account, dict):
            continue
        uid = str(account.get("stuid") or "").strip()
        if not uid:
            continue
        if uid in seen:
            raise AccountDuplicateError(f"UID {uid} 已存在于账号 {seen[uid]}，不能重复添加同一账号")
        seen[uid] = index


class AccountRepository:
    """账号仓储：负责 account.json 的加载、保存、原子写入与自动迁移。"""

    def __init__(self, account_path: pathlib.Path | str) -> None:
        self.account_path = pathlib.Path(account_path)

    def load(
        self,
        legacy_config: dict[str, Any] | None = None,
        legacy_creds_path: pathlib.Path | None = None,
    ) -> list[dict[str, Any]]:
        """从 account.json 加载账号列表，如文件不存在或为空则尝试从已有旧凭据中自动迁移。"""
        if self.account_path.exists():
            accounts = self._read_json(self.account_path)
            if accounts:
                if legacy_config and legacy_config.get("accounts"):
                    accounts = self._align_accounts(legacy_config.get("accounts", []), accounts)
                return accounts

        # 触发自动迁移
        migrated = self.migrate_if_needed(legacy_config=legacy_config, legacy_creds_path=legacy_creds_path)
        if migrated:
            return migrated

        return []

    def save(self, accounts: list[dict[str, Any]]) -> None:
        """规范化并原子写入账号数据至 account.json。"""
        normalized_accounts = [
            normalize_account(acc)
            for acc in accounts
            if isinstance(acc, dict)
        ]
        validate_unique_account_uids(normalized_accounts)
        self._atomic_write_json(self.account_path, normalized_accounts)

    def migrate_if_needed(
        self,
        legacy_config: dict[str, Any] | None = None,
        legacy_creds_path: pathlib.Path | None = None,
    ) -> list[dict[str, Any]]:
        """检测并自动迁移旧版本 credentials.yaml 或 config.yaml 中的账号凭据。"""
        accounts: list[dict[str, Any]] = []

        # 1. 从旧 credentials.yaml 读取
        if legacy_creds_path and legacy_creds_path.exists():
            try:
                with legacy_creds_path.open("r", encoding="utf-8") as file:
                    loaded = yaml.safe_load(file) or {}
                if isinstance(loaded, dict) and isinstance(loaded.get("accounts"), list):
                    accounts = [
                        normalize_account(acc)
                        for acc in loaded["accounts"]
                        if isinstance(acc, dict)
                    ]
            except Exception as exc:
                logger.warning(f"读取旧凭据文件 {legacy_creds_path} 异常: {exc}")

        # 2. 与 config.yaml 的 accounts 合并（补齐名称或提取仅存写在 config.yaml 里的账号）
        if legacy_config and isinstance(legacy_config.get("accounts"), list):
            cfg_accounts = legacy_config.get("accounts", [])
            if not accounts and cfg_accounts:
                accounts = [
                    normalize_account(acc)
                    for acc in cfg_accounts
                    if isinstance(acc, dict)
                ]
            elif accounts and cfg_accounts:
                accounts = self._align_accounts(cfg_accounts, accounts)

        # 3. 若提取到了已有账号，自动迁移写入 account.json
        if accounts:
            logger.info(
                f"[自动迁移] 检测到已有账号凭据（共 {len(accounts)} 个），自动迁移至 {self.account_path.resolve()}"
            )
            self.save(accounts)

        return accounts

    def _read_json(self, path: pathlib.Path) -> list[dict[str, Any]]:
        """读取并解析 JSON 账号文件，兼容数组格式与包含 accounts 键的对象格式。"""
        try:
            with path.open("r", encoding="utf-8") as file:
                data = json.load(file)
            raw_list: list[Any] = []
            if isinstance(data, list):
                raw_list = data
            elif isinstance(data, dict):
                raw_list = data.get("accounts") if isinstance(data.get("accounts"), list) else []
            return [normalize_account(item) for item in raw_list if isinstance(item, dict)]
        except Exception as exc:
            logger.warning(f"读取账号文件 {path} 异常: {exc}")
            return []

    @staticmethod
    def _atomic_write_json(path: pathlib.Path, data: Any) -> None:
        """利用同目录临时文件和原子替换保证数据写入安全性，防止断电或进程中断损坏文件。"""
        path = pathlib.Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_file = path.with_name(f"{path.name}.tmp.{os.getpid()}")
        try:
            with temp_file.open("w", encoding="utf-8", newline="\n") as file:
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())
            try:
                os.chmod(temp_file, 0o600)
            except OSError:
                pass
            temp_file.replace(path)
        except Exception:
            if temp_file.exists():
                try:
                    temp_file.unlink()
                except OSError:
                    pass
            raise

    @staticmethod
    def _align_accounts(
        reference_accounts: list[dict[str, Any]],
        source_accounts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """按照 reference_accounts 的顺序和设置，将 source_accounts 中的凭证合并。"""
        by_name = {str(acc.get("name")): acc for acc in source_accounts if acc.get("name")}
        by_stuid = {str(acc.get("stuid")): acc for acc in source_accounts if acc.get("stuid")}

        used_ids: set[int] = set()
        aligned: list[dict[str, Any]] = []

        for index, ref in enumerate(reference_accounts):
            if not isinstance(ref, dict):
                continue
            name = str(ref.get("name") or "")
            stuid = str(ref.get("stuid") or "")
            match = by_name.get(name) or by_stuid.get(stuid)
            if match is None and index < len(source_accounts):
                candidate = source_accounts[index]
                if id(candidate) not in used_ids:
                    match = candidate

            merged = copy.deepcopy(ref)
            if match:
                used_ids.add(id(match))
                for field_name in SENSITIVE_ACCOUNT_FIELDS:
                    if not merged.get(field_name):
                        merged[field_name] = str(match.get(field_name) or "")
                if not merged.get("cloud_games") or not (merged.get("cloud_games") or {}).get("tokens"):
                    merged["cloud_games"] = match.get("cloud_games", {})
            aligned.append(normalize_account(merged))

        for acc in source_accounts:
            if id(acc) not in used_ids:
                aligned.append(normalize_account(acc))

        return aligned
