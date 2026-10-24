# -*- coding: utf-8 -*-
"""Web 控制台配置差异比对、脱敏与敏感数据保护工具。"""

from __future__ import annotations

import json
from typing import Any

SENSITIVE_CONFIG_NAMES = {
    "cookie",
    "stoken",
    "mid",
    "token",
    "tokens",
    "webhook",
    "userkey",
    "api_key",
    "secret",
    "client_secret",
    "password",
    "smtp_password",
    "fp",
}


def is_sensitive_config_path(path: str) -> bool:
    """判定配置路径是否涉及敏感信息（Cookie、Token、打码密钥等）。"""
    parts = [part.split("[", 1)[0].lower() for part in path.replace("]", "").split(".")]
    return any(part in SENSITIVE_CONFIG_NAMES or part.endswith("_token") for part in parts)


def mask_sensitive_value(value: Any) -> str:
    """脱敏遮蔽敏感配置展示文本。"""
    return "<空>" if value in (None, "") else "<已设置>"


def redact_config_value(value: Any) -> Any:
    """递归脱敏字典或列表中的敏感配置项。"""
    if isinstance(value, dict):
        return {
            key: mask_sensitive_value(child) if is_sensitive_config_path(str(key)) else redact_config_value(child)
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [redact_config_value(item) for item in value]
    return value


def format_config_value(path: str, value: Any) -> str:
    """格式化配置值用于日志输出，敏感项自动脱敏，超长截断。"""
    if is_sensitive_config_path(path):
        return mask_sensitive_value(value)
    text = json.dumps(redact_config_value(value), ensure_ascii=False, sort_keys=True)
    if len(text) > 120:
        return text[:117] + "..."
    return text


def should_log_config_change(path: str, old_value: Any, new_value: Any) -> bool:
    """过滤无意义的空值变更，仅输出有效变化。"""
    if format_config_value(path, old_value) == format_config_value(path, new_value):
        return False
    if old_value is None and new_value in ("", [], {}, None):
        return False
    return True


def diff_config(old: Any, new: Any, path: str = "") -> list[tuple[str, Any, Any]]:
    """递归比对两个配置对象的差异，返回 (path, old_value, new_value) 列表。"""
    if type(old) is not type(new):
        return [(path or "<root>", old, new)]
    if isinstance(old, dict):
        changes: list[tuple[str, Any, Any]] = []
        keys = sorted(set(old) | set(new), key=str)
        for key in keys:
            child_path = f"{path}.{key}" if path else str(key)
            if key not in old:
                changes.extend(diff_added_config(new[key], child_path))
            elif key not in new:
                changes.extend(diff_removed_config(old[key], child_path))
            else:
                changes.extend(diff_config(old[key], new[key], child_path))
        return changes
    if isinstance(old, list):
        changes = []
        common = min(len(old), len(new))
        for index in range(common):
            changes.extend(diff_config(old[index], new[index], f"{path}[{index}]"))
        for index in range(common, len(old)):
            changes.extend(diff_removed_config(old[index], f"{path}[{index}]"))
        for index in range(common, len(new)):
            changes.extend(diff_added_config(new[index], f"{path}[{index}]"))
        return changes
    if old != new:
        return [(path or "<root>", old, new)]
    return []


def diff_added_config(value: Any, path: str) -> list[tuple[str, Any, Any]]:
    """递归展开新增配置项的差异记录。"""
    if isinstance(value, dict):
        changes: list[tuple[str, Any, Any]] = []
        for key in sorted(value, key=str):
            changes.extend(diff_added_config(value[key], f"{path}.{key}"))
        return changes
    if isinstance(value, list):
        changes = []
        for index, item in enumerate(value):
            changes.extend(diff_added_config(item, f"{path}[{index}]"))
        return changes
    return [(path, None, value)]


def diff_removed_config(value: Any, path: str) -> list[tuple[str, Any, Any]]:
    """递归展开删除配置项的差异记录。"""
    if isinstance(value, dict):
        changes: list[tuple[str, Any, Any]] = []
        for key in sorted(value, key=str):
            changes.extend(diff_removed_config(value[key], f"{path}.{key}"))
        return changes
    if isinstance(value, list):
        changes = []
        for index, item in enumerate(value):
            changes.extend(diff_removed_config(item, f"{path}[{index}]"))
        return changes
    return [(path, value, None)]


def display_account_name(account: dict[str, Any]) -> str:
    """提取账号友好的展示名称。"""
    return str(account.get("name") or account.get("stuid") or "未命名账号")


def merge_account_credentials(target_accounts: list[dict[str, Any]], source_accounts: list[dict[str, Any]]) -> None:
    """防御性保护：当外部/前端配置未携带完整凭证时，继承现有已持久化的敏感凭据。"""
    source_by_uid = {str(a.get("stuid") or "").strip(): a for a in source_accounts if str(a.get("stuid") or "").strip()}
    source_by_name = {str(a.get("name") or "").strip(): a for a in source_accounts if str(a.get("name") or "").strip()}
    for target in target_accounts:
        uid = str(target.get("stuid") or "").strip()
        name = str(target.get("name") or "").strip()
        source = source_by_uid.get(uid) or source_by_name.get(name)
        if not source:
            continue
        for field in ("cookie", "stuid", "stoken", "mid"):
            if not target.get(field) and source.get(field):
                target[field] = str(source[field])
        target_cg = target.setdefault("cloud_games", {})
        source_cg = source.get("cloud_games") or {}
        if isinstance(target_cg, dict) and isinstance(source_cg, dict):
            target_tokens = target_cg.setdefault("tokens", {})
            source_tokens = source_cg.get("tokens") or {}
            if isinstance(target_tokens, dict) and isinstance(source_tokens, dict):
                for k, v in source_tokens.items():
                    if not target_tokens.get(k) and v:
                        target_tokens[k] = str(v)
