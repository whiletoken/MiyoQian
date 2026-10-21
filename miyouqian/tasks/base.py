# -*- coding: utf-8 -*-
"""签到与任务基类（模板方法模式）。"""

from __future__ import annotations

import abc
import random
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from ..core.http import ApiClient


@dataclass
class TaskSummary:
    """任务执行结果统计。"""
    messages: list[str] = field(default_factory=list)
    success: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def add_message(self, message: str) -> None:
        self.messages.append(message)

    def merge(self, other: TaskSummary | dict[str, list[str]]) -> None:
        if isinstance(other, dict):
            self.messages.extend(other.get("messages", []))
            self.success.extend(other.get("success", []))
            self.failed.extend(other.get("failed", []))
            self.skipped.extend(other.get("skipped", []))
        else:
            self.messages.extend(other.messages)
            self.success.extend(other.success)
            self.failed.extend(other.failed)
            self.skipped.extend(other.skipped)

    def to_dict(self) -> dict[str, list[str]]:
        return {
            "messages": self.messages,
            "success": self.success,
            "failed": self.failed,
            "skipped": self.skipped,
        }


class BaseTask(abc.ABC):
    """任务执行抽象基类。"""

    def __init__(
        self,
        client: ApiClient,
        config: dict[str, Any],
        account: dict[str, Any],
        emit: Callable[[str], None] | None = None,
    ) -> None:
        self.client = client
        self.config = config
        self.account = account
        self.emit = emit
        self.device = config.get("device", {})

    def _add(self, messages: list[str], text: str) -> None:
        messages.append(text)
        if self.emit:
            self.emit(text)

    def _sleep(self) -> None:
        sleep_by_config(self.config)

    @abc.abstractmethod
    def run(self) -> list[str]:
        """执行任务并返回日志消息列表。"""


def sleep_by_config(config: dict[str, Any]) -> None:
    """根据配置的延时范围随机等待。"""
    delay = (config.get("bbs") or {}).get("delay_seconds", [1, 3])
    if not isinstance(delay, list) or len(delay) < 2:
        delay = [1, 3]
    try:
        low = min(float(delay[0]), float(delay[1]))
        high = max(float(delay[0]), float(delay[1]))
        if high <= 0:
            return
        time.sleep(random.uniform(low, high))
    except (TypeError, ValueError):
        time.sleep(random.uniform(1, 3))
