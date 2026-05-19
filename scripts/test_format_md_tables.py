import unittest
import sys
from pathlib import Path

# Add scripts directory to path
sys.path.append(str(Path(__file__).resolve().parents[1]))
from format_md_tables import format_table, Table

class TestFormatMdTables(unittest.TestCase):
    def test_short_centered_column(self):
        # | A |
        # | :---: |
        # | x |
        # Header width 1, Content width 1, Delim template :---: (min width 5)
        t = Table(
            start=0,
            end=3,
            indent="",
            rows=[["A"], ["x"]],
            delim=[":---:"]
        )
        formatted = format_table(t)
        # Expected:
        # | A     |
        # | :---: |
        # | x     |
        self.assertEqual(formatted[0], "| A     |")
        self.assertEqual(formatted[1], "| :---: |")
        self.assertEqual(formatted[2], "| x     |")

    def test_short_left_aligned_column(self):
        t = Table(
            start=0,
            end=3,
            indent="",
            rows=[["A"], ["x"]],
            delim=[":---"]
        )
        formatted = format_table(t)
        # min width for :--- is 4
        self.assertEqual(formatted[0], "| A    |")
        self.assertEqual(formatted[1], "| :--- |")
        self.assertEqual(formatted[2], "| x    |")

    def test_long_content(self):
        t = Table(
            start=0,
            end=3,
            indent="",
            rows=[["Long Header"], ["short"]],
            delim=[":---:"]
        )
        formatted = format_table(t)
        # width 11
        self.assertEqual(formatted[0], "| Long Header |")
        self.assertEqual(formatted[1], "| :---------: |")
        self.assertEqual(formatted[2], "| short       |")

if __name__ == "__main__":
    unittest.main()
