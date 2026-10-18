import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_BEGIN = "<!-- AIDHA_AGENT_CONTEXT_SOURCE: begin -->"
SOURCE_END = "<!-- AIDHA_AGENT_CONTEXT_SOURCE: end -->"


class TestGovernedAgentContext(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        shutil.copytree(REPO_ROOT / ".specify", self.root / ".specify")
        (self.root / "scripts").mkdir()
        shutil.copy2(REPO_ROOT / "scripts/python", self.root / "scripts/python")
        subprocess.run(["git", "init", "--quiet", "--initial-branch=main", str(self.root)], check=True)
        self.plan = self.root / "docs/05-planning/plan-900-context.md"
        self.plan.parent.mkdir(parents=True)
        self.context = {
            "version": 1,
            "language": "Python 3.12",
            "dependencies": ["stdlib"],
            "storage": [],
            "project_type": "CLI",
        }
        self.write_plan()
        self.agents = self.root / "AGENTS.md"
        self.manual = (
            "# Manually maintained\n\nLast updated: 2020-01-01\n"
            "## Recent Changes\n- first\n- second\n- third\n\nCustom note.\n"
        ).encode()
        self.agents.write_bytes(self.manual)

    def write_plan(self):
        self.plan.write_text(
            "---\ndocument_id: AIDHA-PLAN-900\nowner: Engineering\n"
            "status: Draft\nversion: '0.1'\nlast_updated: 2026-10-18\n"
            "title: Context fixture\ntype: PLAN\ndocops_version: '2.0'\n---\n\n"
            f"{SOURCE_BEGIN}\n{json.dumps(self.context)}\n{SOURCE_END}\n",
            encoding="utf-8",
        )

    def run_helper(self, *arguments):
        return subprocess.run(
            [
                "bash",
                str(self.root / ".specify/scripts/bash/update-agent-context.sh"),
                *arguments,
            ],
            cwd=self.root,
            text=True,
            capture_output=True,
        )

    def test_explicit_preview_write_and_idempotence_preserve_manual_bytes(self):
        preview = self.run_helper("--plan", str(self.plan), "--preview")
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertIn("+<!-- AIDHA_AGENT_CONTEXT: begin -->", preview.stdout)  # codespell:ignore assertin
        self.assertIn("Python 3.12", preview.stdout)  # codespell:ignore assertin
        self.assertEqual(self.agents.read_bytes(), self.manual)

        written = self.run_helper("--plan", str(self.plan), "--write")
        self.assertEqual(written.returncode, 0, written.stderr)
        updated = self.agents.read_bytes()
        self.assertTrue(updated.startswith(self.manual))
        self.assertEqual(updated.count(b"Python 3.12"), 1)
        self.assertIn(b"- third", updated)  # codespell:ignore assertin
        repeated = self.run_helper("--plan", str(self.plan), "--write")
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual(self.agents.read_bytes(), updated)
        self.assertEqual(repeated.stdout, "")

    def test_update_preserves_prefix_suffix_crlf_and_file_mode(self):
        original = (
            b"Manual before\r\n<!-- AIDHA_AGENT_CONTEXT: begin -->\r\n"
            b"Old generated content\r\n<!-- AIDHA_AGENT_CONTEXT: end -->\r\n"
            b"Manual after without final newline"
        )
        self.agents.write_bytes(original)
        self.agents.chmod(0o640)
        os.utime(self.agents, (1, 2))
        result = self.run_helper("--plan", str(self.plan), "--write")
        self.assertEqual(result.returncode, 0, result.stderr)
        updated = self.agents.read_bytes()
        self.assertTrue(updated.startswith(b"Manual before\r\n"))
        self.assertTrue(updated.endswith(b"Manual after without final newline"))
        self.assertNotIn(b"Old generated content", updated)
        self.assertEqual(self.agents.stat().st_mode & 0o777, 0o640)

    def test_preview_without_final_newline_is_a_valid_unified_diff(self):
        self.agents.write_bytes(b"Manual without final newline")
        result = self.run_helper("--plan", str(self.plan), "--preview")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("\n\\ No newline at end of file\n", result.stdout)  # codespell:ignore assertin
        self.assertNotIn("newline+", result.stdout)

    def assert_rejected_without_write(self, *arguments):
        before = self.agents.read_bytes()
        result = self.run_helper(*arguments)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ERROR:", result.stderr)  # codespell:ignore assertin
        self.assertEqual(self.agents.read_bytes(), before)
        self.assertEqual(list(self.root.glob(".agent-context-*")), [])

    def test_invalid_source_blocks_fail_without_writing(self):
        original = self.plan.read_text(encoding="utf-8")
        cases = [
            original.split(SOURCE_BEGIN)[0] + "Historical workflow prose only.\n",
            original + original[original.index(SOURCE_BEGIN) :],
            original.replace(SOURCE_END, SOURCE_BEGIN),
            original.replace('"version": 1', '"version": 1, "version": 1'),
            original.replace('"version": 1', '"version": true'),
            original.replace('"version": 1', '"version": 2'),
            original.replace('"version": 1', '"extra": "invented", "version": 1'),
            original.replace('"dependencies": ["stdlib"]', '"dependencies": "stdlib"'),
            original.replace('"language": "Python 3.12"', '"language": ""'),
            original.replace('"language": "Python 3.12"', '"language": "line\\nnext"'),
            original.replace('"language": "Python 3.12"', '"language": "line\\u2028next"'),
            original.replace("type: PLAN", "type: TESTING"),
            original.replace("type: PLAN", "type: PLAN\ntype: PLAN"),
            original.replace("AIDHA-PLAN-900", "AIDHA-TESTING-900"),
        ]
        for index, candidate in enumerate(cases):
            with self.subTest(case=index):
                self.plan.write_text(candidate, encoding="utf-8")
                self.assert_rejected_without_write("--plan", str(self.plan), "--write")

    def test_malformed_target_markers_fail_without_writing(self):
        begin = "<!-- AIDHA_AGENT_CONTEXT: begin -->\n"
        end = "<!-- AIDHA_AGENT_CONTEXT: end -->\n"
        for markers in (begin, end, end + begin, begin + begin + end, begin + end + begin + end, "inline " + begin + end):
            with self.subTest(markers=markers):
                self.agents.write_bytes(self.manual + markers.encode())
                self.assert_rejected_without_write("--plan", str(self.plan), "--write")

    def test_outside_and_symlink_escape_sources_fail_without_writing(self):
        with tempfile.TemporaryDirectory() as outside:
            external = Path(outside) / "plan.md"
            external.write_bytes(self.plan.read_bytes())
            alias = self.plan.parent / "plan-901-alias.md"
            alias.symlink_to(external)
            for path in (external, alias, self.root / "AGENTS.md"):
                with self.subTest(path=path):
                    self.assert_rejected_without_write("--plan", str(path), "--write")

    def test_target_symlink_is_never_followed_or_replaced(self):
        with tempfile.TemporaryDirectory() as outside:
            external = Path(outside) / "manual.md"
            external.write_bytes(self.manual)
            self.agents.unlink()
            self.agents.symlink_to(external)
            self.assert_rejected_without_write("--plan", str(self.plan), "--write")
            self.assertTrue(self.agents.is_symlink())
            self.assertEqual(external.read_bytes(), self.manual)

    def test_nonregular_target_fails_without_creating_files(self):
        self.agents.unlink()
        self.agents.mkdir()
        result = self.run_helper("--plan", str(self.plan), "--write")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("regular file", result.stderr)  # codespell:ignore assertin
        self.assertEqual(list(self.agents.iterdir()), [])

    def test_no_action_or_both_actions_are_rejected(self):
        for actions in ([], ["--preview", "--write"]):
            result = self.run_helper("--plan", str(self.plan), *actions)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.agents.read_bytes(), self.manual)

    def test_missing_target_is_created_only_by_explicit_write(self):
        self.agents.unlink()
        preview = self.run_helper("--plan", str(self.plan.relative_to(self.root)), "--preview")
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertFalse(self.agents.exists())
        written = self.run_helper("--plan", str(self.plan), "--write")
        self.assertEqual(written.returncode, 0, written.stderr)
        self.assertIn(b"Python 3.12", self.agents.read_bytes())  # codespell:ignore assertin

    def test_legacy_codex_route_still_reads_legacy_spec(self):
        # common.sh intentionally falls back to main for an unborn Git branch.
        legacy = self.root / "specs/main/plan.md"
        legacy.parent.mkdir(parents=True)
        legacy.write_text(
            "**Language/Version**: Python 3.12\n"
            "**Primary Dependencies**: stdlib\n"
            "**Storage**: N/A\n**Project Type**: CLI\n",
            encoding="utf-8",
        )
        result = self.run_helper("codex")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Python 3.12", self.agents.read_text(encoding="utf-8"))  # codespell:ignore assertin

    def test_explicit_route_uses_project_python_environment(self):
        environment = self.root / ".venv/bin/python"
        environment.parent.mkdir(parents=True)
        marker = self.root / "project-python-used"
        environment.write_text(
            f'#!/bin/sh\ntouch "{marker}"\nexec "{sys.executable}" "$@"\n',
            encoding="utf-8",
        )
        environment.chmod(0o755)
        result = self.run_helper("--plan", str(self.plan), "--preview")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(marker.exists(), "The explicit helper bypassed project Python")

    def test_fifo_source_is_rejected_without_blocking(self):
        self.plan.unlink()
        os.mkfifo(self.plan)
        result = subprocess.run(
            ["bash", str(self.root / ".specify/scripts/bash/update-agent-context.sh"),
             "--plan", str(self.plan), "--write"],
            cwd=self.root, text=True, capture_output=True, timeout=3,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("regular file", result.stderr)  # codespell:ignore assertin
        self.assertEqual(self.agents.read_bytes(), self.manual)


if __name__ == "__main__":
    unittest.main()
