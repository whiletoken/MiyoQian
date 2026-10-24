# -*- coding: utf-8 -*-
"""Web 控制台账号登录流程管理（扫码登录与短信验证码登录）。"""

from __future__ import annotations

import base64
import io
import threading
from typing import Any

import qrcode

from ..auth.login import CaptchaLogin, QRLogin, _QrRefreshed
from ..core import cookies
from ..core.config import bind_shop_plan_accounts, log_path, save_config
from ..core.http import ApiClient
from ..core.logs import configure_logger
from .web_diff import display_account_name


def make_qr_data_uri(text: str) -> str:
    """生成二维码 PNG base64 数据 URI。"""
    image = qrcode.make(text)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    encoded = base64.b64encode(stream.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def normalize_cn_phone(phone: str) -> str:
    """提取并校验 11 位国内手机号。"""
    digits = "".join(char for char in str(phone or "") if char.isdigit())
    if len(digits) != 11:
        raise ValueError("请输入 11 位手机号")
    return digits


def find_duplicate_uid(accounts: list[dict[str, Any]], uid: str, exclude_index: int | None = None) -> int | None:
    """查找除排除下标外是否已存在指定 UID。"""
    if not uid:
        return None
    for index, account in enumerate(accounts):
        if exclude_index is not None and index == exclude_index:
            continue
        if str(account.get("stuid") or "").strip() == uid:
            return index
    return None


class WebLoginMixin:
    """登录业务混入类，赋予 WebApp 扫码与验证码登录能力。"""

    config: dict[str, Any]
    config_path: Any
    lock: Any
    log_file: Any
    login_state: dict[str, Any]
    _qr_refresh: threading.Event
    _login_cancel: threading.Event
    _login_generation: int
    scheduler: Any
    exchange_scheduler: Any

    def log(self, message: str, component: str = "web") -> None:
        raise NotImplementedError

    def start_login(
        self,
        account_index: int,
        timeout: int,
        account_payload: dict[str, Any] | None = None,
        draft: bool = False,
    ) -> None:
        with self.lock:
            if self.login_state.get("running"):
                raise RuntimeError("扫码登录正在进行")
            accounts = self.config.get("accounts") or []
            if not draft and (account_index < 0 or account_index >= len(accounts)):
                raise ValueError("请先添加账号")
            account_snapshot = dict(account_payload or {})
            if not draft:
                account_snapshot = dict(accounts[account_index])
            account_name = display_account_name(account_snapshot)
            self.login_state = {
                "running": True,
                "status": "starting",
                "account_index": account_index,
                "account": account_name,
                "draft": draft,
                "message": "正在生成二维码",
                "qr": "",
            }
            self._qr_refresh.clear()
            self._login_cancel.clear()
            self._login_generation += 1
            generation = self._login_generation
        thread = threading.Thread(
            target=self._login_worker,
            args=(account_index, timeout, account_snapshot, draft, generation),
            name="miyouqian-web-login",
            daemon=True,
        )
        thread.start()
        self.log(f"账号 {account_name} 开始扫码登录", "auth")

    def send_login_captcha(
        self,
        account_index: int,
        phone: str,
        account_payload: dict[str, Any] | None = None,
        draft: bool = False,
        aigis: str = "",
    ) -> dict[str, str]:
        phone = normalize_cn_phone(phone)
        account_snapshot, account_name = self._login_account_snapshot(account_index, account_payload, draft)
        with self.lock:
            if self.login_state.get("running"):
                raise RuntimeError("扫码登录正在进行")
            device = dict(self.config["device"])
        with ApiClient() as client:
            login = CaptchaLogin(
                client,
                str(device["id"]),
                str(device["fp"]),
                str(device.get("model") or "Mi 14"),
                str(device.get("name") or "Mihoyo Capture"),
            )
            result = login.create_captcha(phone, aigis)
        self.log(f"账号 {account_name} 已发送验证码", "auth")
        return result

    def complete_login_captcha(
        self,
        account_index: int,
        phone: str,
        captcha: str,
        action_type: str,
        account_payload: dict[str, Any] | None = None,
        draft: bool = False,
        aigis: str = "",
    ) -> dict[str, Any]:
        phone = normalize_cn_phone(phone)
        captcha = str(captcha or "").strip()
        action_type = str(action_type or "").strip()
        if not captcha:
            raise ValueError("请输入短信验证码")
        if not action_type:
            raise ValueError("请先发送短信验证码")
        account_snapshot, account_name = self._login_account_snapshot(account_index, account_payload, draft)
        with self.lock:
            if self.login_state.get("running"):
                raise RuntimeError("扫码登录正在进行")
            device = dict(self.config["device"])
        with ApiClient() as client:
            login = CaptchaLogin(
                client,
                str(device["id"]),
                str(device["fp"]),
                str(device.get("model") or "Mi 14"),
                str(device.get("name") or "Mihoyo Capture"),
            )
            token_data = login.login_by_mobile_captcha(phone, captcha, action_type, aigis)
            account_data = self._complete_login_data(login, token_data)
        account = self._save_login_account(account_index, account_snapshot, account_data, draft)
        account_name = display_account_name(account)
        if draft:
            self.log(f"账号 {account_name} 验证码登录成功，等待保存", "auth")
        else:
            self.log(f"账号 {account_name} 验证码登录成功，凭证已保存", "auth")
        return {
            "account_index": account_index,
            "draft": draft,
            "message": f"账号 {account_name} 登录成功" + ("，请保存账号" if draft else ""),
            "account_data": account_data,
        }

    def _login_account_snapshot(
        self,
        account_index: int,
        account_payload: dict[str, Any] | None,
        draft: bool,
    ) -> tuple[dict[str, Any], str]:
        with self.lock:
            accounts = self.config.get("accounts") or []
            if not draft and (account_index < 0 or account_index >= len(accounts)):
                raise ValueError("请先添加账号")
            account_snapshot = dict(account_payload or {})
            if not draft:
                account_snapshot = dict(accounts[account_index])
            account_name = display_account_name(account_snapshot)
        return account_snapshot, account_name

    def _complete_login_data(self, login: QRLogin | CaptchaLogin, token_data: dict[str, str]) -> dict[str, str]:
        account_data = {**token_data, **login.get_additional_tokens(token_data["stoken"], token_data["mid"])}
        account_data["cookie"] = cookies.build_cookie(
            account_data["stuid"],
            account_data["mid"],
            account_data["ltoken"],
            account_data["cookie_token"],
        )
        return account_data

    def _save_login_account(
        self,
        account_index: int,
        account_snapshot: dict[str, Any],
        account_data: dict[str, str],
        draft: bool,
    ) -> dict[str, Any]:
        with self.lock:
            new_uid = str(account_data.get("stuid") or "").strip()
            duplicate = find_duplicate_uid(self.config.get("accounts") or [], new_uid, None if draft else account_index)
            if duplicate is not None:
                raise ValueError(f"UID {new_uid} 已存在，不能重复添加同一账号")
            account = {**account_snapshot, **account_data}
            if not str(account.get("name") or "").strip():
                account["name"] = account_data["stuid"]
            if not draft:
                self.config["accounts"][account_index] = account
                bind_shop_plan_accounts(self.config)
                save_config(self.config_path, self.config)
                self.log_file = log_path(self.config_path, self.config)
                configure_logger(self.log_file)
                self.scheduler.reload(self.config)
                self.exchange_scheduler.reload(self.config)
        return account

    def _login_worker(
        self,
        account_index: int,
        timeout: int,
        account_snapshot: dict[str, Any],
        draft: bool,
        generation: int,
    ) -> None:
        try:
            if self._login_cancel.is_set():
                return
            with self.lock:
                device = dict(self.config["device"])
                account_name = display_account_name(account_snapshot)
            with ApiClient() as client:
                login = QRLogin(
                    client,
                    str(device["id"]),
                    str(device["fp"]),
                    str(device.get("model") or "Mi 14"),
                    str(device.get("name") or "Mihoyo Capture"),
                )
                url, ticket = login.fetch()
                qr = make_qr_data_uri(url)
                with self.lock:
                    self.login_state.update(
                        {
                            "status": "waiting",
                            "message": "等待扫码确认",
                            "qr": qr,
                            "qr_url": url,
                        }
                    )
                self.log(f"账号 {account_name} 等待扫码登录", "auth")
                scan = self._wait_with_refresh(login, ticket, timeout, account_name)
                if self._login_cancel.is_set():
                    return
                with self.lock:
                    self.login_state.update({"status": "exchanging", "message": "正在获取完整凭证"})
                account_data = self._complete_login_data(login, scan)
            account = self._save_login_account(account_index, account_snapshot, account_data, draft)
            with self.lock:
                account_name = display_account_name(account)
                if self._login_generation == generation:
                    self.login_state.update(
                        {
                            "running": False,
                            "status": "success",
                            "message": f"账号 {account_name} 登录成功" + ("，请保存账号" if draft else ""),
                            "qr": "",
                            "account_data": account_data,
                        }
                    )
            if draft:
                self.log(f"账号 {account_name} 登录成功，等待保存", "auth")
            else:
                self.log(f"账号 {account_name} 登录成功，凭证已保存", "auth")
        except Exception as exc:
            with self.lock:
                if self._login_generation == generation:
                    self.login_state.update(
                        {
                            "running": False,
                            "status": "error",
                            "message": str(exc),
                            "qr": "",
                        }
                    )
            self.log(f"扫码登录失败: {exc}", "auth")

    def _wait_with_refresh(self, login: QRLogin, ticket: str, timeout: int, account_name: str) -> dict[str, str]:
        while True:
            if self._login_cancel.is_set():
                raise RuntimeError("登录已取消")
            try:
                return login.wait(ticket, timeout=timeout, cancel=self._qr_refresh, cancel_events=[self._login_cancel])
            except _QrRefreshed:
                if self._login_cancel.is_set():
                    raise RuntimeError("登录已取消")
                self._qr_refresh.clear()
                self.log(f"账号 {account_name} 刷新二维码", "auth")
                url, ticket = login.fetch()
                qr = make_qr_data_uri(url)
                with self.lock:
                    self.login_state.update(
                        {
                            "status": "waiting",
                            "message": "等待扫码确认",
                            "qr": qr,
                            "qr_url": url,
                        }
                    )

    def refresh_login_qr(self) -> None:
        with self.lock:
            if not self.login_state.get("running"):
                raise RuntimeError("当前没有进行中的登录")
            if self.login_state.get("status") != "waiting":
                raise RuntimeError("当前不在等待扫码状态")
        self._qr_refresh.set()

    def cancel_login(self) -> None:
        with self.lock:
            if not self.login_state.get("running"):
                raise RuntimeError("当前没有进行中的登录")
            self.login_state.update(
                {
                    "running": False,
                    "status": "error",
                    "message": "登录流程已取消",
                    "qr": "",
                }
            )
        self._login_cancel.set()
        self.log("登录流程已取消", "auth")
