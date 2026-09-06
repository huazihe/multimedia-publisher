#!/usr/bin/env python3
"""Static checks for a finished WeChat layout HTML file."""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


PLACEHOLDER_PATTERNS = (
    r"此处为",
    r"此处放",
    r"文章主标题",
    r"副标题或",
    r"正文区域",
    r"正文内容",
    r"配图位",
    r"替换为实际",
    r"示例正文",
)


class VisibleBodyText(HTMLParser):
    """Collect body text, excluding CSS, scripts, inert markup and comments."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_body = False
        self.ignored = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.in_body = True
        if tag in {"head", "style", "script", "template", "noscript"}:
            self.ignored.append(tag)

    def handle_endtag(self, tag):
        if self.ignored and tag == self.ignored[-1]:
            self.ignored.pop()
        if tag == "body":
            self.in_body = False

    def handle_data(self, data):
        if self.in_body and not self.ignored:
            self.parts.append(data)


def check(path: Path) -> dict:
    if not path.is_file():
        return {"ok": False, "errors": [f"文件不存在：{path}"]}
    text = path.read_text(encoding="utf-8-sig")
    errors = []
    lower = text.lower()
    for required in ("<!doctype html", "<html", "<head", "<body", "</html>"):
        if required not in lower:
            errors.append(f"缺少 HTML 结构：{required}")
    visible = VisibleBodyText()
    visible.feed(text)
    for pattern in PLACEHOLDER_PATTERNS:
        if re.search(pattern, "".join(visible.parts), re.IGNORECASE):
            errors.append(f"仍有模板占位内容：{pattern}")
    if re.search(r"(?:src|href)=[\"'](?:/Users/|/home/|[A-Za-z]:[\\/])", text, re.IGNORECASE):
        errors.append("存在本机绝对路径资源引用")
    image_count = len(re.findall(r"<img\b", text, re.IGNORECASE))
    for source in re.findall(r"<img\b[^>]*\bsrc=[\"']([^\"']+)[\"']", text, re.IGNORECASE):
        if not source.startswith("data:"):
            errors.append(f"图片没有内嵌为 data URL：{source[:80]}")
    return {"ok": not errors, "file": str(path.resolve()), "bytes": len(text.encode("utf-8")), "image_tags": image_count, "errors": errors}


def main() -> int:
    parser = argparse.ArgumentParser(description="检查公众号排版 HTML")
    parser.add_argument("html")
    args = parser.parse_args()
    result = check(Path(args.html))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["ok"]:
        for error in result["errors"]:
            print(f"错误：{error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
