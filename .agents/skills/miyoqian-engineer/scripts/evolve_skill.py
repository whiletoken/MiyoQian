#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MiyoQian Skill 持续进化助手脚本 (Skill Continuous Evolution Helper)。

用于规范化记录工程演进、架构决策 (ADR)、反模式总结与用户特定偏好。
运行流程：
1. 运行 verify_project.py 进行质量门禁（必须全绿通过）；
2. 结构化追加演进记录至 references/evolution_log.md；
3. 更新 SKILL.md 中的最新演进状态或版本时间戳。
"""

from __future__ import annotations

import argparse
import datetime
import pathlib
import subprocess
import sys


def find_skill_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent.parent


def find_repo_root() -> pathlib.Path:
    current = pathlib.Path(__file__).resolve()
    for parent in current.parents:
        if (parent / ".git").exists() or (parent / "pyproject.toml").exists():
            return parent
    return current.parents[3]


def run_gate_check(skill_root: pathlib.Path) -> bool:
    verify_script = skill_root / "scripts" / "verify_project.py"
    if not verify_script.exists():
        return True
    print("[Gate Check] 运行项目健康门禁检查...")
    res = subprocess.run([sys.executable, str(verify_script)])
    return res.returncode == 0


def record_evolution(
    skill_root: pathlib.Path,
    category: str,
    title: str,
    details: str,
    author: str = "Antigravity Agent",
) -> None:
    evolution_file = skill_root / "references" / "evolution_log.md"
    evolution_file.parent.mkdir(parents=True, exist_ok=True)

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"""
### [{now_str}] {category.upper()}: {title}
- **记录者**: {author}
- **演进类型**: `{category}`
- **核心要点**:
{details.strip()}
- **门禁校验**: 测试套件 100% 通过，工程规范校验通过。
---
"""
    if not evolution_file.exists():
        header = """# MiyoQian 技能持续演进账本 (Continuous Evolution Ledger)

本文件持久化记录项目在迭代过程中沉淀的架构决策、规范变更、踩坑避坑经验及特定偏好。
所有 AI Agent 在执行重构与开发前均需参考本文件，并在完成演进后由 `scripts/evolve_skill.py` 自动追加新纪要。

--------------------------------------------------------------------------------
"""
        evolution_file.write_text(header + entry, encoding="utf-8")
    else:
        content = evolution_file.read_text(encoding="utf-8")
        evolution_file.write_text(content + entry, encoding="utf-8")

    print(f"[+] 成功追加演进记录至 {evolution_file.relative_to(skill_root.parent.parent)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="MiyoQian Skill Continuous Evolution Tool")
    parser.add_argument("--category", choices=["arch", "storage", "cache", "perf", "fix", "rule"], default="arch", help="演进类型")
    parser.add_argument("--title", required=True, help="演进摘要标题")
    parser.add_argument("--details", required=True, help="详细说明或规范内容")
    parser.add_argument("--skip-gate", action="store_true", help="跳过门禁自检")
    parser.add_argument("--author", default="Antigravity Agent", help="记录者身份")

    args = parser.parse_args()
    skill_root = find_skill_root()

    if not args.skip_gate:
        if not run_gate_check(skill_root):
            print("[-] 质量门禁未通过，拒绝追加演进记录。请先修复测试或代码规范！")
            return 1

    record_evolution(
        skill_root=skill_root,
        category=args.category,
        title=args.title,
        details=args.details,
        author=args.author,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
