#!/usr/bin/env python3
"""
Format Markdown pipe tables to have aligned pipes.

Why:
- GitHub Actions runs markdownlint with MD060 enabled by default in some versions/configs.
- MD060 (table-column-style) can require aligned pipes. Many docs use manual tables (Version History).

What it does:
- Finds Markdown pipe tables (a header row followed by a delimiter row).
- Pads cells so `|` positions line up across the table.
- Rewrites the delimiter row to match column widths while preserving :---: alignment markers.

Scope:
- Intended for `docs/**/*.md` and `README.md`.
"""

from __future__ import annotations

import pathlib
import re
from dataclasses import dataclass


ROOT = pathlib.Path(__file__).resolve().parents[1]

TABLE_ROW_RE = re.compile(r"^(?P<indent>\s*)\|.*\|\s*$")
DELIM_CELL_RE = re.compile(r"^:?-{3,}:?$")


def split_row(line: str) -> tuple[str, list[str]]:
    m = TABLE_ROW_RE.match(line)
    if not m:
        raise ValueError("not a table row")
    indent = m.group("indent")
    raw = line.strip()
    # Remove leading/trailing pipe and split.
    inner = raw[1:-1]
    cells = [c.strip() for c in inner.split("|")]
    return indent, cells


def is_delimiter_row(cells: list[str]) -> bool:
    return all(DELIM_CELL_RE.match(c or "") for c in cells)


def render_delimiter_cell(width: int, template: str) -> str:
    width = max(3, width)
    left = template.startswith(":")
    right = template.endswith(":")
    if left and right:
        # :---:
        return ":" + ("-" * max(1, width - 2)) + ":"
    if left:
        # :---
        return ":" + ("-" * max(2, width - 1))
    if right:
        # ---:
        return ("-" * max(2, width - 1)) + ":"
    return "-" * width


@dataclass
class Table:
    start: int
    end: int
    indent: str
    rows: list[list[str]]
    delim: list[str]


def find_tables(lines: list[str]) -> list[Table]:
    tables: list[Table] = []
    i = 0
    while i < len(lines) - 1:
        if not TABLE_ROW_RE.match(lines[i]) or not TABLE_ROW_RE.match(lines[i + 1]):
            i += 1
            continue

        try:
            indent1, header = split_row(lines[i])
            indent2, delim = split_row(lines[i + 1])
        except ValueError:
            i += 1
            continue

        # Only treat as a table if the second row is a delimiter row and indents match.
        if indent1 != indent2 or not is_delimiter_row(delim) or len(header) != len(delim):
            i += 1
            continue

        rows = [header]
        j = i + 2
        while j < len(lines) and TABLE_ROW_RE.match(lines[j]):
            try:
                indentj, cells = split_row(lines[j])
            except ValueError:
                break
            if indentj != indent1:
                break
            # Stop if row has different column count (not a well-formed table).
            if len(cells) != len(header):
                break
            rows.append(cells)
            j += 1

        tables.append(Table(start=i, end=j, indent=indent1, rows=rows, delim=delim))
        i = j
    return tables


def format_table(t: Table) -> list[str]:
    widths = [0] * len(t.rows[0])
    for r in t.rows:
        for idx, cell in enumerate(r):
            widths[idx] = max(widths[idx], len(cell))

    # Render header/body
    out: list[str] = []
    for r in t.rows:
        padded = [cell.ljust(widths[idx]) for idx, cell in enumerate(r)]
        out.append(f"{t.indent}| " + " | ".join(padded) + " |")

    # Render delimiter based on original delimiter style.
    delim_cells = [render_delimiter_cell(widths[idx], tmpl) for idx, tmpl in enumerate(t.delim)]
    out.insert(1, f"{t.indent}| " + " | ".join(delim_cells) + " |")
    return out


def format_file(path: pathlib.Path) -> bool:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    tables = find_tables(lines)
    if not tables:
        return False

    # Apply from bottom to top to keep indices stable.
    changed = False
    for t in reversed(tables):
        formatted = format_table(t)
        before = lines[t.start : t.end]
        if before != formatted:
            lines[t.start : t.end] = formatted
            changed = True

    if changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return changed


def main() -> None:
    targets: list[pathlib.Path] = []
    readme = ROOT / "README.md"
    if readme.exists():
        targets.append(readme)

    docs = ROOT / "docs"
    targets.extend(sorted(p for p in docs.rglob("*.md") if "_templates" not in p.parts))

    changed = 0
    for p in targets:
        if format_file(p):
            changed += 1
    print(f"formatted {changed} file(s)")


if __name__ == "__main__":
    main()
