#!/usr/bin/env python3
"""
Validate documentation files for:
- YAML front matter presence
- Visible metadata block and Version History section
- Optional: validate docs/01-indices/catalog.json against schema if present

Exits non-zero on violations. Intended for pre-commit and CI.
"""
from __future__ import annotations
import json
import pathlib
import re
import sys
from typing import Tuple

try:
    import yaml  # type: ignore
except Exception as exc:
    print("ERROR: PyYAML is required. Install with: pip install PyYAML", file=sys.stderr)
    raise

try:
    import jsonschema  # type: ignore
except Exception:
    jsonschema = None  # schema validation optional if library missing

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
CATALOG = DOCS / "01-indices" / "catalog.json"
SCHEMA = DOCS / "00-governance" / "catalog.schema.json"

YAML_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
META_BLOCK_RE = re.compile(r"> \*\*Document ID:\*\*|> \*\*Owner:\*\*|> \*\*Status:\*\*", re.IGNORECASE)
VERSION_HIST_RE = re.compile(r"^##\s+Version History\s*$", re.MULTILINE)
TABLE_RE = re.compile(r"^\|\s*Version\s*\|", re.MULTILINE)


def validate_md(md_path: pathlib.Path) -> Tuple[bool, str]:
    text = md_path.read_text(encoding="utf-8", errors="ignore")
    if not YAML_RE.match(text):
        return False, f"{md_path}: missing YAML front matter"
    if not META_BLOCK_RE.search(text):
        return False, f"{md_path}: missing visible metadata block (> **Document ID:** …)"
    if not VERSION_HIST_RE.search(text) or not TABLE_RE.search(text):
        return False, f"{md_path}: missing or incomplete '## Version History' table"
    return True, ""


def validate_catalog() -> Tuple[bool, str]:
    if not CATALOG.exists() or not SCHEMA.exists() or jsonschema is None:
        return True, ""  # skip if not available
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    try:
        jsonschema.validate(data, schema)
        return True, ""
    except Exception as exc:  # pragma: no cover
        return False, f"catalog.json schema validation failed: {exc}"


def main() -> int:
    failures = []
    for md in DOCS.rglob("*.md"):
        # Skip nav/templates readmes that may intentionally differ
        if any(p in {"_templates"} for p in md.parts):
            continue
        ok, msg = validate_md(md)
        if not ok:
            failures.append(msg)
    ok, msg = validate_catalog()
    if not ok:
        failures.append(msg)
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
