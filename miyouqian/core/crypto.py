# -*- coding: utf-8 -*-
"""米游社请求签名工具。"""

from __future__ import annotations

import hashlib
import json
import random
import string
import time
import uuid
from typing import Any

from .. import constants as c


def md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def random_text(length: int) -> str:
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(length))


def ds(web: bool = False) -> str:
    salt = c.BBS_WEB_SALT if web else c.BBS_SALT
    t = str(int(time.time()))
    r = random_text(6)
    sign = md5(f"salt={salt}&t={t}&r={r}")
    return f"{t},{r},{sign}"


def _ds_v2(salt: str, query: str = "", body: str = "", rand: str | None = None) -> str:
    t = str(int(time.time()))
    r = rand if rand is not None else str(random.randint(100001, 200000))
    sign = md5(f"salt={salt}&t={t}&r={r}&b={body}&q={query}")
    return f"{t},{r},{sign}"


def ds_x6(query: str = "", body: str = "") -> str:
    return _ds_v2(c.BBS_X6_SALT, query=query, body=body)


def ds_x4(query: str = "", body: str = "") -> str:
    return _ds_v2(c.PASSPORT_X4_SALT, query=query, body=body, rand=str(random.randint(100000, 200000)))


def ds_app(body: str = "", query: str = "") -> str:
    return _ds_v2(c.PASSPORT_APP_SALT, query=query, body=body or "")


def ds_passport(body: str = "", query: str = "") -> str:
    """生成米哈游通行证 V2 换票接口（ma-cn-session/app/exchange）所需的 DS 签名。"""
    return _ds_v2(c.PASSPORT_EXCHANGE_SALT, query=query, body=body, rand=random_text(6))


def device_id(seed: str | None = None) -> str:
    if seed:
        return str(uuid.uuid3(uuid.NAMESPACE_URL, seed)).upper()
    return str(uuid.uuid4()).upper()


def device_fp() -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(13))
