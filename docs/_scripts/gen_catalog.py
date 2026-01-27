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
from datetime import date, datetime
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
PACKAGE_OUT = DOCS / "01-indices" / "package-docs.json"
PACKAGES_DIR = ROOT / "packages"

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


def sanitize(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    return value


def extract_title(text: str) -> str | None:
    m = H1_RE.search(text)
    return m.group(1).strip() if m else None


def should_include(p: pathlib.Path) -> bool:
    if p.suffix.lower() != ".md":
        return False
    rel = p.relative_to(DOCS)
    if "_templates" in rel.parts:
        return False
    return not any(part in {".venv", "node_modules"} for part in rel.parts)


def build_doc_entries() -> List[Dict[str, Any]]:
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
                "front_matter": sanitize(fm),
            }
        )
    return entries


def build_package_entries() -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    if not PACKAGES_DIR.exists():
        return entries
    package_jsons = sorted(PACKAGES_DIR.rglob("package.json"))
    for pkg_file in package_jsons:
        # Ignore dependency trees inside packages. We only want workspace packages.
        if "node_modules" in pkg_file.parts:
            continue
        pkg_dir = pkg_file.parent
        readme = pkg_dir / "README.md"
        if not readme.exists():
            continue
        text = readme.read_text(encoding="utf-8", errors="ignore")
        entries.append(
            {
                "package": str(pkg_dir.relative_to(PACKAGES_DIR)),
                "path": str(readme.relative_to(ROOT)),
                "title": extract_title(text),
                "front_matter": sanitize(extract_front_matter(text)),
            }
        )
    return entries


def main() -> None:
    OUT.write_text(
        json.dumps(build_doc_entries(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    PACKAGE_OUT.write_text(
        json.dumps(build_package_entries(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
