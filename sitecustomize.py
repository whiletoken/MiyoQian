# -*- coding: utf-8 -*-
"""Python 全局运行时初始化。

在任何模块（包括 pytest、主程序及脚本）加载前，自动将字节码缓存（.pyc）
统一重定向至最外层的 .cache/pycache 目录，避免污染任何源码和测试目录。
"""

from __future__ import annotations

import os
import pathlib
import sys

_root = pathlib.Path(__file__).resolve().parent
_cache_dir = _root / ".cache" / "pycache"

if not sys.pycache_prefix:
    sys.pycache_prefix = str(_cache_dir)
    os.environ["PYTHONPYCACHEPREFIX"] = str(_cache_dir)
