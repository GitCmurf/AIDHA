#!/usr/bin/env python3
"""Simple link checker for Markdown files under docs/."""
from __future__ import annotations

import json
import pathlib
import re
import sys
import time
import urllib.request
from typing import Dict, Any

DOCS = pathlib.Path(__file__).resolve().parents[2] / "docs"
REPORT = DOCS / "01-indices" / "linkcheck-report.json"
URL_PATTERN = re.compile(r"https?://[\w\-._~:/?#\[\]@!$&'()*+,;=%]+", re.IGNORECASE)
TIMEOUT = 5


def check_url(url: str) -> Dict[str, Any]:
    def fetch(method: str) -> tuple[int | None, str | None]:
        req = urllib.request.Request(url, method=method)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310
                return getattr(resp, "status", None), None
        except Exception as exc:  # fall back or report
            return None, str(exc)

    status, error = fetch("HEAD")
    if error:
        status, error = fetch("GET")
    result = {
        "url": url,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "ok" if status and 200 <= status < 400 else "fail",
        "http_status": status,
        "error": error,
    }
    return result


def main() -> int:
    urls: set[str] = set()
    for md in DOCS.rglob("*.md"):
        text = md.read_text(encoding="utf-8", errors="ignore")
        matches = URL_PATTERN.findall(text)
        for match in matches:
            cleaned = match.rstrip('\")')
            urls.add(cleaned)
    results = []
    failures = 0
    for url in sorted(urls):
        if "127.0.0.1" in url or "localhost" in url:
            results.append(
                {
                    "url": url,
                    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "status": "skipped",
                    "http_status": None,
                    "error": "skipped_localhost",
                }
            )
            continue
        res = check_url(url)
        if res["status"] != "ok":
            failures += 1
        results.append(res)
    REPORT.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    if failures:
        print(f"Linkcheck found {failures} failing URL(s). See {REPORT}.", file=sys.stderr)
        return 1
    print(f"Linkcheck OK ({len(results)} URLs). Report saved to {REPORT}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
