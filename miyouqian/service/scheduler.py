# -*- coding: utf-8 -*-
"""每日随机波动调度器。"""

from __future__ import annotations

import inspect
import random
import threading
import traceback
from datetime import datetime, timedelta
from typing import Any, Callable


LogFn = Callable[[str], None]
RunFn = Callable[[], list[str]]


class DailyScheduler:
    def __init__(
        self,
        config: dict[str, Any],
        run_fn: RunFn,
        log_fn: LogFn,
        get_records_fn: Callable[[], list[dict[str, Any]]] | None = None,
    ) -> None:
        self.config = config
        self.run_fn = run_fn
        self.log = log_fn
        self.get_records_fn = get_records_fn
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._running = False
        self._jitter_waiting = False
        self._jitter_until: datetime | None = None
        self._next_run: datetime | None = None
        self._last_run: datetime | None = None
        self._last_error = ""
        self._schedule_signature = self._make_schedule_signature(self._schedule_config())
        self._log_next_run_on_recompute = False
        self._failed_patrol_dates: set[str] = set()
        self._retry_cooldown_seconds: int = 120
        self._max_patrol_attempts: int = 3

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="miyouqian-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

    def reload(self, config: dict[str, Any]) -> None:
        old_signature = self._schedule_signature
        self.config = config
        new_signature = self._make_schedule_signature(self._schedule_config())
        with self._lock:
            self._schedule_signature = new_signature
            if new_signature != old_signature:
                if new_signature[0] != old_signature[0] or new_signature[1] != old_signature[1]:
                    self._next_run = None
                    self._log_next_run_on_recompute = new_signature[1] != old_signature[1]
        self._wake.set()

    def run_now(self, trigger: str = "manual", force: bool = False) -> bool:
        with self._lock:
            if self._running:
                return False
            if not force and self.get_records_fn:
                try:
                    records = self.get_records_fn()
                    today_records = self._get_today_signin_records(records, datetime.now().date())
                    if any(r.get("status") == "success" for r in today_records):
                        self.log("【打卡签到】查询验证今日已成功完成签到，已签到不再重复签到（如需强制执行请传入 force）")
                        return False
                except Exception as exc:
                    self.log(f"打卡签到前查询验证异常: {exc}")
            self._running = True
        threading.Thread(
            target=lambda: self._run_once(trigger=trigger),
            name="miyouqian-manual-run",
            daemon=True,
        ).start()
        return True

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": bool(self._schedule_config().get("enable", True)),
                "running": self._running,
                "thread_alive": bool(self._thread and self._thread.is_alive()),
                "jitter_waiting": self._jitter_waiting,
                "jitter_until": self._jitter_until.isoformat(timespec="seconds") if self._jitter_until else "",
                "next_run": self._next_run.isoformat(timespec="seconds") if self._next_run else "",
                "last_run": self._last_run.isoformat(timespec="seconds") if self._last_run else "",
                "last_error": self._last_error,
                "schedule": self._schedule_config(),
                "patrol": self.get_patrol_status(),
            }

    def get_patrol_status(self) -> dict[str, Any]:
        schedule = self._schedule_config()
        if not schedule.get("enable", True) or not self.get_records_fn:
            return {"enabled": False}
        try:
            hour, minute = parse_time(str(schedule.get("time", "09:00")))
        except Exception:
            hour, minute = 9, 0
        now = datetime.now()
        today = now.date()
        today_scheduled = datetime.combine(today, datetime.min.time()).replace(hour=hour, minute=minute)
        past_scheduled = now >= today_scheduled
        records: list[dict[str, Any]] = []
        try:
            records = self.get_records_fn()
        except Exception:
            pass
        today_records = self._get_today_signin_records(records, today)
        has_success = any(r.get("status") == "success" for r in today_records)
        today_attempts = [
            r for r in today_records
            if (self._parse_record_datetime(r) or datetime.min) >= today_scheduled
        ]
        return {
            "enabled": True,
            "past_scheduled": past_scheduled,
            "today_signed_in": has_success,
            "today_attempts": len(today_attempts),
            "max_attempts": self._max_patrol_attempts,
            "stopped_for_today": len(today_attempts) >= self._max_patrol_attempts and not has_success,
        }

    @staticmethod
    def _parse_record_datetime(r: dict[str, Any]) -> datetime | None:
        ts = str(r.get("timestamp") or "").strip()
        if ts:
            try:
                clean_ts = ts.split(".")[0].split("+")[0].strip()
                return datetime.strptime(clean_ts, "%Y-%m-%d %H:%M:%S")
            except Exception:
                pass
        rec_id = str(r.get("id") or "").strip()
        if rec_id:
            try:
                return datetime.strptime(rec_id.split(".")[0], "%Y%m%d_%H%M%S")
            except Exception:
                pass
        return None

    def _get_today_signin_records(self, records: list[dict[str, Any]], today_date: Any) -> list[dict[str, Any]]:
        today_prefix = today_date.strftime("%Y-%m-%d")
        today_id_prefix = today_date.strftime("%Y%m%d")
        today_list = []
        for r in records:
            trigger = str(r.get("trigger") or "")
            task_type = str(r.get("task_type") or "")
            if trigger.startswith("exchange") or task_type == "shop_exchange":
                continue
            ts = str(r.get("timestamp") or "")
            rec_id = str(r.get("id") or "")
            dt = self._parse_record_datetime(r)
            if (dt and dt.date() == today_date) or ts.startswith(today_prefix) or rec_id.startswith(today_id_prefix):
                today_list.append(r)
        return today_list

    def _inspect_and_retry(self, schedule: dict[str, Any]) -> bool:
        """巡检功能：检查执行记录列表，若超过当日定时时间且未签到，自动尝试最多3次，超过3次认定失败，当日不再尝试。"""
        if not schedule.get("enable", True) or not self.config.get("enable", True):
            return False
        if not self.get_records_fn:
            return False

        try:
            hour, minute = parse_time(str(schedule.get("time", "09:00")))
        except Exception:
            hour, minute = 9, 0

        now = datetime.now()
        today = now.date()
        today_str = today.strftime("%Y-%m-%d")
        today_scheduled = datetime.combine(today, datetime.min.time()).replace(hour=hour, minute=minute)

        # 未到当日定时时间，由正常调度流程处理
        if now < today_scheduled:
            return False

        try:
            records = self.get_records_fn()
        except Exception as exc:
            self.log(f"巡检读取执行记录异常: {exc}")
            return False

        today_records = self._get_today_signin_records(records, today)

        # 检查当日是否已成功签到
        has_success = any(r.get("status") == "success" for r in today_records)
        if has_success:
            return False

        # 统计在当日预定时间到达或之后进行的尝试（包含常规调度及巡检重试）
        today_attempts = [
            r for r in today_records
            if (self._parse_record_datetime(r) or datetime.min) >= today_scheduled
        ]
        attempt_count = len(today_attempts)

        # 超过 3 次认定失败，当日不再尝试
        if attempt_count >= self._max_patrol_attempts:
            if today_str not in self._failed_patrol_dates:
                self._failed_patrol_dates.add(today_str)
                self.log(
                    f"今日签到任务巡检：已超过定时时间 {today_scheduled.strftime('%H:%M')}，"
                    f"且已累计尝试 {attempt_count} 次（已达上限 {self._max_patrol_attempts} 次），"
                    f"认定今日签到失败，当日不再尝试"
                )
            return False

        # 检查重试冷却间隔（默认 120 秒），防止短时间内高频冲击
        if today_attempts:
            latest_attempt_time = max(
                (self._parse_record_datetime(r) or datetime.min)
                for r in today_attempts
            )
            if (now - latest_attempt_time).total_seconds() < self._retry_cooldown_seconds:
                return False

        # 触发自动尝试
        attempt_num = attempt_count + 1
        self.log(
            f"今日签到任务巡检：超过预定时间 {today_scheduled.strftime('%H:%M')} 且今日尚未签到成功，"
            f"自动执行第 {attempt_num}/{self._max_patrol_attempts} 次尝试..."
        )
        with self._lock:
            self._running = True
        self._run_once(trigger="patrol")
        return True

    def _loop(self) -> None:
        if self._schedule_config().get("run_on_start", False):
            self.run_now()
        while not self._stop.is_set():
            try:
                schedule = self._schedule_config()
                if not schedule.get("enable", True):
                    with self._lock:
                        self._next_run = None
                    self._wake.wait(timeout=30)
                    self._wake.clear()
                    continue

                # 优先执行巡检重试
                with self._lock:
                    is_running = self._running
                if not is_running:
                    retried = self._inspect_and_retry(schedule)
                    if retried:
                        self._wake.clear()
                        continue

                with self._lock:
                    if self._next_run is None:
                        log_change = self._log_next_run_on_recompute
                        self._log_next_run_on_recompute = False
                        self._next_run = self._compute_next_base_run(schedule, log_change=log_change)
                    next_run = self._next_run
                wait_seconds = max((next_run - datetime.now()).total_seconds(), 0)
                if wait_seconds > 0:
                    # 每 30 秒轮询一次，保障巡检机制与唤醒信号及时响应
                    if self._wake.wait(timeout=min(wait_seconds, 30)):
                        self._wake.clear()
                        continue
                else:
                    self._wake.clear()
                if datetime.now() >= next_run:
                    with self._lock:
                        if self._running:
                            self._next_run = self._compute_next_base_run(schedule, tomorrow=True, log_change=False)
                            continue
                        due_run = self._next_run

                    # 定时打卡前查询验证：若今日已成功完成签到，跳过本次定时签到
                    if self.get_records_fn:
                        try:
                            records = self.get_records_fn()
                            today_records = self._get_today_signin_records(records, datetime.now().date())
                            if any(r.get("status") == "success" for r in today_records):
                                self.log("【定时打卡签到】查询验证今日已成功完成签到，已签到不再重复签到，跳过本次定时任务")
                                with self._lock:
                                    self._next_run = self._compute_next_base_run(schedule, tomorrow=True, log_change=False)
                                continue
                        except Exception as exc:
                            self.log(f"定时签到前查询验证异常: {exc}")

                    if not self._wait_jitter(schedule, due_run):
                        continue
                    with self._lock:
                        if self._running:
                            self._next_run = self._compute_next_base_run(schedule, tomorrow=True, log_change=False)
                            continue
                        if self._last_run and due_run and self._last_run >= due_run:
                            self._next_run = self._compute_next_base_run(schedule, tomorrow=True, log_change=False)
                            continue
                        self._running = True
                    self._run_once(trigger="scheduled")
                    with self._lock:
                        self._next_run = self._compute_next_base_run(self._schedule_config(), tomorrow=True, log_change=False)
            except Exception as exc:
                tb = traceback.format_exc()
                self.log(f"调度器主循环异常 (已防崩自愈并将在 10 秒后恢复): {exc}\n{tb}")
                with self._lock:
                    self._last_error = f"调度器循环异常: {exc}"
                if self._stop.wait(timeout=10):
                    break

    def _run_once(self, trigger: str = "scheduled") -> None:
        self.log("开始执行签到任务")
        try:
            sig = inspect.signature(self.run_fn)
            lines = self.run_fn(trigger=trigger) if "trigger" in sig.parameters else self.run_fn()
            for line in lines:
                self.log(line)
            with self._lock:
                self._last_run = datetime.now()
                self._last_error = ""
            self.log("签到任务执行完成")
        except Exception as exc:
            tb = traceback.format_exc()
            with self._lock:
                self._last_error = f"{exc}\n{tb}"
            self.log(f"签到任务失败: {exc}\n{tb}")
        finally:
            with self._lock:
                self._running = False

    def _schedule_config(self) -> dict[str, Any]:
        schedule = self.config.get("schedule", {})
        return schedule if isinstance(schedule, dict) else {}

    def _compute_next_base_run(
        self,
        schedule: dict[str, Any],
        tomorrow: bool = False,
        log_change: bool = False,
    ) -> datetime:
        try:
            hour, minute = parse_time(str(schedule.get("time", "09:00")))
        except Exception as exc:
            self.log(f"解析调度时间配置失败: {exc}，回退使用默认时间 09:00")
            hour, minute = 9, 0
        base_day = datetime.now().date()
        if tomorrow:
            base_day = base_day + timedelta(days=1)
        target = datetime.combine(base_day, datetime.min.time()).replace(hour=hour, minute=minute)
        if target <= datetime.now():
            return self._compute_next_base_run(schedule, tomorrow=True, log_change=log_change)
        if log_change:
            tz_info = datetime.now().astimezone().tzname() or "本地时区"
            self.log(f"下次自动执行时间: {target.strftime('%Y-%m-%d %H:%M:%S')} ({tz_info})")
        return target

    def _wait_jitter(self, schedule: dict[str, Any], due_run: datetime | None) -> bool:
        try:
            jitter = max(int(schedule.get("jitter_minutes", 45) or 0), 0)
        except (TypeError, ValueError):
            jitter = 45
        if not jitter:
            return True
        delay_seconds = random.randint(0, jitter * 60)
        if delay_seconds <= 0:
            return True
        jitter_until = datetime.now() + timedelta(seconds=delay_seconds)
        if due_run:
            delay_min_str = f"{delay_seconds // 60}分{delay_seconds % 60}秒" if delay_seconds >= 60 else f"{delay_seconds}秒"
            self.log(
                f"已到预定执行时间 {due_run.strftime('%Y-%m-%d %H:%M:%S')}，随机延后 {delay_min_str} "
                f"（预计在 {jitter_until.strftime('%H:%M:%S')} 开始执行）"
            )
        with self._lock:
            self._jitter_waiting = True
            self._jitter_until = jitter_until
            self._next_run = jitter_until
            initial_signature = self._schedule_signature
        try:
            while not self._stop.is_set():
                remaining = (jitter_until - datetime.now()).total_seconds()
                if remaining <= 0:
                    break
                if self._wake.wait(timeout=min(remaining, 5)):
                    self._wake.clear()
                    # 若在延后等待期间外部修改了调度配置，及时取消延后并重新规划
                    with self._lock:
                        current_signature = self._schedule_signature
                    if current_signature != initial_signature:
                        self.log("检测到调度配置变更，取消当前随机延后等待并重新规划")
                        with self._lock:
                            self._next_run = None
                        return False
        finally:
            with self._lock:
                self._jitter_waiting = False
                self._jitter_until = None
        return not self._stop.is_set()

    def _make_schedule_signature(self, schedule: dict[str, Any]) -> tuple[Any, ...]:
        return (
            bool(schedule.get("enable", True)),
            str(schedule.get("time", "09:00")),
            int(schedule.get("jitter_minutes", 45) or 0),
        )


def parse_time(value: str) -> tuple[int, int]:
    parts = value.strip().split(":", 1)
    if len(parts) != 2:
        raise ValueError("schedule.time 必须是 HH:MM 格式")
    hour = int(parts[0])
    minute = int(parts[1])
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError("schedule.time 超出范围")
    return hour, minute
