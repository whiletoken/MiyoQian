# -*- coding: utf-8 -*-
"""任务执行编排与执行结果持久化。"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

from ..core.config import find_account, get_record_repository, save_config
from ..core.http import ApiClient
from ..tasks.bbs import BbsTasks
from ..tasks.cloud_games import CloudGameCheckin
from ..tasks.games import GameCheckin

EmitFn = Callable[[str], None]
ComponentEmitFn = Callable[[str, str], None]


def run_tasks(
    config: dict[str, Any],
    config_path: str,
    account_name: str | None = None,
    games_only: bool = False,
    bbs_only: bool = False,
    only_games: list[str] | None = None,
    emit: EmitFn | None = None,
    emit_component: ComponentEmitFn | None = None,
    trigger: str = "manual",
) -> list[str]:
    start_time = time.time()
    output: list[str] = []
    account_records: list[dict[str, Any]] = []

    def add(message: str, component: str = "task") -> None:
        output.append(message)
        if emit_component:
            emit_component(message, component)
        elif emit:
            emit(message)

    def _persist_record(record_data: dict[str, Any]) -> None:
        try:
            repo = get_record_repository(config_path, config)
            repo.append(record_data)
        except Exception as exc:
            add(f"保存任务执行记录异常: {exc}", "task")

    if games_only and bbs_only:
        raise ValueError("games_only 和 bbs_only 不能同时启用")

    timestamp_str = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
    record_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    if not config.get("enable", True):
        add("配置 enable=false，已跳过。")
        _persist_record({
            "id": record_id,
            "timestamp": timestamp_str,
            "trigger": trigger,
            "status": "skipped",
            "duration_seconds": 0.0,
            "total_accounts": 0,
            "success_accounts": 0,
            "failed_accounts": 0,
            "accounts": [],
            "summary_text": "配置 enable=false，已跳过执行",
            "messages": list(output),
        })
        return output

    accounts = [find_account(config, account_name)] if account_name else list(config.get("accounts", []))
    if not accounts:
        add("没有配置账号，已跳过。")
        _persist_record({
            "id": record_id,
            "timestamp": timestamp_str,
            "trigger": trigger,
            "status": "skipped",
            "duration_seconds": 0.0,
            "total_accounts": 0,
            "success_accounts": 0,
            "failed_accounts": 0,
            "accounts": [],
            "summary_text": "未配置账号，已跳过执行",
            "messages": list(output),
        })
        return output

    should_emit = bool(emit or emit_component)

    with ApiClient() as client:
        for index, account in enumerate(accounts, start=1):
            account_display = account.get("name") or f"账号{index}"
            add(f"# 账号 {index}/{len(accounts)}: {account_display}")

            current_account_stages: list[dict[str, Any]] = []

            def run_stage(stage: str, component: str, failed_prefix: str, run: Callable[[], list[str]]) -> None:
                stage_record: dict[str, Any] = {
                    "stage": stage,
                    "component": component,
                    "status": "success",
                    "success_items": [],
                    "failed_items": [],
                    "skipped_items": [],
                    "error": "",
                }
                try:
                    lines = run()
                    for line in lines:
                        if "成功项：" in line:
                            items = line.split("成功项：", 1)[1].split(";")
                            stage_record["success_items"].extend([it.strip() for it in items if it.strip()])
                        elif "失败项：" in line:
                            items = line.split("失败项：", 1)[1].split(";")
                            stage_record["failed_items"].extend([it.strip() for it in items if it.strip()])
                        elif "跳过" in line and "汇总" not in line:
                            stage_record["skipped_items"].append(line.strip())
                    if stage_record["failed_items"]:
                        stage_record["status"] = "partial" if stage_record["success_items"] else "failed"
                    elif not stage_record["success_items"] and stage_record["skipped_items"]:
                        stage_record["status"] = "skipped"
                except Exception as exc:
                    stage_record["status"] = "failed"
                    stage_record["error"] = str(exc)
                    stage_record["failed_items"].append(f"{stage}执行异常: {exc}")
                    add(f"{failed_prefix}{stage}执行异常: {exc}", component)
                    lines = []
                current_account_stages.append(stage_record)
                if not should_emit:
                    output.extend(lines)

            if not bbs_only and config.get("features", {}).get("game_checkin", True):
                run_stage(
                    "游戏社区签到",
                    "game",
                    "游戏社区失败项：",
                    lambda: GameCheckin(
                        client,
                        config,
                        account,
                        emit=(lambda message: add(message, "game")) if should_emit else None,
                    ).run(only_games=only_games),
                )
            if not bbs_only and config.get("features", {}).get("cloud_game_checkin", False):
                run_stage(
                    "云游戏签到",
                    "cloud",
                    "云游戏失败项：",
                    lambda: CloudGameCheckin(
                        client,
                        config,
                        account,
                        emit=(lambda message: add(message, "cloud")) if should_emit else None,
                    ).run(),
                )
            if not games_only and config.get("features", {}).get("bbs_tasks", False):
                run_stage(
                    "米游币任务",
                    "bbs",
                    "米游币失败项：",
                    lambda: BbsTasks(
                        client,
                        config,
                        account,
                        emit=(lambda message: add(message, "bbs")) if should_emit else None,
                    ).run(),
                )

            # 汇总单账号状态
            has_fail = any(s["status"] in ("failed", "partial") for s in current_account_stages)
            has_succ = any(s["status"] == "success" or s["success_items"] for s in current_account_stages)
            if has_fail and has_succ:
                acc_status = "partial"
            elif has_fail:
                acc_status = "failed"
            elif has_succ:
                acc_status = "success"
            else:
                acc_status = "skipped"

            account_records.append({
                "name": account_display,
                "stuid": str(account.get("stuid") or ""),
                "status": acc_status,
                "stages": current_account_stages,
            })

    save_config(config_path, config)

    # 统计全局状态
    duration = round(time.time() - start_time, 2)
    total_acc = len(account_records)
    succ_acc = sum(1 for a in account_records if a["status"] == "success")
    fail_acc = sum(1 for a in account_records if a["status"] in ("failed", "partial"))
    if fail_acc == 0 and succ_acc > 0:
        overall_status = "success"
    elif succ_acc > 0 and fail_acc > 0:
        overall_status = "partial"
    elif total_acc > 0 and succ_acc == 0 and fail_acc > 0:
        overall_status = "failed"
    else:
        overall_status = "skipped"

    summary_text = f"共 {total_acc} 个账号：成功 {succ_acc} 个，异常 {fail_acc} 个（耗时 {duration}s）"

    _persist_record({
        "id": record_id,
        "timestamp": timestamp_str,
        "trigger": trigger,
        "status": overall_status,
        "duration_seconds": duration,
        "total_accounts": total_acc,
        "success_accounts": succ_acc,
        "failed_accounts": fail_acc,
        "accounts": account_records,
        "summary_text": summary_text,
        "messages": list(output),
    })

    return output
