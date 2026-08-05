#!/usr/bin/env python3
"""
SAKURA Workspace Developer Tool v2

Commands:
  check      Run syntax, manifest, and whitespace checks
  manifest   Show content-script loading order
  doctor     Run complete project diagnostics
  status     Show concise Git status
  report     Generate docs/framework-report.md
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = PROJECT_ROOT / "chrome-extension"
MANIFEST_PATH = EXTENSION_ROOT / "manifest.json"
REPORT_PATH = PROJECT_ROOT / "docs" / "framework-report.md"

JS_FILES = [
    EXTENSION_ROOT / "content" / "workspace-core.js",
    EXTENSION_ROOT / "content" / "shared" / "format.js",
    EXTENSION_ROOT / "content" / "shared" / "toast.js",
    EXTENSION_ROOT / "content" / "shared" / "dialog.js",
    EXTENSION_ROOT / "content" / "activity" / "activity-dashboard.js",
    EXTENSION_ROOT / "content" / "activity" / "activity-card.js",
    EXTENSION_ROOT / "content" / "activity" / "activity-search.js",
    EXTENSION_ROOT / "content" / "activity" / "activity-form-validation.js",
    EXTENSION_ROOT / "content" / "content.js",
    EXTENSION_ROOT / "sdk" / "workspace-sdk.js",
    EXTENSION_ROOT / "service-worker.js",
    PROJECT_ROOT / "src" / "workspace" / "workspace-api-handler.js",
]

REQUIRED_ORDER = [
    "content/workspace-core.js",
    "content/shared/format.js",
    "content/shared/toast.js",
    "content/shared/dialog.js",
    "content/activity/activity-dashboard.js",
    "content/activity/activity-card.js",
    "content/activity/activity-search.js",
    "content/activity/activity-form-validation.js",
    "content/content.js",
]

FRAMEWORK_MODULES = {
    "Core": [
        "content/workspace-core.js",
    ],
    "Shared": [
        "content/shared/format.js",
        "content/shared/toast.js",
        "content/shared/dialog.js",
    ],
    "Activity": [
        "content/activity/activity-dashboard.js",
        "content/activity/activity-card.js",
        "content/activity/activity-search.js",
        "content/activity/activity-form-validation.js",
    ],
}


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
        path = EXTENSION_ROOT / script
        state = "OK" if path.exists() else "MISSING"
        print(f"{index:>2}. [{state}] {script}")


def check_required_order() -> None:
    scripts = workspace_script_order()
    positions: dict[str, int] = {}

    for item in REQUIRED_ORDER:
        if item not in scripts:
            raise CheckError(
                f"Required content script missing: {item}"
            )

        positions[item] = scripts.index(item)

    for previous, current in zip(
        REQUIRED_ORDER,
        REQUIRED_ORDER[1:],
    ):
        if positions[previous] >= positions[current]:
            raise CheckError(
                "Invalid content-script order: "
                f"{previous} must load before {current}"
            )

    print("Manifest module order: OK")


def check_javascript() -> int:
    checked = 0

    for path in JS_FILES:
        if not path.exists():
            print(
                f"[SKIP] Missing optional file: "
                f"{path.relative_to(PROJECT_ROOT)}"
            )
            continue

        run([
            "node",
            "--check",
            str(path.relative_to(PROJECT_ROOT)),
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

    return checked


def check_git_diff() -> None:
    run([
        "git",
        "diff",
        "--check",
    ])
    print("Git whitespace check: OK")


def git_status_short() -> str:
    result = subprocess.run(
        ["git", "status", "--short"],
        cwd=PROJECT_ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )

    if result.returncode:
        raise CheckError(
            "git status --short failed"
        )

    return result.stdout.rstrip()


def latest_commit() -> str:
    result = subprocess.run(
        ["git", "log", "-1", "--oneline"],
        cwd=PROJECT_ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )

    if result.returncode:
        return "Unavailable"

    return result.stdout.strip() or "Unavailable"


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
        "function ensureActivityCard()",
        "function ensureActivityDashboard()",
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


def module_coverage() -> tuple[int, int, dict[str, tuple[int, int]]]:
    total = 0
    present = 0
    details: dict[str, tuple[int, int]] = {}

    for group, modules in FRAMEWORK_MODULES.items():
        group_present = 0

        for module in modules:
            total += 1

            if (EXTENSION_ROOT / module).exists():
                present += 1
                group_present += 1

        details[group] = (
            group_present,
            len(modules),
        )

    return present, total, details


def progress_bar(
    current: int,
    total: int,
    width: int = 12,
) -> str:
    ratio = 0 if total == 0 else current / total
    filled = round(ratio * width)

    return (
        "█" * filled
        + "░" * (width - filled)
    )


def command_check() -> None:
    check_javascript()
    check_git_diff()
    check_required_order()
    print("\nCHECK PASSED")


def command_status() -> None:
    status = git_status_short()
    print(status or "Working tree clean.")


def command_doctor() -> None:
    print(
        f"SAKURA Workspace Doctor v2\n"
        f"Project: {PROJECT_ROOT}\n"
    )

    command_manifest()
    check_required_order()
    check_duplicate_symbols()
    checked = check_javascript()
    check_git_diff()

    status = git_status_short()
    present, total, groups = module_coverage()
    percentage = round(
        (present / total) * 100
    ) if total else 0

    print(
        f"\nFramework coverage "
        f"{progress_bar(present, total)} "
        f"{percentage}%"
    )

    for group, (
        group_present,
        group_total,
    ) in groups.items():
        group_percentage = round(
            (group_present / group_total) * 100
        ) if group_total else 0

        print(
            f"  {group:<10} "
            f"{progress_bar(group_present, group_total, 8)} "
            f"{group_percentage:>3}%"
        )

    print(
        f"\nJavaScript checked: {checked}"
    )

    if status:
        print("\nGit status:")
        print(status)
        print("\nCommit ready: NO")
    else:
        print("\nGit status: clean")
        print("Commit ready: YES")

    print(
        f"Latest commit: {latest_commit()}"
    )
    print("\nDOCTOR PASSED")


def command_report() -> None:
    scripts = workspace_script_order()
    status = git_status_short()
    present, total, groups = module_coverage()
    percentage = round(
        (present / total) * 100
    ) if total else 0

    REPORT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    lines = [
        "# SAKURA Workspace Framework Report",
        "",
        f"- Generated: {datetime.now().isoformat(timespec='seconds')}",
        f"- Project: `{PROJECT_ROOT}`",
        f"- Latest commit: `{latest_commit()}`",
        f"- Framework coverage: **{percentage}%**",
        f"- Commit ready: **{'No' if status else 'Yes'}**",
        "",
        "## Content script order",
        "",
    ]

    for index, script in enumerate(
        scripts,
        start=1,
    ):
        state = (
            "OK"
            if (EXTENSION_ROOT / script).exists()
            else "Missing"
        )
        lines.append(
            f"{index}. `{script}` — {state}"
        )

    lines.extend([
        "",
        "## Framework coverage",
        "",
    ])

    for group, (
        group_present,
        group_total,
    ) in groups.items():
        group_percentage = round(
            (group_present / group_total) * 100
        ) if group_total else 0

        lines.append(
            f"- **{group}**: "
            f"{group_present}/{group_total} "
            f"({group_percentage}%)"
        )

    lines.extend([
        "",
        "## Git status",
        "",
        "```text",
        status or "Working tree clean.",
        "```",
        "",
        "## Next recommended extraction",
        "",
        "- Activity form validation",
        "- Activity upload and preview",
        "- Activity form submission",
        "",
    ])

    REPORT_PATH.write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
    )

    print(
        f"Report generated: "
        f"{REPORT_PATH.relative_to(PROJECT_ROOT)}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "SAKURA Workspace Developer Tool v2"
        ),
    )

    parser.add_argument(
        "command",
        choices=[
            "check",
            "manifest",
            "doctor",
            "status",
            "report",
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
        "report": command_report,
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
