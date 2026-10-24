# -*- coding: utf-8 -*-
"""WebUI 前端模块打包器。

将 miyouqian/webui/src/ 下的独立功能模块组装为统一的 miyouqian/webui/app.js，
兼顾模块化开发维护性与浏览器零依赖运行、Node.js 自动化测试。
"""

from __future__ import annotations

import pathlib

MODULE_ORDER = [
    "constants.js",
    "utils.js",
    "config_view.js",
    "accounts_view.js",
    "shop_view.js",
    "login_view.js",
    "records_view.js",
    "main.js",
]

WEBUI_DIR = pathlib.Path(__file__).resolve().parent
SRC_DIR = WEBUI_DIR / "src"
DIST_FILE = WEBUI_DIR / "app.js"


def bundle() -> str:
    """按顺序拼装 src/ 下所有模块，生成 app.js。"""
    parts: list[str] = [
        "// ===========================================================================",
        "// 米游签 Web 控制台前端脚本 (由 miyouqian/webui/src/ 自动构建)",
        "// 模块源码位于 miyouqian/webui/src/，请勿在此单文件直接新增业务逻辑！",
        "// ===========================================================================\n",
    ]
    for module_name in MODULE_ORDER:
        file_path = SRC_DIR / module_name
        if not file_path.exists():
            raise FileNotFoundError(f"Missing module file: {file_path}")
        content = file_path.read_text(encoding="utf-8").strip()
        parts.append(f"\n// --- Module: {module_name} ---\n{content}\n")

    bundled_code = "\n".join(parts)
    DIST_FILE.write_text(bundled_code, encoding="utf-8")
    return bundled_code


def ensure_bundled() -> None:
    """如果 src/ 中任一模块比 app.js 更新，或者 app.js 不存在，则自动执行构建。"""
    if not DIST_FILE.exists():
        bundle()
        return
    dist_mtime = DIST_FILE.stat().st_mtime
    for module_name in MODULE_ORDER:
        file_path = SRC_DIR / module_name
        if file_path.exists() and file_path.stat().st_mtime > dist_mtime:
            bundle()
            return


if __name__ == "__main__":
    bundle()
    print("Bundle complete: miyouqian/webui/app.js")
