# -*- coding: utf-8 -*-
"""米游签命令入口。

直接执行 `python main.py` 时启动 Web 服务；带参数时交给 CLI 处理。
"""

from __future__ import annotations

import os
import pathlib
import sys

# 优先在最外层入口重定向字节码缓存至根目录 .cache/pycache，避免污染源码树
_root = pathlib.Path(__file__).resolve().parent
_cache_dir = _root / ".cache" / "pycache"
if not sys.pycache_prefix:
    sys.pycache_prefix = str(_cache_dir)
    os.environ["PYTHONPYCACHEPREFIX"] = str(_cache_dir)

from miyouqian.cli import main


if __name__ == "__main__":
    if len(sys.argv) == 1:
        raise SystemExit(main(["serve"]))
    raise SystemExit(main())
