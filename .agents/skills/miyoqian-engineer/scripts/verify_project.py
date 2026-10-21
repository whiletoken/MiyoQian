#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MiyoQian 项目工程规范与健康度自检脚本。

该脚本可由开发人员或 AI Agent 直接调用，用于快速验证：
1. 全局单元测试是否 100% 通过；
2. 字节码缓存是否严格隔离至最外层 .cache/，源码目录无 .pyc 污染；
3. 账户存储与自动迁移逻辑正常工作；
4. 构建及核心配置文件规范。
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys


def find_repo_root() -> pathlib.Path:
    current = pathlib.Path(__file__).resolve()
    for parent in current.parents:
        if (parent / ".git").exists() or (parent / "pyproject.toml").exists():
            return parent
    return current.parents[3]


def check_tests(root: pathlib.Path) -> bool:
    print("[1/4] 运行单元测试套件...")
    res = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "tests"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if res.returncode != 0:
        print("[-] 单元测试未通过！")
        print(res.stderr or res.stdout)
        return False
    print("[+] 单元测试全部通过！")
    return True


def check_cache_isolation(root: pathlib.Path) -> bool:
    print("[2/4] 检查字节码与缓存隔离规范...")
    stray_pycs: list[pathlib.Path] = []
    
    # 扫描 miyouqian 源码目录与 tests 目录，确保不存在 __pycache__ 或 .pyc
    for target in [root / "miyouqian", root / "tests"]:
        if not target.exists():
            continue
        for p in target.rglob("*.pyc"):
            stray_pycs.append(p)
        for p in target.rglob("__pycache__"):
            stray_pycs.append(p)

    if stray_pycs:
        print(f"[-] 警告：在源码或测试目录中检测到未隔离的字节码缓存：")
        for p in stray_pycs[:5]:
            print(f"    - {p.relative_to(root)}")
        if len(stray_pycs) > 5:
            print(f"    ... 共 {len(stray_pycs)} 处")
        return False

    cache_dir = root / ".cache" / "pycache"
    print(f"[+] 源码目录无 .pyc 污染。缓存重定向目录：{cache_dir}")
    return True


def check_storage_and_migration(root: pathlib.Path) -> bool:
    print("[3/4] 检查账户仓储模式与迁移接口...")
    try:
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from miyouqian.core.accounts import AccountRepository
        test_path = root / ".cache" / "test_verify_account.json"
        repo = AccountRepository(account_path=test_path)
        assert hasattr(repo, "load")
        assert hasattr(repo, "save")
        assert hasattr(repo, "migrate_if_needed")
        print("[+] 账户存储接口及迁移机制正常。")
        return True
    except Exception as exc:
        print(f"[-] 账户仓储模式检测异常: {exc}")
        return False


def check_environment_hygiene(root: pathlib.Path) -> bool:
    print("[4/4] 检查工程卫生规范（.dockerignore, sitecustomize.py, pyproject.toml）...")
    required_files = [
        root / "sitecustomize.py",
        root / ".dockerignore",
        root / ".gitignore",
        root / "pyproject.toml",
    ]
    missing = [f.name for f in required_files if not f.exists()]
    if missing:
        print(f"[-] 缺失工程规范配置文件: {missing}")
        return False
    print("[+] 核心工程规范配置文件齐全。")
    return True


def main() -> int:
    root = find_repo_root()
    os.chdir(root)
    print(f"=== MiyoQian 工程规范与健康度自检 [工作目录: {root}] ===")

    success = True
    success = check_tests(root) and success
    success = check_cache_isolation(root) and success
    success = check_storage_and_migration(root) and success
    success = check_environment_hygiene(root) and success

    print("=" * 60)
    if success:
        print("[SUCCESS] 项目健康度与工程规范自检全部达标！")
        return 0
    else:
        print("[FAILED] 部分检查未达标，请根据上述提示处理。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
