from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Iterable

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
REQUIRED_TREE_PATHS = [
    Path("docops.config.yaml"),
    Path("docs"),
    Path("packages/phyla/docs"),
    Path("packages/praecis/youtube/docs"),
    Path("packages/reconditum/docs"),
]
KNOWN_DOCUMENT_ID = "AIDHA-ADR-001"
KNOWN_ERROR_CODE = "INVALID_STATUS"
UNKNOWN_ERROR_CODE_INPUT = "DOES_NOT_EXIST"
CORRELATION_ID = "aidha-phase1-trace"


@pytest.fixture(scope="session")
def meminit_bin() -> str:
    """Resolve the external Meminit CLI under test.

    Preferred usage in the testbed is to install the candidate build into the
    active environment so `meminit` is available on PATH. For local validation
    against a development checkout, set MEMINIT_BIN explicitly.
    """

    configured = os.environ.get("MEMINIT_BIN")
    if configured:
        return configured

    discovered = shutil.which("meminit")
    if discovered:
        return discovered

    pytest.fail(
        "Meminit CLI not found. Install the candidate build into PATH or set "
        "MEMINIT_BIN=/absolute/path/to/meminit."
    )


@pytest.fixture()
def aidha_worktree(tmp_path: Path) -> Path:
    """Create a writable minimal AIDHA worktree for black-box Meminit tests."""

    for relative_path in REQUIRED_TREE_PATHS:
        source = REPO_ROOT / relative_path
        destination = tmp_path / relative_path
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

    (tmp_path / ".meminit").mkdir(exist_ok=True)
    return tmp_path


def _run_meminit(
    meminit_bin: str,
    *args: str,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    actual_env = os.environ.copy()
    if env:
        actual_env.update(env)
    completed = subprocess.run(
        [meminit_bin, *args],
        cwd=str(cwd) if cwd else None,
        env=actual_env,
        text=True,
        capture_output=True,
        check=False,
    )
    return completed


def _parse_single_json_object(stdout: str) -> dict:
    payload = stdout.strip()
    assert payload, "stdout is empty"
    parsed = json.loads(payload)
    assert isinstance(parsed, dict), "stdout did not contain a JSON object"
    return parsed


def _strip_dynamic_envelope_fields(payload: dict) -> dict:
    normalized = dict(payload)
    normalized.pop("run_id", None)
    normalized.pop("timestamp", None)
    normalized.pop("root", None)
    return normalized


def _assert_json_command(
    completed: subprocess.CompletedProcess[str],
    *,
    expected_command: str,
) -> dict:
    payload = _parse_single_json_object(completed.stdout)
    assert payload["command"] == expected_command
    assert "output_schema_version" in payload
    assert "success" in payload
    assert "data" in payload
    assert "warnings" in payload
    assert "violations" in payload
    assert "advice" in payload
    return payload


def _command_args(name: str, root: Path) -> list[str]:
    mapping = {
        "capabilities": ["capabilities", "--format", "json"],
        "explain": ["explain", KNOWN_ERROR_CODE, "--format", "json"],
        "context": ["context", "--root", str(root), "--format", "json"],
        "check": ["check", "--root", str(root), "--format", "json"],
        "scan": ["scan", "--root", str(root), "--format", "json"],
        "index": ["index", "--root", str(root), "--format", "json"],
        "resolve": ["resolve", KNOWN_DOCUMENT_ID, "--root", str(root), "--format", "json"],
        "state list": ["state", "list", "--root", str(root), "--format", "json"],
    }
    return mapping[name]


def test_capabilities_is_deterministic_across_invocations_and_cwds(
    meminit_bin: str,
    aidha_worktree: Path,
) -> None:
    first = _run_meminit(meminit_bin, "capabilities", "--format", "json", cwd=aidha_worktree)
    second = _run_meminit(meminit_bin, "capabilities", "--format", "json", cwd=aidha_worktree / "docs")

    first_payload = _assert_json_command(first, expected_command="capabilities")
    second_payload = _assert_json_command(second, expected_command="capabilities")

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert _strip_dynamic_envelope_fields(first_payload) == _strip_dynamic_envelope_fields(second_payload)


def test_capabilities_and_explain_list_agree_on_error_inventory(
    meminit_bin: str,
    aidha_worktree: Path,
) -> None:
    capabilities = _run_meminit(meminit_bin, "capabilities", "--format", "json", cwd=aidha_worktree)
    explain_list = _run_meminit(meminit_bin, "explain", "--list", "--format", "json", cwd=aidha_worktree)

    capabilities_payload = _assert_json_command(capabilities, expected_command="capabilities")
    explain_payload = _assert_json_command(explain_list, expected_command="explain")

    assert capabilities.returncode == 0, capabilities.stderr
    assert explain_list.returncode == 0, explain_list.stderr

    advertised_codes = capabilities_payload["data"]["error_codes"]
    listed_codes = [entry["code"] for entry in explain_payload["data"]["error_codes"]]

    assert advertised_codes == sorted(advertised_codes)
    assert listed_codes == sorted(listed_codes)
    assert advertised_codes == listed_codes


def test_explain_known_code_returns_machine_readable_guidance(
    meminit_bin: str,
    aidha_worktree: Path,
) -> None:
    completed = _run_meminit(
        meminit_bin,
        "explain",
        KNOWN_ERROR_CODE,
        "--format",
        "json",
        cwd=aidha_worktree,
    )
    payload = _assert_json_command(completed, expected_command="explain")

    assert completed.returncode == 0, completed.stderr
    assert payload["success"] is True
    assert payload["data"]["code"] == KNOWN_ERROR_CODE
    assert payload["data"]["category"]
    assert payload["data"]["summary"]
    assert payload["data"]["cause"]
    assert payload["data"]["spec_reference"]
    assert payload["data"]["remediation"]["action"]
    assert payload["data"]["remediation"]["resolution_type"]
    assert isinstance(payload["data"]["remediation"]["automatable"], bool)
    assert isinstance(payload["data"]["remediation"]["relevant_commands"], list)


def test_explain_unknown_code_reports_requested_code_in_data(
    meminit_bin: str,
    aidha_worktree: Path,
) -> None:
    completed = _run_meminit(
        meminit_bin,
        "explain",
        UNKNOWN_ERROR_CODE_INPUT,
        "--format",
        "json",
        cwd=aidha_worktree,
    )
    payload = _assert_json_command(completed, expected_command="explain")

    assert completed.returncode != 0
    assert payload["success"] is False
    assert payload["error"]["code"] == "UNKNOWN_ERROR_CODE"
    assert payload["data"] == {"requested_code": UNKNOWN_ERROR_CODE_INPUT}


@pytest.mark.parametrize(
    "command_name",
    [
        "capabilities",
        "explain",
        "context",
        "check",
        "scan",
        "index",
        "resolve",
        "state list",
    ],
)
def test_correlation_id_echo_and_omission(
    meminit_bin: str,
    aidha_worktree: Path,
    command_name: str,
) -> None:
    with_correlation = _run_meminit(
        meminit_bin,
        *_command_args(command_name, aidha_worktree),
        "--correlation-id",
        CORRELATION_ID,
        cwd=aidha_worktree,
    )
    without_correlation = _run_meminit(
        meminit_bin,
        *_command_args(command_name, aidha_worktree),
        cwd=aidha_worktree,
    )

    with_payload = _assert_json_command(with_correlation, expected_command=command_name)
    without_payload = _assert_json_command(without_correlation, expected_command=command_name)

    assert with_payload["correlation_id"] == CORRELATION_ID
    assert "correlation_id" not in without_payload

    # Root must be present for repo-aware commands, absent for repo-agnostic.
    _REPO_AGNOSTIC = {"capabilities", "explain"}
    if command_name in _REPO_AGNOSTIC:
        assert "root" not in with_payload, f"{command_name} must not include root"
    else:
        assert "root" in with_payload, f"{command_name} must include root"


def test_invalid_correlation_id_in_json_mode_returns_structured_error(
    meminit_bin: str,
    aidha_worktree: Path,
) -> None:
    completed = _run_meminit(
        meminit_bin,
        "context",
        "--root",
        str(aidha_worktree),
        "--format",
        "json",
        "--correlation-id",
        "contains whitespace",
        cwd=aidha_worktree,
    )

    payload = _parse_single_json_object(completed.stdout)
    assert completed.returncode != 0
    assert payload["success"] is False
    assert payload["command"] == "context"
    assert payload["error"]["code"]


def test_json_mode_stdout_stays_machine_parseable_when_stderr_is_present(
    meminit_bin: str,
    aidha_worktree: Path,
) -> None:
    completed = _run_meminit(
        meminit_bin,
        "check",
        "--root",
        str(aidha_worktree),
        "--format",
        "json",
        cwd=aidha_worktree,
    )

    payload = _parse_single_json_object(completed.stdout)
    assert "success" in payload
    assert completed.stdout.strip().startswith("{")
    # If the check failed, stderr should contain details
    if not payload["success"]:
        assert completed.stderr or payload["violations"]


def test_index_writes_a_resolved_index_in_temp_worktree(
    meminit_bin: str,
    aidha_worktree: Path,
) -> None:
    completed = _run_meminit(
        meminit_bin,
        "index",
        "--root",
        str(aidha_worktree),
        "--format",
        "json",
        cwd=aidha_worktree,
    )
    payload = _assert_json_command(completed, expected_command="index")

    assert completed.returncode == 0, completed.stderr
    assert payload["success"] is True
    assert (aidha_worktree / ".meminit" / "meminit.index.json").exists()
