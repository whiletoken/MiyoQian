# -*- coding: utf-8 -*-
"""配置加载与保存。"""

from __future__ import annotations

import copy
import json
import os
import pathlib
import random
from typing import Any

from loguru import logger
import yaml

from . import crypto
from .accounts import (
    AccountRepository,
    SENSITIVE_ACCOUNT_FIELDS,
    SUPPORTED_CLOUD_GAME_KEYS,
    normalize_account,
    validate_unique_account_uids as validate_uids_impl,
)

DEFAULT_DEVICE_PRESETS: list[dict[str, str]] = [
    {"name": "Xiaomi 14", "model": "23127PN0CC"},
    {"name": "Xiaomi 13", "model": "2211133C"},
    {"name": "Redmi K70", "model": "2311DRK48C"},
    {"name": "Redmi K60", "model": "23013RK75C"},
    {"name": "OnePlus 12", "model": "PJD110"},
    {"name": "OPPO Find X7", "model": "PHZ110"},
    {"name": "vivo X100", "model": "V2309A"},
    {"name": "HONOR 100", "model": "MAA-AN00"},
    {"name": "HUAWEI Mate 60", "model": "BRA-AL00"},
    {"name": "Samsung Galaxy S23", "model": "SM-S9110"},
]

DEFAULT_CONFIG: dict[str, Any] = {
    "enable": True,
    "accounts": [],
    "storage": {
        "data_dir": "data",
        "account_file": "account.json",
        "records_file": "records.json",
        "credentials_file": "credentials.yaml",
        "log_dir": "logs",
        "log_file": "miyouqian.log",
    },
    "device": {"id": "", "fp": "", "name": "", "model": "", "presets": DEFAULT_DEVICE_PRESETS},
    "features": {"game_checkin": True, "cloud_game_checkin": False, "bbs_tasks": False},
    "captcha": {
        "enable": False,
        "max_retries": 3,
        "channels": [
            {"provider": "test_nine", "enable": False, "url": "http://127.0.0.1:9645/pass_uni", "timeout": 30},
            {"provider": "damagou", "enable": False, "userkey": "", "type": "", "timeout": 60},
            {"provider": "custom", "enable": False, "url": "", "api_key": "", "timeout": 120},
        ],
    },
    "schedule": {"enable": False, "time": "09:00", "jitter_minutes": 45, "run_on_start": False},
    "games": {
        "enabled": ["genshin", "starrail", "zzz"],
        "black_list": {"genshin": [], "starrail": [], "zzz": []},
    },
    "cloud_games": {
        "enabled": ["genshin", "zzz"],
    },
    "bbs": {
        "forums": [5, 2],
        "checkin": True,
        "read": False,
        "like": False,
        "share": False,
        "cancel_like": True,
        "post_limit": 5,
        "delay_seconds": [1, 3],
    },
    "shop_exchange": {
        "enable": True,
        "retry_seconds": 20,
        "retry_interval": 0.4,
        "plans": [],
    },
    "web": {
        "host": "127.0.0.1",
        "port": 5890,
    },
}


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


def load_config(path: str | pathlib.Path) -> dict[str, Any]:
    """加载配置并合并 account.json 账号数据（支持 config.json / config.yaml 平滑互通与自动迁移）。"""
    config_path = pathlib.Path(path)
    target_file = config_path

    # 优先使用现有文件，若不存在则智能寻找对应的 .json 或 .yaml
    if not target_file.exists():
        if target_file.suffix.lower() in {".yaml", ".yml"} and target_file.with_suffix(".json").exists():
            target_file = target_file.with_suffix(".json")
        elif target_file.suffix.lower() == ".json":
            for ext in (".yaml", ".yml"):
                if target_file.with_suffix(ext).exists():
                    target_file = target_file.with_suffix(ext)
                    break

    if not target_file.exists():
        config = copy.deepcopy(DEFAULT_CONFIG)
        normalize_config(config)
        repo = get_account_repository(config_path, config)
        accounts = repo.load(legacy_config=None, legacy_creds_path=credentials_path(config_path, config))
        if accounts:
            config["accounts"] = accounts
            normalize_config(config)
            bind_shop_plan_accounts(config)
        return config

    with target_file.open("r", encoding="utf-8") as file:
        content = file.read().strip()
    if not content:
        loaded = {}
    elif content.startswith("{") or target_file.suffix.lower() == ".json":
        try:
            loaded = json.loads(content)
        except json.JSONDecodeError:
            loaded = yaml.safe_load(content) or {}
    else:
        loaded = yaml.safe_load(content) or {}

    if not isinstance(loaded, dict):
        raise ValueError(f"配置文件格式错误: {target_file}")
    config = merge_dict(copy.deepcopy(DEFAULT_CONFIG), loaded)
    normalize_config(config)

    repo = get_account_repository(config_path, config)
    accounts = repo.load(legacy_config=config, legacy_creds_path=credentials_path(config_path, config))
    config["accounts"] = accounts
    normalize_config(config)
    bind_shop_plan_accounts(config)

    # 若原先读取的是 legacy .yaml 文件，且同名 .json 不存在，自动无损固化生成对应的 config.json
    json_candidate = target_file.with_suffix(".json")
    if target_file.suffix.lower() in {".yaml", ".yml"} and not json_candidate.exists():
        try:
            public_config = strip_credentials(config)
            _atomic_write_json(json_candidate, public_config)
            logger.info(f"[自动迁移] 成功将配置由 {target_file.name} 导出至 {json_candidate.name}")
        except Exception as exc:
            logger.warning(f"自动转录 JSON 配置异常: {exc}")

    return config


def save_config(path: str | pathlib.Path, config: dict[str, Any]) -> None:
    """保存配置：账号凭证写入 account.json，所有系统运行配置均保存至 config.json（保持原子安全写入）。"""
    normalize_config(config)
    config_path = pathlib.Path(path)
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # 1. 保存账号凭证到 account.json
    repo = get_account_repository(config_path, config)
    repo.save(config.get("accounts", []))

    # 2. 保存普通脱敏配置到 JSON 文件
    public_config = strip_credentials(config)
    json_path = config_path if config_path.suffix.lower() == ".json" else config_path.with_suffix(".json")
    _atomic_write_json(json_path, public_config)

    # 若原传入路径为 .yaml，同步刷新一份 .yaml 以实现平滑向后兼容
    if config_path.suffix.lower() in {".yaml", ".yml"}:
        try:
            temp_yaml = config_path.with_name(f"{config_path.name}.tmp.{os.getpid()}")
            with temp_yaml.open("w", encoding="utf-8", newline="\n") as file:
                yaml.safe_dump(public_config, file, allow_unicode=True, sort_keys=False)
                file.flush()
                os.fsync(file.fileno())
            temp_yaml.replace(config_path)
        except Exception:
            if temp_yaml.exists():
                try:
                    temp_yaml.unlink()
                except OSError:
                    pass
            raise


def create_config(path: str | pathlib.Path, force: bool = False) -> pathlib.Path:
    config_path = pathlib.Path(path)
    if config_path.exists() and not force:
        raise FileExistsError(f"配置已存在: {config_path}")
    config = copy.deepcopy(DEFAULT_CONFIG)
    save_config(config_path, config)
    return config_path


def merge_dict(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge_dict(base[key], value)
        else:
            base[key] = value
    return base


def normalize_config(config: dict[str, Any]) -> None:
    storage = config.setdefault("storage", {})
    storage.setdefault("data_dir", "data")
    storage.setdefault("account_file", "account.json")
    storage.setdefault("records_file", "records.json")
    storage.setdefault("credentials_file", "credentials.yaml")
    storage.setdefault("log_dir", "logs")
    storage.setdefault("log_file", "miyouqian.log")
    cloud_games = config.setdefault("cloud_games", {})
    if not isinstance(cloud_games, dict):
        cloud_games = {}
        config["cloud_games"] = cloud_games
    cloud_games["enabled"] = normalize_cloud_game_enabled(cloud_games.get("enabled", SUPPORTED_CLOUD_GAME_KEYS))
    accounts = config.setdefault("accounts", [])
    if isinstance(accounts, dict):
        config["accounts"] = [accounts]
    for index, account in enumerate(config["accounts"], start=1):
        account["name"] = str(account.get("name") or "")[:10]
        for field in SENSITIVE_ACCOUNT_FIELDS:
            account.setdefault(field, "")
    device = config.setdefault("device", {})
    first_cookie = str(config["accounts"][0].get("cookie", "")) if config["accounts"] else ""
    presets = device.setdefault("presets", copy.deepcopy(DEFAULT_DEVICE_PRESETS))
    if not isinstance(presets, list) or not presets:
        presets = copy.deepcopy(DEFAULT_DEVICE_PRESETS)
        device["presets"] = presets
    if not device.get("name") or not device.get("model"):
        preset = random.choice([item for item in presets if isinstance(item, dict)] or DEFAULT_DEVICE_PRESETS)
        device["name"] = str(preset.get("name") or DEFAULT_DEVICE_PRESETS[0]["name"])
        device["model"] = str(preset.get("model") or DEFAULT_DEVICE_PRESETS[0]["model"])
    if not device.get("id"):
        device["id"] = crypto.device_id(first_cookie or None)
    if not device.get("fp"):
        device["fp"] = crypto.device_fp()
    captcha = config.setdefault("captcha", {})
    captcha["channels"] = normalize_captcha_channels(captcha)
    captcha["enable"] = any(channel.get("enable") for channel in captcha["channels"])
    try:
        captcha["max_retries"] = max(int(captcha.get("max_retries") or 3), 1)
    except (TypeError, ValueError):
        captcha["max_retries"] = 3
    web = config.setdefault("web", {})
    web.setdefault("host", "127.0.0.1")
    web.setdefault("port", 5890)
    features = config.setdefault("features", {})
    features.setdefault("game_checkin", True)
    features.setdefault("cloud_game_checkin", False)
    features.setdefault("bbs_tasks", False)
    bbs = config.setdefault("bbs", {})
    if not isinstance(bbs, dict):
        bbs = {}
        config["bbs"] = bbs
    bbs["checkin"] = parse_bool(bbs.get("checkin", True))
    raw_forums = bbs.get("forums")
    if isinstance(raw_forums, list):
        forums: list[int] = []
        for item in raw_forums:
            try:
                forums.append(int(item))
            except (TypeError, ValueError):
                continue
    else:
        forums = list(DEFAULT_CONFIG["bbs"]["forums"])
    bbs["forums"] = forums
    bbs["read"] = False
    bbs["like"] = False
    bbs["share"] = False
    normalize_shop_exchange(config)


def normalize_shop_exchange(config: dict[str, Any]) -> None:
    shop = config.setdefault("shop_exchange", {})
    if not isinstance(shop, dict):
        shop = {}
        config["shop_exchange"] = shop
    shop["enable"] = parse_bool(shop.get("enable", True))
    try:
        shop["retry_seconds"] = max(float(shop.get("retry_seconds", 20)), 0)
    except (TypeError, ValueError):
        shop["retry_seconds"] = 20
    try:
        shop["retry_interval"] = max(float(shop.get("retry_interval", 0.4)), 0.05)
    except (TypeError, ValueError):
        shop["retry_interval"] = 0.4
    raw_plans = shop.get("plans")
    if not isinstance(raw_plans, list):
        raw_plans = []
    plans: list[dict[str, Any]] = []
    for raw in raw_plans:
        if not isinstance(raw, dict):
            continue
        try:
            account_index = max(int(raw.get("account_index", 0)), 0)
        except (TypeError, ValueError):
            account_index = 0
        try:
            exchange_at = int(float(raw.get("exchange_at") or 0))
        except (TypeError, ValueError):
            exchange_at = 0
        plan = {
            "enable": parse_bool(raw.get("enable", True)),
            "auto": parse_bool(raw.get("auto", True)),
            "account_index": account_index,
            "account_stuid": str(raw.get("account_stuid") or "").strip(),
            "goods_id": str(raw.get("goods_id") or "").strip(),
            "goods_name": str(raw.get("goods_name") or raw.get("name") or "").strip(),
            "icon": str(raw.get("icon") or ""),
            "price": parse_int(raw.get("price"), 0),
            "stock": str(raw.get("stock") or ""),
            "type": parse_int(raw.get("type"), 0),
            "exchange_at": exchange_at,
            "game": str(raw.get("game") or ""),
            "game_biz": str(raw.get("game_biz") or ""),
            "device_fp": str(raw.get("device_fp") or ""),
            "uid": str(raw.get("uid") or "").strip(),
            "region": str(raw.get("region") or "").strip(),
            "role_name": str(raw.get("role_name") or "").strip(),
            "region_name": str(raw.get("region_name") or "").strip(),
            "address_id": str(raw.get("address_id") or "").strip(),
            "last_result": str(raw.get("last_result") or ""),
            "last_attempt_key": str(raw.get("last_attempt_key") or ""),
            "last_run": str(raw.get("last_run") or ""),
        }
        if plan["goods_id"]:
            plans.append(plan)
    shop["plans"] = plans


def normalize_cloud_game_tokens(value: Any) -> dict[str, str]:
    tokens = value if isinstance(value, dict) else {}
    return {key: str(tokens.get(key) or "") for key in SUPPORTED_CLOUD_GAME_KEYS}


def normalize_cloud_game_enabled(value: Any) -> list[str]:
    if isinstance(value, str):
        raw_items = [value]
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = list(SUPPORTED_CLOUD_GAME_KEYS)
    enabled: list[str] = []
    for item in raw_items:
        key = str(item or "").strip()
        if key in SUPPORTED_CLOUD_GAME_KEYS and key not in enabled:
            enabled.append(key)
    return enabled


def default_captcha_channel(provider: str) -> dict[str, Any]:
    if provider == "test_nine":
        return {"provider": "test_nine", "enable": False, "url": "http://127.0.0.1:9645/pass_uni", "timeout": 30}
    if provider == "custom":
        return {"provider": "custom", "enable": False, "url": "", "api_key": "", "timeout": 120}
    return {"provider": "damagou", "enable": False, "userkey": "", "type": "", "timeout": 60}


def normalize_captcha_channels(captcha: dict[str, Any]) -> list[dict[str, Any]]:
    allowed = ("test_nine", "damagou", "custom")
    raw_channels = captcha.get("channels")
    if not isinstance(raw_channels, list):
        raw_channels = []
    if not raw_channels:
        raw_channels = [{"provider": "test_nine", "enable": False}]

    channels: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_channels:
        if not isinstance(raw, dict):
            continue
        provider = str(raw.get("provider") or "").strip() or "test_nine"
        if provider not in allowed or provider in seen:
            continue
        seen.add(provider)
        default_channel = default_captcha_channel(provider)
        default_timeout = default_channel["timeout"]
        try:
            timeout = max(float(raw.get("timeout") or default_timeout), 1)
            normalized_timeout: int | float = int(timeout) if timeout.is_integer() else timeout
        except (TypeError, ValueError):
            normalized_timeout = default_timeout
        channel: dict[str, Any] = {
            "provider": provider,
            "enable": parse_bool(raw.get("enable", False)),
        }
        if provider == "test_nine":
            channel["url"] = str(raw.get("url") or default_channel["url"]).strip()
        elif provider == "custom":
            channel["url"] = str(raw.get("url") or "").strip()
            channel["api_key"] = str(raw.get("api_key") or "").strip()
        else:
            channel["userkey"] = str(raw.get("userkey") or "")
            channel["type"] = str(raw.get("type") or "")
        channel["timeout"] = normalized_timeout
        channels.append(channel)
    for provider in allowed:
        if provider not in seen:
            channels.append(default_captcha_channel(provider))
    return channels


def parse_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in {"", "0", "false", "no", "off"}
    return bool(value)


def parse_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def validate_unique_account_uids(config_or_accounts: dict[str, Any] | list[dict[str, Any]]) -> None:
    """验证账号 UID 唯一性，兼容传入 config 字典或账号列表。"""
    validate_uids_impl(config_or_accounts)


def find_account_index_by_stuid(accounts: list[dict[str, Any]], stuid: str) -> int | None:
    stuid = str(stuid or "").strip()
    if not stuid:
        return None
    for index, account in enumerate(accounts):
        if str(account.get("stuid") or "").strip() == stuid:
            return index
    return None


def bind_shop_plan_accounts(config: dict[str, Any]) -> None:
    """让兑换计划跟着账号走，而不是跟着账号在列表里的下标走。

    计划里的 account_index 只是账号列表下标，删除或重排账号后会悄悄指向另一个账号，
    而 uid/region 仍是原账号的角色。这里按 account_stuid 重新算下标；
    还没有 account_stuid 的旧计划按当前下标补上；找不到对应账号的计划直接停用。
    """
    accounts = config.get("accounts") or []
    # 没有任何账号带 stuid（凭证文件缺失或都未登录）时没有可比对的标识，保持原样
    if not any(str(account.get("stuid") or "").strip() for account in accounts):
        return
    plans = (config.get("shop_exchange") or {}).get("plans") or []
    for plan in plans:
        stuid = str(plan.get("account_stuid") or "").strip()
        if not stuid:
            index = plan.get("account_index", 0)
            if isinstance(index, int) and 0 <= index < len(accounts):
                plan["account_stuid"] = str(accounts[index].get("stuid") or "").strip()
            continue
        index = find_account_index_by_stuid(accounts, stuid)
        if index is not None:
            plan["account_index"] = index
        elif plan.get("enable", True):
            plan["enable"] = False
            plan["last_result"] = "所属账号已删除或更换，计划已停用"


def find_account(config: dict[str, Any], name: str | None = None) -> dict[str, Any]:
    accounts = config.get("accounts") or []
    if not accounts:
        raise ValueError("配置中没有账号")
    if name is None:
        return accounts[0]
    for account in accounts:
        if account.get("name") == name:
            return account
    raise ValueError(f"未找到账号: {name}")


def upsert_account(config: dict[str, Any], name: str, data: dict[str, Any]) -> dict[str, Any]:
    accounts = config.setdefault("accounts", [])
    new_uid = str(data.get("stuid") or "").strip()
    if new_uid:
        for account in accounts:
            if account.get("name") != name and str(account.get("stuid") or "").strip() == new_uid:
                raise ValueError(f"UID {new_uid} 已存在，不能重复添加同一账号")
    for account in accounts:
        if account.get("name") == name:
            account.update(data)
            return account
    account = {"name": name, **data}
    accounts.append(account)
    return account


def load_credentials(config_path: pathlib.Path, config: dict[str, Any]) -> dict[str, Any]:
    """向后兼容：加载旧凭证文件。"""
    path = credentials_path(config_path, config)
    if not path.exists():
        return {"accounts": []}
    with path.open("r", encoding="utf-8") as file:
        loaded = yaml.safe_load(file) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"凭证文件格式错误: {path}")
    loaded.setdefault("accounts", [])
    return loaded


def save_credentials(path: pathlib.Path, config: dict[str, Any]) -> None:
    """向后兼容：保存旧凭据文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    credentials = {
        "accounts": [
            {
                "name": str(account.get("name") or ""),
                **{field: str(account.get(field) or "") for field in SENSITIVE_ACCOUNT_FIELDS},
                "cloud_games": {
                    "tokens": normalize_cloud_game_tokens(
                        (account.get("cloud_games") or {}).get("tokens", {})
                        if isinstance(account.get("cloud_games"), dict)
                        else {}
                    )
                },
            }
            for index, account in enumerate(config.get("accounts", []), start=1)
        ]
    }
    with path.open("w", encoding="utf-8", newline="\n") as file:
        yaml.safe_dump(credentials, file, allow_unicode=True, sort_keys=False)


def merge_credentials(config: dict[str, Any], credentials: dict[str, Any]) -> None:
    """向后兼容：合并旧凭据至配置。"""
    if not config.get("accounts") and credentials.get("accounts"):
        config["accounts"] = [
            {"name": str(account.get("name") or "")}
            for account in credentials.get("accounts", [])
            if isinstance(account, dict)
        ]
    credential_list = [
        account
        for account in credentials.get("accounts", [])
        if isinstance(account, dict)
    ]
    credential_accounts = {
        str(account.get("name")): account
        for account in credential_list
        if account.get("name")
    }
    for index, account in enumerate(config.get("accounts", [])):
        saved = credential_accounts.get(str(account.get("name")))
        if saved is None and index < len(credential_list):
            saved = credential_list[index]
        for field in SENSITIVE_ACCOUNT_FIELDS:
            if saved and not account.get(field):
                account[field] = str(saved.get(field) or "")
            else:
                account.setdefault(field, "")
        merge_account_cloud_game_credentials(account, saved)


def strip_credentials(config: dict[str, Any]) -> dict[str, Any]:
    """脱敏配置：仅保留账号名称，移除敏感凭证与 cloud_games tokens。"""
    public_config = copy.deepcopy(config)
    for account in public_config.get("accounts", []):
        for field in SENSITIVE_ACCOUNT_FIELDS:
            account.pop(field, None)
        account.pop("cloud_games", None)
    return public_config


def merge_account_cloud_game_credentials(account: dict[str, Any], saved: dict[str, Any] | None) -> None:
    if saved and isinstance(saved.get("cloud_games"), dict):
        saved_tokens = normalize_cloud_game_tokens((saved.get("cloud_games") or {}).get("tokens", {}))
    else:
        saved_tokens = {}
    cloud_games = account.setdefault("cloud_games", {})
    if not isinstance(cloud_games, dict):
        cloud_games = {}
        account["cloud_games"] = cloud_games
    cloud_games["tokens"] = saved_tokens


def account_path(config_path: str | pathlib.Path, config: dict[str, Any]) -> pathlib.Path:
    """解析 account.json 路径，支持环境变量指定或配置指定，优先与 config.yaml 同级。"""
    env_path = os.environ.get("MIYOUQIAN_ACCOUNT_PATH")
    if env_path:
        return pathlib.Path(env_path)
    storage = config.get("storage", {})
    account_file = str(storage.get("account_file") or "account.json").strip()
    path = pathlib.Path(account_file)
    if path.is_absolute():
        return path
    config_dir = pathlib.Path(config_path).parent
    candidate_config_dir = config_dir / path
    if candidate_config_dir.exists():
        return candidate_config_dir
    data_dir = resolve_storage_path(config_path, str(storage.get("data_dir") or "data"))
    candidate_data_dir = data_dir / path
    if candidate_data_dir.exists():
        return candidate_data_dir
    return candidate_config_dir


def get_account_repository(config_path: str | pathlib.Path, config: dict[str, Any]) -> AccountRepository:
    """获取关联当前配置路径的 AccountRepository 实例。"""
    return AccountRepository(account_path(config_path, config))


def records_path(config_path: str | pathlib.Path, config: dict[str, Any]) -> pathlib.Path:
    """解析 records.json 路径，支持环境变量指定或配置指定，优先位于 data 目录。"""
    env_path = os.environ.get("MIYOUQIAN_RECORDS_PATH")
    if env_path:
        return pathlib.Path(env_path)
    storage = config.get("storage", {})
    records_file = str(storage.get("records_file") or "records.json").strip()
    path = pathlib.Path(records_file)
    if path.is_absolute():
        return path
    data_dir = resolve_storage_path(config_path, str(storage.get("data_dir") or "data"))
    candidate_data_dir = data_dir / path
    if candidate_data_dir.exists():
        return candidate_data_dir
    config_dir = pathlib.Path(config_path).parent
    candidate_config_dir = config_dir / path
    if candidate_config_dir.exists():
        return candidate_config_dir
    return candidate_data_dir


def get_record_repository(config_path: str | pathlib.Path, config: dict[str, Any]):
    """获取关联当前配置路径的 RecordRepository 实例。"""
    from .records import RecordRepository

    return RecordRepository(records_path(config_path, config))


def credentials_path(config_path: str | pathlib.Path, config: dict[str, Any]) -> pathlib.Path:
    storage = config.get("storage", {})
    data_dir = resolve_storage_path(config_path, str(storage.get("data_dir") or "data"))
    return data_dir / str(storage.get("credentials_file") or "credentials.yaml")


def log_path(config_path: str | pathlib.Path, config: dict[str, Any]) -> pathlib.Path:
    storage = config.get("storage", {})
    log_dir = resolve_storage_path(config_path, str(storage.get("log_dir") or "logs"))
    return log_dir / str(storage.get("log_file") or "miyouqian.log")


def resolve_storage_path(config_path: str | pathlib.Path, value: str) -> pathlib.Path:
    path = pathlib.Path(value)
    if path.is_absolute():
        return path
    return pathlib.Path(config_path).parent / path
