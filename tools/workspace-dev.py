#!/usr/bin/env python3
"""
SAKURA Workspace Developer Tool

Commands:
  check      Run syntax and whitespace checks
  manifest   Show content-script loading order
  doctor     Run complete project diagnostics
  status     Show concise Git status
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = PROJECT_ROOT / "chrome-extension"
MANIFEST_PATH = EXTENSION_ROOT / "manifest.json"

JS_FILES = [
    EXTENSION_ROOT / "content" / "workspace-core.js",
    EXTENSION_ROOT / "content" / "shared" / "format.js",
    EXTENSION_ROOT / "content" / "shared" / "toast.js",
    EXTENSION_ROOT / "content" / "shared" / "dialog.js",
    EXTENSION_ROOT / "content" / "activity" / "activity-card.js",
    EXTENSION_ROOT / "content" / "activity" / "activity-search.js",
    EXTENSION_ROOT / "content" / "content.js",
    EXTENSION_ROOT / "sdk" / "workspace-sdk.js",
    EXTENSION_ROOT / "service-worker.js",
    PROJECT_ROOT / "src" / "workspace" / "workspace-api-handler.js",
]


class CheckError(RuntimeError):
    pass


def run(
    command: Sequence[str],
    *,
    allow_failure: bool = False,
) -> subprocess.CompletedProcess[str]:
    print(f"\n> {' '.join(command)}")

    result = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )

    if result.stdout:
        print(result.stdout.rstrip())

    if result.stderr:
        print(result.stderr.rstrip())

    if result.returncode and not allow_failure:
        raise CheckError(
            f"Command failed with exit code {result.returncode}: "
            f"{' '.join(command)}"
        )

    return result


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        raise CheckError(
            f"Manifest not found: {MANIFEST_PATH}"
        )

    try:
        return json.loads(
            MANIFEST_PATH.read_text(
                encoding="utf-8-sig",
            )
        )
    except json.JSONDecodeError as error:
        raise CheckError(
            f"Manifest JSON error: {error}"
        ) from error


def workspace_script_order() -> list[str]:
    manifest = load_manifest()

    for entry in manifest.get(
        "content_scripts",
        [],
    ):
        scripts = entry.get("js", [])

        if "content/content.js" in scripts:
            return [
                str(script).replace("\\", "/")
                for script in scripts
            ]

    raise CheckError(
        "content/content.js was not found "
        "in manifest content_scripts."
    )


def command_manifest() -> None:
    scripts = workspace_script_order()

    print("Content script order:")

    for index, script in enumerate(
        scripts,
        start=1,
    ):
        state = "OK"

        path = EXTENSION_ROOT / script

        if not path.exists():
            state = "MISSING"

        print(
            f"{index:>2}. [{state}] {script}"
        )


def check_required_order() -> None:
    scripts = workspace_script_order()

    required_order = [
        "content/workspace-core.js",
        "content/shared/format.js",
        "content/shared/toast.js",
        "content/shared/dialog.js",
        "content/activity/activity-card.js",
        "content/activity/activity-search.js",
        "content/content.js",
    ]

    positions: dict[str, int] = {}

    for item in required_order:
        if item not in scripts:
            raise CheckError(
                f"Required content script missing: {item}"
            )

        positions[item] = scripts.index(item)

    for previous, current in zip(
        required_order,
        required_order[1:],
    ):
        if positions[previous] >= positions[current]:
            raise CheckError(
                "Invalid content-script order: "
                f"{previous} must load before {current}"
            )

    print("Manifest module order: OK")


def check_javascript() -> None:
    checked = 0

    for path in JS_FILES:
        if not path.exists():
            print(
                f"[SKIP] Missing optional file: "
                f"{path.relative_to(PROJECT_ROOT)}"
            )
            continue

        relative = path.relative_to(
            PROJECT_ROOT
        )

        run([
            "node",
            "--check",
            str(relative),
        ])

        checked += 1

    if not checked:
        raise CheckError(
            "No JavaScript files were checked."
        )

    print(
        f"\nJavaScript syntax: "
        f"{checked} file(s) passed"
    )


def check_git_diff() -> None:
    run([
        "git",
        "diff",
        "--check",
    ])

    print("Git whitespace check: OK")


def command_check() -> None:
    check_javascript()
    check_git_diff()
    check_required_order()

    print("\nCHECK PASSED")


def command_status() -> None:
    run([
        "git",
        "status",
        "--short",
    ])


def check_duplicate_symbols() -> None:
    content_path = (
        EXTENSION_ROOT
        / "content"
        / "content.js"
    )

    if not content_path.exists():
        return

    text = content_path.read_text(
        encoding="utf-8-sig",
    )

    symbols = [
        "let loginDialog = null;",
        "function ensureLoginDialog()",
        "function renderActivities(",
        "function loadActivities(",
        "const sharedToast =",
        "const sharedFormat =",
    ]

    problems: list[str] = []

    for symbol in symbols:
        count = text.count(symbol)

        if count > 1:
            problems.append(
                f"{symbol!r}: {count} occurrences"
            )

    if problems:
        raise CheckError(
            "Possible duplicate declarations:\n- "
            + "\n- ".join(problems)
        )

    print("Duplicate declaration scan: OK")


def command_doctor() -> None:
    print(
        f"Project: {PROJECT_ROOT}"
    )

    command_manifest()
    check_required_order()
    check_duplicate_symbols()
    check_javascript()
    check_git_diff()

    print("\nGit status:")
    command_status()

    print("\nDOCTOR PASSED")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "SAKURA Workspace Developer Tool"
        ),
    )

    parser.add_argument(
        "command",
        choices=[
            "check",
            "manifest",
            "doctor",
            "status",
        ],
    )

    return parser


def main() -> int:
    parser = build_parser()
    arguments = parser.parse_args()

    commands = {
        "check": command_check,
        "manifest": command_manifest,
        "doctor": command_doctor,
        "status": command_status,
    }

    try:
        commands[arguments.command]()
    except CheckError as error:
        print(
            f"\nFAILED: {error}",
            file=sys.stderr,
        )
        return 1
    except KeyboardInterrupt:
        print(
            "\nCancelled.",
            file=sys.stderr,
        )
        return 130

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
