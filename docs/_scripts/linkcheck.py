#!/usr/bin/env python3
"""Simple link checker for Markdown files under docs/."""

from __future__ import annotations

import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Dict, Any

DOCS = pathlib.Path(__file__).resolve().parents[2] / "docs"
REPORT = DOCS / "01-indices" / "linkcheck-report.json"
URL_PATTERN = re.compile(r"https?://[\w\-._~:/?#\[\]@!$&'()*+,;=%]+", re.IGNORECASE)
SKIP_HOST_PATTERN = re.compile(
    r"^https?://(?:www\.)?(youtube\.com|youtu\.be)/", re.IGNORECASE
)
SKIP_EXACT_URLS = {
    # Service endpoints and schema IDs can be valid yet unavailable/rate-limited in CI.
    "https://api.openai.com/v1",
    "https://github.com/GitCmurf/AIDHA/blob/main/packages/aidha-config/schema/config.schema.json",
}
TIMEOUT = 5


def check_url(url: str) -> Dict[str, Any]:
    def fetch(method: str) -> tuple[int | None, str | None]:
        req = urllib.request.Request(
            url,
            method=method,
            headers={"User-Agent": "AIDHA-linkcheck/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310
                return getattr(resp, "status", None), None
        except urllib.error.HTTPError as exc:
            return exc.code, str(exc)
        except Exception as exc:  # fall back or report
            return None, str(exc)

    status, error = fetch("HEAD")
    if error:
        status, error = fetch("GET")
    reachable_statuses = {401, 403, 405, 429}
    result = {
        "url": url,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "ok"
        if status and (200 <= status < 400 or status in reachable_statuses)
        else "fail",
        "http_status": status,
        "error": error,
    }
    return result


def clean_url(url: str) -> str:
    """Removes trailing markdown artifacts and punctuation while keeping balanced parens."""
    # Iteratively strip from the right if the character is clearly a markdown artifact or sentence punctuation.
    while url:
        last = url[-1]
        if last in '".,]':
            url = url[:-1]
        elif last == ")":
            # Only strip trailing ')' if it's likely a markdown link artifact (unbalanced).
            if url.count("(") < url.count(")"):
                url = url[:-1]
            else:
                break
        else:
            break
    return url


def main() -> int:
    urls: set[str] = set()
    for md in DOCS.rglob("*.md"):
        text = md.read_text(encoding="utf-8", errors="ignore")
        for match in URL_PATTERN.finditer(text):
            if match.start() >= 4 and text[match.start() - 4 : match.start()] == "git+":
                # pip VCS URL form (git+https://...) is not a browsable HTTP endpoint.
                continue
            cleaned = clean_url(match.group(0))
            if cleaned:
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
        if url in SKIP_EXACT_URLS:
            results.append(
                {
                    "url": url,
                    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "status": "skipped",
                    "http_status": None,
                    "error": "skipped_known_endpoint",
                }
            )
            continue
        if SKIP_HOST_PATTERN.match(url):
            results.append(
                {
                    "url": url,
                    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "status": "skipped",
                    "http_status": None,
                    "error": "skipped_unstable_host",
                }
            )
            continue
        res = check_url(url)
        if res["status"] != "ok":
            failures += 1
        results.append(res)
    REPORT.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    if failures:
        print(
            f"Linkcheck found {failures} failing URL(s). See {REPORT}.", file=sys.stderr
        )
        return 1
    print(f"Linkcheck OK ({len(results)} URLs). Report saved to {REPORT}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
