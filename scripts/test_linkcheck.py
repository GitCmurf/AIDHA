import json
import unittest
from pathlib import Path

from docs._scripts.linkcheck import is_failure


REPO_ROOT = Path(__file__).resolve().parents[1]
REPORT = REPO_ROOT / "docs" / "01-indices" / "linkcheck-report.json"


class TestLinkcheck(unittest.TestCase):
    def test_existing_report_counts_skipped_entries_as_non_failures(self):
        results = json.loads(REPORT.read_text(encoding="utf-8"))

        self.assertEqual(sum(is_failure(result) for result in results), 0)

    def test_is_failure_only_counts_fail_status(self):
        self.assertFalse(is_failure({"status": "ok"}))
        self.assertFalse(is_failure({"status": "skipped", "error": "skipped_localhost"}))
        self.assertFalse(is_failure({"status": "skipped", "error": "skipped_known_endpoint"}))
        self.assertFalse(is_failure({"status": "skipped", "error": "skipped_unstable_host"}))
        self.assertTrue(is_failure({"status": "fail"}))


if __name__ == "__main__":
    unittest.main()
