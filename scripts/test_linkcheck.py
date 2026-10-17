import sys
import unittest
import io
import json
import tempfile
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "docs" / "_scripts"))

from linkcheck import is_failure
import linkcheck


class TestLinkcheck(unittest.TestCase):
    def test_failed_url_is_reported_in_ci_stderr_and_retained_in_json(self):
        with tempfile.TemporaryDirectory() as directory:
            docs = Path(directory)
            url = "https://docs.test.invalid/missing"
            (docs / "sample.md").write_text(f"[source]({url})\n", encoding="utf-8")
            report = docs / "report.json"
            failure = {"url": url, "status": "fail", "http_status": 404,
                       "error": "HTTP Error 404: Not Found"}
            stderr = io.StringIO()
            with patch.object(linkcheck, "DOCS", docs), patch.object(linkcheck, "REPORT", report), \
                    patch.object(linkcheck, "check_url", return_value=failure), redirect_stderr(stderr):
                self.assertEqual(linkcheck.main(), 1)
            self.assertEqual(json.loads(report.read_text(encoding="utf-8")), [failure])
            self.assertTrue(url in stderr.getvalue())
            self.assertTrue("404" in stderr.getvalue())
            self.assertTrue("Not Found" in stderr.getvalue())

    def test_skipped_entries_are_non_failures(self):
        results = [
            {"status": "ok"},
            {"status": "skipped", "error": "skipped_localhost"},
            {"status": "skipped", "error": "skipped_known_endpoint"},
            {"status": "skipped", "error": "skipped_unstable_host"},
        ]

        self.assertEqual(sum(is_failure(result) for result in results), 0)

    def test_is_failure_treats_unknown_statuses_as_failures(self):
        self.assertFalse(is_failure({"status": "ok"}))
        self.assertFalse(is_failure({"status": "skipped", "error": "skipped_localhost"}))
        self.assertFalse(is_failure({"status": "skipped", "error": "skipped_known_endpoint"}))
        self.assertFalse(is_failure({"status": "skipped", "error": "skipped_unstable_host"}))
        self.assertTrue(is_failure({"status": "fail"}))
        self.assertTrue(is_failure({"status": "timeout"}))


if __name__ == "__main__":
    unittest.main()
