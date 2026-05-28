import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "docs" / "_scripts"))

from linkcheck import is_failure


class TestLinkcheck(unittest.TestCase):
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
