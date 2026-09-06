#!/usr/bin/env python3
"""Select a local WeChat article layout template."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
TEMPLATE_DIR = SKILL_DIR / "templates"
CATALOG_PATH = SKILL_DIR / "template-catalog.json"


def templates() -> list[Path]:
    return sorted(TEMPLATE_DIR.glob("*.html"), key=lambda path: path.name)


def template_labels() -> dict[str, str]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {filename: entry["label"] for entry in catalog for filename in entry["files"]}


def main() -> int:
    parser = argparse.ArgumentParser(description="随机选择一个微信公众号排版模板")
    parser.add_argument("--list", action="store_true", help="列出全部模板的中文名称与文件映射")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出选择结果")
    parser.add_argument("--seed", type=int, help="固定随机种子，便于复现验收")
    parser.add_argument("--template", help="指定模板文件名，跳过随机选择")
    args = parser.parse_args()

    files = templates()
    if not files:
        parser.error(f"模板目录为空：{TEMPLATE_DIR}")
    labels = template_labels()
    if args.list:
        style_count = len({labels.get(path.name, path.stem) for path in files})
        print(f"共 {len(files)} 个模板文件，{style_count} 种排版")
        for path in files:
            print(f"{labels.get(path.name, path.stem)}\t{path.name}")
        return 0

    if args.template:
        chosen = TEMPLATE_DIR / args.template
        if chosen not in files:
            parser.error(f"模板不存在：{args.template}")
    else:
        chooser = random.Random(args.seed)
        chosen = chooser.choice(files)

    result = {
        "filename": chosen.name,
        "path": str(chosen),
        "size": chosen.stat().st_size,
        "label": labels.get(chosen.name, chosen.stem),
    }
    if args.json or not args.list:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
