#!/usr/bin/env python3
"""Refresh only an explicitly governed AGENTS.md context block."""

import argparse
import difflib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

import yaml


SOURCE_MARKER = "AIDHA_AGENT_CONTEXT_SOURCE"
TARGET_MARKER = "AIDHA_AGENT_CONTEXT"


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate field: {key}")
        result[key] = value
    return result


class UniqueSafeLoader(yaml.SafeLoader):
    pass


def unique_yaml_mapping(loader, node):
    return unique_pairs(
        (loader.construct_object(key), loader.construct_object(value))
        for key, value in node.value
    )


UniqueSafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_yaml_mapping
)


def marker_span(text, marker, required):
    prefix = f"<!-- {marker}:"
    begin = f"{prefix} begin -->"
    end = f"{prefix} end -->"
    if prefix not in text:
        if required:
            raise ValueError(f"Missing {marker} block")
        return None
    starts = list(re.finditer(rf"(?m)^{re.escape(begin)}\r?(?:\n|$)", text))
    ends = list(re.finditer(rf"(?m)^{re.escape(end)}\r?(?:\n|$)", text))
    if (
        text.count(prefix) != 2
        or len(starts) != 1
        or len(ends) != 1
        or starts[0].end() > ends[0].start()
    ):
        raise ValueError(f"Malformed or duplicate {marker} delimiters")
    return starts[0], ends[0]


def read_context(plan):
    text = plan.read_text(encoding="utf-8")
    frontmatter = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
    if not frontmatter:
        raise ValueError("Plan needs governed YAML frontmatter")
    metadata = yaml.load(frontmatter.group(1), Loader=UniqueSafeLoader)
    if not isinstance(metadata, dict) or metadata.get("type") != "PLAN":
        raise ValueError("Explicit source must have type: PLAN")
    if not re.fullmatch(r"AIDHA-PLAN-\d{3}", str(metadata.get("document_id", ""))):
        raise ValueError("Explicit source needs an AIDHA-PLAN-NNN document ID")
    # Full governance remains the responsibility of the existing DocOps checker.
    span = marker_span(text, SOURCE_MARKER, required=True)
    context = json.loads(text[span[0].end() : span[1].start()], object_pairs_hook=unique_pairs)
    fields = {"version", "language", "dependencies", "storage", "project_type"}
    if not isinstance(context, dict) or set(context) != fields:
        raise ValueError("Context needs exactly version, language, dependencies, storage, project_type")
    if type(context["version"]) is not int or context["version"] != 1:
        raise ValueError("Context version must be 1")
    for name in ("language", "project_type"):
        validate_value(context[name], name)
    for name in ("dependencies", "storage"):
        if not isinstance(context[name], list):
            raise ValueError(f"{name} must be an explicit list")
        for value in context[name]:
            validate_value(value, name)
    return context, metadata["document_id"]


def validate_value(value, name):
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value.splitlines()) != 1
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
        or "AIDHA_AGENT_CONTEXT" in value
    ):
        raise ValueError(f"{name} must contain nonblank single-line text without delimiters")


def code_value(value):
    runs = re.findall(r"`+", value)
    fence = "`" * (max(map(len, runs), default=0) + 1)
    return f"{fence} {value} {fence}"


def render(context, document_id, source):
    def items(name):
        return ", ".join(code_value(value) for value in context[name]) or "None declared"

    return (
        f"<!-- {TARGET_MARKER}: begin -->\n"
        "## Generated plan context\n\n"
        f"Source: {code_value(document_id)} ({code_value(source)}).\n\n"
        f"- Language/version: {code_value(context['language'])}\n"
        f"- Dependencies: {items('dependencies')}\n"
        f"- Storage: {items('storage')}\n"
        f"- Project type: {code_value(context['project_type'])}\n"
        f"<!-- {TARGET_MARKER}: end -->\n"
    )


def replace_block(original, generated):
    text = original.decode("utf-8")
    span = marker_span(text, TARGET_MARKER, required=False)
    if span:
        return (text[: span[0].start()] + generated + text[span[1].end() :]).encode("utf-8")
    separator = "" if not text or text.endswith("\n\n") else ("\n" if text.endswith("\n") else "\n\n")
    return original + (separator + generated).encode("utf-8")


def target_snapshot(target):
    if target.is_symlink():
        raise ValueError("Refusing a symlink AGENTS.md")
    try:
        state = target.stat()
    except FileNotFoundError:
        return None, b""
    if not stat.S_ISREG(state.st_mode):
        raise ValueError("AGENTS.md must be a regular file")
    return state, target.read_bytes()


def apply_update(target, original_state, original, updated):
    def identity(state):
        if state is None:
            return None
        return (state.st_dev, state.st_ino, state.st_mode, state.st_size, state.st_mtime_ns, state.st_ctime_ns)

    temporary_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".agent-context-", delete=False) as temporary:
            temporary_name = temporary.name
            temporary.write(updated)
            temporary.flush()
            os.fsync(temporary.fileno())
            os.fchmod(temporary.fileno(), stat.S_IMODE(original_state.st_mode) if original_state else 0o644)
        current_state, current = target_snapshot(target)
        if identity(current_state) != identity(original_state) or current != original:
            raise ValueError("AGENTS.md changed during refresh; preview again")
        os.replace(temporary_name, target)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, help="Explicit governed plan inside docs/05-planning")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--preview", action="store_true", help="Print proposed diff without writing")
    action.add_argument("--write", action="store_true", help="Apply the generated block atomically")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    try:
        requested = Path(args.plan)
        plan = (requested if requested.is_absolute() else root / requested).resolve(strict=True)
        relative = plan.relative_to(root)
        if relative.parts[:2] != ("docs", "05-planning") or plan.suffix != ".md":
            raise ValueError("Plan must be a Markdown file inside docs/05-planning")
        if not plan.is_file():
            raise ValueError("Plan must be a regular file")
        validate_value(relative.as_posix(), "Plan path")
        context, document_id = read_context(plan)
        target = root / "AGENTS.md"
        original_state, original = target_snapshot(target)
        updated = replace_block(original, render(context, document_id, relative.as_posix()))
        if updated == original:
            return 0
        diff_lines = difflib.unified_diff(
            original.decode("utf-8").splitlines(keepends=True),
            updated.decode("utf-8").splitlines(keepends=True),
            fromfile="a/AGENTS.md", tofile="b/AGENTS.md",
        )
        diff = "".join(
            line if line.endswith("\n") else line + "\n\\ No newline at end of file\n"
            for line in diff_lines
        )
        if args.write:
            apply_update(target, original_state, original, updated)
        sys.stdout.write(diff)
        return 0
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
