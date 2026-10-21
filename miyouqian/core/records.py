# -*- coding: utf-8 -*-
"""任务执行记录管理与持久化仓储（Repository 模式）。"""

from __future__ import annotations

import json
import os
import pathlib
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

from loguru import logger


@dataclass
class StageRecord:
    """单个执行阶段（如游戏签到、米游币任务）记录。"""
    stage: str
    component: str = "task"
    status: str = "success"  # "success" | "partial" | "failed" | "skipped"
    success_items: list[str] = field(default_factory=list)
    failed_items: list[str] = field(default_factory=list)
    skipped_items: list[str] = field(default_factory=list)
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AccountRecord:
    """单个账号维度的执行结果记录。"""
    name: str
    stuid: str
    status: str = "success"  # "success" | "partial" | "failed" | "skipped"
    stages: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ExecutionRecord:
    """单次任务批次整体执行记录。"""
    id: str
    timestamp: str
    trigger: str = "manual"  # "scheduled" | "manual" | "cli"
    status: str = "success"  # "success" | "partial" | "failed" | "skipped"
    duration_seconds: float = 0.0
    total_accounts: int = 0
    success_accounts: int = 0
    failed_accounts: int = 0
    accounts: list[dict[str, Any]] = field(default_factory=list)
    summary_text: str = ""
    messages: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class RecordRepository:
    """任务执行记录持久化仓储。"""

    def __init__(self, records_path: str | pathlib.Path, max_records: int = 50) -> None:
        self.records_path = pathlib.Path(records_path)
        self.max_records = max_records

    def load(self, limit: int | None = None) -> list[dict[str, Any]]:
        """读取历史执行记录列表（按时间倒序）。"""
        if not self.records_path.exists():
            return []
        try:
            with self.records_path.open("r", encoding="utf-8") as file:
                data = json.load(file)
            if not isinstance(data, list):
                return []
            if limit and limit > 0:
                return data[:limit]
            return data
        except Exception as exc:
            logger.warning(f"读取任务记录文件 {self.records_path} 异常: {exc}")
            return []

    def latest(self) -> dict[str, Any] | None:
        """获取最近一条任务执行记录。"""
        records = self.load(limit=1)
        return records[0] if records else None

    def append(self, record: dict[str, Any] | ExecutionRecord) -> dict[str, Any]:
        """追加一条新记录到历史列表头部，并保持最大条数上限。"""
        rec_dict = record.to_dict() if isinstance(record, ExecutionRecord) else dict(record)
        existing = self.load()
        new_records = [rec_dict] + existing
        if len(new_records) > self.max_records:
            new_records = new_records[: self.max_records]
        self.save(new_records)
        return rec_dict

    def save(self, records: list[dict[str, Any]]) -> None:
        """原子写入记录文件，确保写入过程异常时不损毁已有文件。"""
        self._atomic_write_json(self.records_path, records)

    def clear(self) -> None:
        """清空历史记录。"""
        self.save([])

    @staticmethod
    def _atomic_write_json(path: pathlib.Path, data: Any) -> None:
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
