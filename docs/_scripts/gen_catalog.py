#!/usr/bin/env python3
"""
Generate docs/01-indices/catalog.json from YAML front matter in the docs tree.

Catalog entries include: path, title (from first H1 if present), and front matter fields.
Runs quickly and ignores node_modules/.venv. Intended to be called before mkdocs build.
"""
from __future__ import annotations
import json
import pathlib
import re
from typing import Dict, Any, List

try:
    import yaml  # type: ignore
except Exception as exc:
    raise SystemExit(
        "PyYAML is required. Install with: python -m pip install pyyaml"
    ) from exc

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
OUT = DOCS / "01-indices" / "catalog.json"

YAML_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)


def extract_front_matter(text: str) -> Dict[str, Any]:
    m = YAML_RE.match(text)
    if not m:
        return {}
    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return {}


def extract_title(text: str) -> str | None:
    m = H1_RE.search(text)
    return m.group(1).strip() if m else None


def should_include(p: pathlib.Path) -> bool:
    if p.suffix.lower() != ".md":
        return False
    # Exclude top-level package READMEs unless referenced by nav separately
    rel = p.relative_to(DOCS)
    return True and not any(part in {".venv", "node_modules"} for part in rel.parts)


def main() -> None:
    entries: List[Dict[str, Any]] = []
    for md in DOCS.rglob("*.md"):
        if not should_include(md):
            continue
        text = md.read_text(encoding="utf-8", errors="ignore")
        fm = extract_front_matter(text)
        title = extract_title(text)
        entries.append(
            {
                "path": str(md.relative_to(DOCS)),
                "title": title,
                "front_matter": fm,
            }
        )
    OUT.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

