# -*- coding: utf-8 -*-
"""米游签：精简的米游社签到工具。"""

from __future__ import annotations

import os
import pathlib
import sys

# 统一将 Python 字节码缓存重定向至根目录 .cache/pycache，避免污染源码树
if not sys.pycache_prefix:
    _root = pathlib.Path(__file__).resolve().parent.parent
    _cache_dir = _root / ".cache" / "pycache"
    sys.pycache_prefix = str(_cache_dir)
    os.environ["PYTHONPYCACHEPREFIX"] = str(_cache_dir)

__version__ = "0.1.0"
