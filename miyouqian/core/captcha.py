# -*- coding: utf-8 -*-
"""验证码识别渠道（策略模式与工厂模式）。"""

from __future__ import annotations

import abc
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping

from .http import ApiClient

DAMAGOU_URL = "http://api.damagou.top/apiv1/jiyanRecognize.html"
CUSTOM_DEFAULT_TIMEOUT = 120
CUSTOM_MAX_ATTEMPTS = 3
CUSTOM_MAX_WAIT_SECONDS = 60
CUSTOM_DEFAULT_RETRY_AFTER = 5
# 限流 / 排队类错误：服务端还没开始识别，challenge 没被消耗，可以按 Retry-After 等待后原样重试。
# 50001 / 50000 不在此列：极验的 challenge 用过一次就作废，识别可能已经提交过，
# 原样重发只会被秒拒 (old challenge)，必须交给调用方重新取一个新验证码。
CUSTOM_RETRY_WITH_DELAY = {42901, 50301, 50302}
PROVIDER_LABELS = {
    "damagou": "打码狗",
    "custom": "自定义接口",
}
DAMAGOU_BALANCE_INSUFFICIENT_MESSAGE = "打码狗余额不足，请充值后重试"


@dataclass(frozen=True)
class CaptchaSolution:
    validate: str
    challenge: str


class CaptchaSolver(abc.ABC):
    """验证码识别策略基类（Strategy 模式）。"""

    def __init__(self, channel: dict[str, Any]) -> None:
        self.channel = channel

    @abc.abstractmethod
    def solve(
        self,
        client: ApiClient,
        gt: str,
        challenge: str,
        geetest_success: int | None = None,
        emit: Callable[[str], None] | None = None,
    ) -> CaptchaSolution | None:
        """执行验证码识别。"""


class DamagouCaptchaSolver(CaptchaSolver):
    """打码狗验证码识别策略。"""

    def solve(
        self,
        client: ApiClient,
        gt: str,
        challenge: str,
        geetest_success: int | None = None,
        emit: Callable[[str], None] | None = None,
    ) -> CaptchaSolution | None:
        try:
            params: dict[str, Any] = {
                "userkey": str(self.channel.get("userkey") or "").strip(),
                "gt": gt,
                "challenge": challenge,
                "isJson": "2",
            }
            captcha_type = str(self.channel.get("type") or "").strip()
            if captcha_type:
                params["type"] = captcha_type
            if geetest_success == 0:
                params["success"] = 0
            # 识别请求不做读超时重试：服务端可能已经开始识别（且按次计费），重发会白等数倍时间
            data = client.get_json(
                DAMAGOU_URL,
                params=params,
                timeout=float(self.channel.get("timeout") or 60),
                retries=0,
            )
            if is_damagou_balance_insufficient(data):
                if emit:
                    emit(DAMAGOU_BALANCE_INSUFFICIENT_MESSAGE)
                return None
            solution = _parse_damagou_response(data)
            if not solution and emit:
                emit(f"打码狗验证码识别失败: {data.get('msg') or '未知错误'}")
            return solution
        except Exception as exc:
            if emit:
                emit(f"打码狗验证码识别失败: {exc}")
            return None


class CustomCaptchaSolver(CaptchaSolver):
    """调用遵循《自定义打码接口规范》的服务，规范见 webui/custom-captcha-api.md。"""

    def solve(
        self,
        client: ApiClient,
        gt: str,
        challenge: str,
        geetest_success: int | None = None,
        emit: Callable[[str], None] | None = None,
    ) -> CaptchaSolution | None:
        def fail(reason: str) -> None:
            if emit:
                emit(f"自定义接口验证码识别失败: {reason}")

        try:
            url = str(self.channel.get("url") or "").strip()
            params = {"gt": gt, "challenge": challenge}
            api_key = str(self.channel.get("api_key") or "").strip()
            headers = {"X-API-Key": api_key} if api_key else {}
            timeout = float(self.channel.get("timeout") or CUSTOM_DEFAULT_TIMEOUT)
            for attempt in range(1, CUSTOM_MAX_ATTEMPTS + 1):
                # 读超时不重试，challenge 用过即作废，交给调用方重新取验证码
                data, response_headers = client.get_json_any_status(
                    url, params=params, headers=headers, timeout=timeout, retries=0
                )
                code = _response_code(data)
                if code == 0:
                    solution = _parse_custom_response(data, challenge)
                    if not solution:
                        fail("接口返回成功但缺少 data.validate")
                    return solution
                if attempt < CUSTOM_MAX_ATTEMPTS and code in CUSTOM_RETRY_WITH_DELAY:
                    delay = _retry_after_seconds(response_headers)
                    if delay <= CUSTOM_MAX_WAIT_SECONDS:
                        time.sleep(delay)
                        continue
                fail(_format_custom_error(data, code))
                return None
        except Exception as exc:
            fail(str(exc))
        return None


class CaptchaSolverFactory:
    """验证码识别器工厂（Factory 模式）。"""

    _solvers: dict[str, type[CaptchaSolver]] = {
        "damagou": DamagouCaptchaSolver,
        "custom": CustomCaptchaSolver,
    }

    @classmethod
    def register(cls, provider: str, solver_cls: type[CaptchaSolver]) -> None:
        """注册新的识别器策略，遵循开闭原则。"""
        cls._solvers[provider] = solver_cls

    @classmethod
    def create(cls, channel: dict[str, Any]) -> CaptchaSolver | None:
        provider = str(channel.get("provider") or "").strip()
        solver_cls = cls._solvers.get(provider)
        if not solver_cls:
            return None
        return solver_cls(channel)


def is_enabled(config: dict[str, Any]) -> bool:
    return _active_channel(config) is not None


def active_provider_label(config: dict[str, Any]) -> str:
    channel = _active_channel(config)
    if not channel:
        return "验证码渠道"
    provider = str(channel.get("provider") or "")
    return PROVIDER_LABELS.get(provider, provider or "验证码渠道")


def solve_game_captcha(
    client: ApiClient,
    config: dict[str, Any],
    gt: str,
    challenge: str,
    emit: Callable[[str], None] | None = None,
) -> CaptchaSolution | None:
    channel = _active_channel(config)
    if not channel:
        return None
    solver = CaptchaSolverFactory.create(channel)
    if not solver:
        return None
    return solver.solve(client, gt, challenge, geetest_success=None, emit=emit)


def solve_bbs_captcha(
    client: ApiClient,
    config: dict[str, Any],
    gt: str,
    challenge: str,
    geetest_success: int | None = None,
    emit: Callable[[str], None] | None = None,
) -> CaptchaSolution | None:
    channel = _active_channel(config)
    if not channel:
        return None
    solver = CaptchaSolverFactory.create(channel)
    if not solver:
        return None
    return solver.solve(client, gt, challenge, geetest_success=geetest_success, emit=emit)


def _response_code(data: Mapping[str, Any]) -> int | None:
    try:
        return int(data.get("code"))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _retry_after_seconds(headers: Mapping[str, str]) -> int:
    try:
        return max(int(headers.get("Retry-After", CUSTOM_DEFAULT_RETRY_AFTER)), 1)
    except (TypeError, ValueError):
        return CUSTOM_DEFAULT_RETRY_AFTER


def _format_custom_error(data: Mapping[str, Any], code: int | None) -> str:
    text = f"[{code if code is not None else '?'}] {data.get('message') or '未知错误'}"
    request_id = str(data.get("request_id") or "").strip()
    return f"{text} (request_id={request_id})" if request_id else text


def _parse_custom_response(data: Mapping[str, Any], request_challenge: str) -> CaptchaSolution | None:
    payload = data.get("data")
    if not isinstance(payload, dict):
        return None
    validate = str(payload.get("validate") or "").strip()
    if not validate:
        return None
    # 规范保证 data.challenge 原样回显请求值，缺失时以请求值兜底
    challenge = str(payload.get("challenge") or "").strip() or request_challenge
    return CaptchaSolution(validate=validate, challenge=challenge)


def _channel_configured(channel: Mapping[str, Any]) -> bool:
    provider = str(channel.get("provider") or "")
    if provider == "damagou":
        return bool(str(channel.get("userkey") or "").strip())
    if provider == "custom":
        return bool(str(channel.get("url") or "").strip())
    return False


def _active_channel(config: dict[str, Any]) -> dict[str, Any] | None:
    captcha_config = config.get("captcha", {})
    if not captcha_config.get("enable"):
        return None
    channels = captcha_config.get("channels") or []
    if not isinstance(channels, list):
        return None
    for channel in channels:
        if not isinstance(channel, dict):
            continue
        if channel.get("enable") and _channel_configured(channel):
            return channel
    return None


def _parse_damagou_response(data: dict[str, Any]) -> CaptchaSolution | None:
    if str(data.get("status")) != "0":
        return None
    raw = str(data.get("data") or "")
    if "|" not in raw:
        return None
    challenge, validate = raw.split("|", 1)
    challenge = challenge.strip()
    validate = validate.strip()
    if not challenge or not validate:
        return None
    return CaptchaSolution(validate=validate, challenge=challenge)


def is_damagou_balance_insufficient(data: dict[str, Any]) -> bool:
    """判断打码狗错误信息中是否包含“余额”。"""
    return str(data.get("status")) != "0" and "余额" in str(data)
