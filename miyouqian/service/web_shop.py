# -*- coding: utf-8 -*-
"""Web 控制台米游币商品与自动兑换任务管理。"""

from __future__ import annotations

import copy
import time
from datetime import datetime
from typing import Any, Callable

from ..core.config import find_account_index_by_stuid, save_config
from ..core.http import ApiClient
from ..tasks.shop_exchange import ShopExchange
from .web_diff import display_account_name


class WebShopMixin:
    """商品兑换业务混入类，赋予 WebApp 米游币商品检索与定时/手动兑换能力。"""

    config: dict[str, Any]
    config_path: Any
    lock: Any
    records_repo: Any
    exchange_scheduler: Any

    def log(self, message: str, component: str = "web") -> None:
        raise NotImplementedError

    def shop_goods(self, game: str = "") -> dict[str, Any]:
        game_label = game or "全部分区"
        self.log(f"开始获取商品列表: {game_label}", "exchange")
        with self.lock:
            config = copy.deepcopy(self.config)
        try:
            with ApiClient(timeout=20.0) as client:
                result = ShopExchange(client, config, emit=lambda message: self.log(message, "exchange")).goods(game=game)
        except Exception as exc:
            self.log(f"商品列表获取失败: {game_label}，{exc}", "exchange")
            raise
        goods_count = len(result.get("goods") or [])
        self.log(f"商品列表获取完成: {game_label}，共 {goods_count} 个商品", "exchange")
        return result

    def shop_good_detail(self, goods_id: str) -> dict[str, Any]:
        self.log(f"开始获取商品详情: {goods_id}", "exchange")
        with self.lock:
            config = copy.deepcopy(self.config)
        try:
            with ApiClient(timeout=20.0) as client:
                result = ShopExchange(client, config).good_detail(goods_id)
        except Exception as exc:
            self.log(f"商品详情获取失败: {goods_id}，{exc}", "exchange")
            raise
        self.log(f"商品详情获取完成: {result.get('goods_name') or goods_id}", "exchange")
        return result

    def ensure_shop_device_fp(self) -> dict[str, Any]:
        self.log("开始预获取商品兑换 device_fp", "exchange")
        with self.lock:
            config = copy.deepcopy(self.config)
        try:
            with ApiClient(timeout=20.0) as client:
                device_fp = ShopExchange(client, config).fetch_device_fp()
        except Exception as exc:
            self.log(f"商品兑换 device_fp 获取失败: {exc}", "exchange")
            raise
        with self.lock:
            self.config.setdefault("device", {})["fp"] = device_fp
            save_config(self.config_path, self.config)
        self.log("已预获取商品兑换 device_fp", "exchange")
        return {"device_fp": device_fp}

    def shop_account_meta(self, account_index: int, game_biz: str = "") -> dict[str, Any]:
        account = self._account_by_index(account_index)
        account_name = display_account_name(account)
        self.log(f"开始获取兑换账号信息: {account_name}，game_biz={game_biz or '无'}", "exchange")
        with self.lock:
            config = copy.deepcopy(self.config)
        with ApiClient(timeout=20.0) as client:
            shop = ShopExchange(client, config, account)
            result: dict[str, Any] = {"points": {}, "addresses": [], "roles": []}
            try:
                result["points"] = shop.points()
            except Exception as exc:
                result["points_error"] = str(exc)
                self.log(f"米游币余额获取失败: {account_name}，{exc}", "exchange")
            try:
                result["addresses"] = shop.addresses()
            except Exception as exc:
                result["addresses_error"] = str(exc)
                self.log(f"收货地址获取失败: {account_name}，{exc}", "exchange")
            if game_biz:
                try:
                    result["roles"] = shop.roles(game_biz)
                except Exception as exc:
                    result["roles_error"] = str(exc)
                    self.log(f"游戏角色获取失败: {account_name}，{game_biz}，{exc}", "exchange")
            self.log(
                f"兑换账号信息获取完成: {account_name}，地址 {len(result.get('addresses') or [])} 个，角色 {len(result.get('roles') or [])} 个",
                "exchange",
            )
            return result

    def _persist_exchange_record(
        self,
        *,
        plan: dict[str, Any],
        account: dict[str, Any],
        result: dict[str, Any] | None,
        error: str | None = None,
        trigger: str = "exchange_manual",
        messages: list[str] | None = None,
        duration: float = 0.0,
    ) -> dict[str, Any]:
        """将商品兑换任务执行结果统一保存至 RecordRepository，供看板与历史查询。"""
        is_ok = bool(result and result.get("ok"))
        status = "success" if is_ok else "failed"
        status_label = "【兑换成功】" if is_ok else "【兑换失败】"
        account_name = display_account_name(account)
        account_stuid = str(account.get("stuid") or "")
        goods_name = str(plan.get("goods_name") or plan.get("goods_id") or "未知商品")

        detail_msg = result.get("message", "") if result else (error or "未知错误")
        retcode_str = f"(retcode={result.get('retcode')})" if result and result.get("retcode") is not None else ""
        attempts = result.get("attempt", 1) if result else 1
        summary = f"{status_label} 商品「{goods_name}」: {detail_msg}{retcode_str}，尝试 {attempts} 次"

        stage_record = {
            "stage": "米游币商品兑换",
            "component": "exchange",
            "status": status,
            "success_items": [goods_name] if is_ok else [],
            "failed_items": [] if is_ok else [goods_name],
            "skipped_items": [],
            "error": "" if is_ok else detail_msg,
        }

        account_record = {
            "name": account_name,
            "stuid": account_stuid,
            "status": status,
            "stages": [stage_record],
        }

        record_data = {
            "id": datetime.now().strftime("%Y%m%d_%H%M%S"),
            "timestamp": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
            "trigger": trigger,
            "status": status,
            "duration_seconds": round(duration, 2),
            "total_accounts": 1,
            "success_accounts": 1 if is_ok else 0,
            "failed_accounts": 0 if is_ok else 1,
            "accounts": [account_record],
            "summary_text": summary,
            "messages": list(messages or [summary]),
        }
        try:
            self.records_repo.append(record_data)
        except Exception as exc:
            self.log(f"保存兑换记录异常: {exc}", "exchange")
        return record_data

    def shop_exchange_once(
        self,
        plan: dict[str, Any],
        on_progress: Callable[[int, str], None] | None = None,
        trigger: str = "exchange_manual",
    ) -> dict[str, Any]:
        account = self._account_by_index(self._plan_account_index(plan))
        account_name = display_account_name(account)
        goods_name = str(plan.get("goods_name") or plan.get("goods_id") or "未知商品")
        log_prefix = f"【账号 {account_name}｜商品 {goods_name}】"
        self.log(f"{log_prefix}开始商品兑换", "exchange")
        if not str(plan.get("device_fp") or "").strip():
            raise ValueError("兑换计划缺少 device_fp，请重新添加计划")
        with self.lock:
            config = copy.deepcopy(self.config)

        collected_logs: list[str] = [f"{log_prefix}开始商品兑换"]

        def collect_and_log(message: str) -> None:
            full_msg = f"{log_prefix}{message}"
            collected_logs.append(full_msg)
            self.log(full_msg, "exchange")

        start_time = time.time()
        try:
            with ApiClient(timeout=15.0) as client:
                result = ShopExchange(
                    client,
                    config,
                    account,
                    emit=collect_and_log,
                ).exchange_with_retry(plan, on_progress=on_progress)
        except Exception as exc:
            duration = time.time() - start_time
            self.log(f"{log_prefix}商品兑换请求异常: 【兑换失败】(执行异常: {exc})", "exchange")
            self._persist_exchange_record(
                plan=plan,
                account=account,
                result=None,
                error=str(exc),
                trigger=trigger,
                messages=collected_logs + [f"执行异常: {exc}"],
                duration=duration,
            )
            raise

        duration = time.time() - start_time
        is_ok = bool(result.get("ok"))
        status_label = "【兑换成功】" if is_ok else "【兑换失败】"
        summary = f"{status_label} {result.get('message', '未知结果')}(retcode={result.get('retcode')})，请求 {result.get('attempt', 1)} 次"
        self.log(f"{log_prefix}商品兑换结束: {summary}", "exchange")

        self._persist_exchange_record(
            plan=plan,
            account=account,
            result=result,
            trigger=trigger,
            messages=collected_logs,
            duration=duration,
        )
        return result

    def shop_exchange_plan_once(self, plan_index: int) -> dict[str, Any]:
        with self.lock:
            plans = self.config.get("shop_exchange", {}).get("plans") or []
            if plan_index < 0 or plan_index >= len(plans):
                raise ValueError("兑换计划不存在")
            plan = copy.deepcopy(plans[plan_index])
            goods_name = plan.get("goods_name") or plan.get("goods_id")
        self.log(f"开始手动执行商品兑换计划 {plan_index + 1}: {goods_name}", "exchange")
        self.exchange_scheduler.update_progress(plan_index, attempt=0, message="准备兑换")
        try:
            result = self.shop_exchange_once(
                plan,
                on_progress=lambda attempt, msg: self.exchange_scheduler.update_progress(
                    plan_index, attempt=attempt, message=msg
                ),
                trigger="exchange_manual",
            )
        except Exception as exc:
            summary = f"【兑换失败】异常: {exc}"
            with self.lock:
                plans = self.config.get("shop_exchange", {}).get("plans") or []
                if plan_index < len(plans):
                    plans[plan_index]["last_result"] = summary
                    plans[plan_index]["last_run"] = datetime.now().isoformat(timespec="seconds")
                    plans[plan_index]["last_attempt_key"] = f"manual:{datetime.now().isoformat(timespec='seconds')}"
                    save_config(self.config_path, self.config)
                    self.exchange_scheduler.reload(self.config)
            raise
        finally:
            self.exchange_scheduler.clear_progress(plan_index)

        is_ok = bool(result.get("ok"))
        status_label = "【兑换成功】" if is_ok else "【兑换失败】"
        summary = f"{status_label} {result.get('message', '未知结果')}(retcode={result.get('retcode')})，请求 {result.get('attempt', 1)} 次"
        with self.lock:
            plans = self.config.get("shop_exchange", {}).get("plans") or []
            if plan_index < len(plans):
                plans[plan_index]["last_result"] = summary
                plans[plan_index]["last_run"] = datetime.now().isoformat(timespec="seconds")
                plans[plan_index]["last_attempt_key"] = f"manual:{datetime.now().isoformat(timespec='seconds')}"
                if is_ok:
                    plans[plan_index]["enable"] = False
                save_config(self.config_path, self.config)
                self.exchange_scheduler.reload(self.config)
        self.log(f"手动商品兑换计划完成 {plan_index + 1}: {goods_name}，{summary}", "exchange")
        return result

    def run_shop_exchange_plan(self, plan_index: int) -> None:
        with self.lock:
            plans = self.config.get("shop_exchange", {}).get("plans") or []
            if plan_index < 0 or plan_index >= len(plans):
                raise ValueError("兑换计划不存在")
            plan = copy.deepcopy(plans[plan_index])
            goods_name = plan.get("goods_name") or plan.get("goods_id")
            exchange_at = int(plan.get("exchange_at") or 0)
            plans[plan_index]["last_attempt_key"] = f"{plan.get('goods_id', '')}:{exchange_at}"
            plans[plan_index]["last_run"] = datetime.now().isoformat(timespec="seconds")
            save_config(self.config_path, self.config)
        self.log(f"开始执行商品兑换计划: {goods_name}", "exchange")
        try:
            result = self.shop_exchange_once(
                plan,
                on_progress=lambda attempt, msg: self.exchange_scheduler.update_progress(
                    plan_index, attempt=attempt, message=msg
                ),
                trigger="exchange_plan",
            )
        except Exception as exc:
            summary = f"【兑换失败】异常: {exc}"
            with self.lock:
                plans = self.config.get("shop_exchange", {}).get("plans") or []
                if plan_index < len(plans):
                    plans[plan_index]["last_result"] = summary
                    plans[plan_index]["last_run"] = datetime.now().isoformat(timespec="seconds")
                    save_config(self.config_path, self.config)
            self.exchange_scheduler.reload(self.config)
            raise

        is_ok = bool(result.get("ok"))
        status_label = "【兑换成功】" if is_ok else "【兑换失败】"
        summary = f"{status_label} {result.get('message', '未知结果')}(retcode={result.get('retcode')})，请求 {result.get('attempt', 1)} 次"
        with self.lock:
            plans = self.config.get("shop_exchange", {}).get("plans") or []
            if plan_index < len(plans):
                plans[plan_index]["last_result"] = summary
                plans[plan_index]["last_run"] = datetime.now().isoformat(timespec="seconds")
                if is_ok:
                    plans[plan_index]["enable"] = False
                save_config(self.config_path, self.config)
        self.exchange_scheduler.reload(self.config)
        self.log(f"商品兑换计划完成: {goods_name}，{summary}", "exchange")

    def _plan_account_index(self, plan: dict[str, Any]) -> int:
        """兑换计划所属账号在当前列表里的下标：优先按 stuid 找，避免账号列表变动后指向别的账号。"""
        stuid = str(plan.get("account_stuid") or "").strip()
        if not stuid:
            return int(plan.get("account_index") or 0)
        with self.lock:
            index = find_account_index_by_stuid(self.config.get("accounts") or [], stuid)
        if index is None:
            raise ValueError("兑换计划所属账号已不存在，请重新选择执行账号")
        return index

    def _account_by_index(self, account_index: int) -> dict[str, Any]:
        with self.lock:
            accounts = self.config.get("accounts") or []
            if account_index < 0 or account_index >= len(accounts):
                raise ValueError("请选择已登录账号")
            account = copy.deepcopy(accounts[account_index])
        if not str(account.get("cookie") or "").strip():
            raise ValueError("账号未登录或缺少 cookie")
        return account
