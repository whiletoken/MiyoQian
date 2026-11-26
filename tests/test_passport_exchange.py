# -*- coding: utf-8 -*-
"""通行证 V2 换票接口与 Cookie V2 字段生成测试。"""

import json
import unittest
from typing import Any

import httpx

from miyouqian import constants as c
from miyouqian.auth.login import PassportLogin, refresh_cookie_token
from miyouqian.core import cookies, crypto
from miyouqian.core.http import ApiClient


class _FakeClient:
    def __init__(self, responses: list[dict[str, Any]] | None = None) -> None:
        self.responses = list(responses or [])
        self.post_calls: list[tuple[str, bytes, dict[str, str]]] = []
        self.get_calls: list[tuple[str, dict[str, str]]] = []

    def post_json(self, url: str, **kwargs: Any) -> dict[str, Any]:
        content = kwargs.get("content", b"")
        headers = kwargs.get("headers") or {}
        self.post_calls.append((url, content, headers))
        return self.responses.pop(0)

    def get_json(self, url: str, **kwargs: Any) -> dict[str, Any]:
        headers = kwargs.get("headers") or {}
        self.get_calls.append((url, headers))
        return self.responses.pop(0)


class PassportExchangeTest(unittest.TestCase):
    def test_get_additional_tokens_uses_v2_exchange_endpoint(self) -> None:
        client = _FakeClient(
            [
                {"retcode": 0, "message": "OK", "data": {"token": {"token_type": 2, "token": "v2_ltoken_abc"}}},
                {"retcode": 0, "message": "OK", "data": {"token": {"token_type": 4, "token": "v2_ck_xyz"}}},
            ]
        )
        login = PassportLogin(client, "DEV-UUID", "fp123", "Mi 14", "Mihoyo Capture")  # type: ignore[arg-type]

        tokens = login.get_additional_tokens("v2_stoken_123", "mid_456")

        self.assertEqual({"ltoken": "v2_ltoken_abc", "cookie_token": "v2_ck_xyz"}, tokens)
        self.assertEqual(2, len(client.post_calls))

        for index, expected_dst in enumerate((2, 4)):
            url, raw_body, headers = client.post_calls[index]
            self.assertEqual(c.TOKEN_EXCHANGE_URL, url)
            body_str = raw_body.decode("utf-8")
            self.assertEqual(
                {
                    "dst_token_type": expected_dst,
                    "src_token": {"token": "v2_stoken_123", "token_type": 1},
                    "mid": "mid_456",
                },
                json.loads(body_str),
            )
            self.assertNotIn(" ", body_str)
            self.assertEqual(c.PASSPORT_APP_ID, headers["x-rpc-app_id"])
            self.assertEqual("2", headers["x-rpc-client_type"])
            self.assertEqual("DEV-UUID", headers["x-rpc-device_id"])
            self.assertEqual("fp123", headers["x-rpc-device_fp"])
            self.assertEqual("okhttp/4.9.3", headers["User-Agent"])

            t_str, r_str, sign = headers["DS"].split(",")
            self.assertEqual(6, len(r_str))
            expected_sign = crypto.md5(f"salt={c.PASSPORT_EXCHANGE_SALT}&t={t_str}&r={r_str}&b={body_str}&q=")
            self.assertEqual(expected_sign, sign)

    def test_exchange_error_raises_clear_message(self) -> None:
        client = _FakeClient([{"retcode": -100, "message": "登录状态失效，请重新登录"}])
        login = PassportLogin(client, "DEV-UUID", "")  # type: ignore[arg-type]

        with self.assertRaises(RuntimeError) as ctx:
            login.get_additional_tokens("v2_bad", "mid_456")
        self.assertIn("stoken 换 ltoken 失败: retcode=-100", str(ctx.exception))

    def test_exchange_requires_mid(self) -> None:
        client = _FakeClient()
        login = PassportLogin(client, "DEV-UUID", "")  # type: ignore[arg-type]

        with self.assertRaises(RuntimeError) as ctx:
            login.get_additional_tokens("v2_stoken", "")
        self.assertIn("缺少 mid", str(ctx.exception))
        self.assertEqual([], client.post_calls)

    def test_build_cookie_includes_both_v1_and_v2_tokens(self) -> None:
        cookie = cookies.build_cookie("10001", "mid_1", "v2_lt", "v2_ck")

        self.assertIn("ltoken=v2_lt", cookie)
        self.assertIn("ltoken_v2=v2_lt", cookie)
        self.assertIn("cookie_token=v2_ck", cookie)
        self.assertIn("cookie_token_v2=v2_ck", cookie)
        self.assertIn("ltmid_v2=mid_1", cookie)
        self.assertIn("account_mid_v2=mid_1", cookie)

    def test_refresh_cookie_token_uses_v2_exchange_and_syncs_v2_cookie(self) -> None:
        client = _FakeClient(
            [{"retcode": 0, "message": "OK", "data": {"token": {"token_type": 4, "token": "new_v2_ck"}}}]
        )
        account = {
            "stuid": "10001",
            "stoken": "v2_st",
            "mid": "mid_1",
            "cookie": cookies.build_cookie("10001", "mid_1", "v2_lt", "old_ck"),
        }

        ok = refresh_cookie_token(client, account, {"id": "dev1", "fp": "fp1"})  # type: ignore[arg-type]

        self.assertTrue(ok)
        self.assertEqual(1, len(client.post_calls))
        self.assertEqual(0, len(client.get_calls))
        self.assertIn("cookie_token=new_v2_ck", account["cookie"])
        self.assertIn("cookie_token_v2=new_v2_ck", account["cookie"])

    def test_refresh_cookie_token_falls_back_to_legacy_when_mid_absent(self) -> None:
        client = _FakeClient([{"retcode": 0, "message": "OK", "data": {"cookie_token": "legacy_ck"}}])
        account = {"stuid": "10001", "stoken": "v1_st", "cookie": "account_id=10001; cookie_token=old"}

        ok = refresh_cookie_token(client, account)  # type: ignore[arg-type]

        self.assertTrue(ok)
        self.assertEqual(0, len(client.post_calls))
        self.assertEqual(1, len(client.get_calls))
        self.assertEqual(c.COOKIE_TOKEN_REFRESH_URL, client.get_calls[0][0])
        self.assertIn("cookie_token=legacy_ck", account["cookie"])
        self.assertIn("cookie_token_v2=legacy_ck", account["cookie"])

    def test_post_exchange_does_not_retry_on_read_timeout(self) -> None:
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("timeout")

        client = ApiClient()
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler))
        login = PassportLogin(client, "DEV-UUID", "fp123")

        with self.assertRaises(Exception):
            login.get_additional_tokens("v2_st", "mid_1")
        self.assertEqual(1, calls)
