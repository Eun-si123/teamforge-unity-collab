#!/usr/bin/env python3
"""Fail closed if any source-declared WP6 Unity EditMode NUnit test was not run.

The ordinary GameCI step can succeed when a particular test class was not
discovered or was silently skipped. Read *this run's exact source XML* and
require every [Test] method declared in WP6 EditMode C# sources to be Passed.
Do not consume stale artifacts, a clone-only filtered XML, or Unity logs.
"""
import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

MAX_XML_BYTES = 16 * 1024 * 1024
MAX_SOURCE_BYTES = 512 * 1024
NAMESPACE = "EunSung.TeamForge.Tests"
CLASS = re.compile(r"\b(?:public|internal)\s+(?:sealed\s+)?class\s+([A-Za-z_]\w*)\b")
TEST_MARKER = re.compile(r"(?m)^[ \t]*\[Test\][ \t]*$")
TEST_METHOD = re.compile(
    r"(?m)^[ \t]*\[Test\][ \t]*\r?\n"
    r"[ \t]*public[ \t]+(?:void|System\.Collections\.IEnumerator)"
    r"[ \t]+([A-Za-z_]\w*)[ \t]*\("
)


def source_methods(test_directory: Path) -> dict[str, str]:
    if not test_directory.is_dir() or test_directory.is_symlink():
        raise ValueError("WP6 Unity test source directory is missing or redirected")
    expected = {}
    for file in sorted(test_directory.glob("TeamForgeWp6*Tests.cs")):
        if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_SOURCE_BYTES:
            raise ValueError(f"unsafe WP6 test source: {file.name}")
        source = file.read_text(encoding="utf-8")
        if re.search(r"(?m)^[ \t]*\[(?:TestCase|TestCaseSource|UnityTest)(?:\(|\])", source):
            raise ValueError(f"unsupported WP6 NUnit attribute requires evidence parser update: {file.name}")
        classes = CLASS.findall(source)
        if len(classes) != 1 or classes[0] != file.stem:
            raise ValueError(f"WP6 test class differs from file name: {file.name}")
        methods = TEST_METHOD.findall(source)
        if len(methods) != len(TEST_MARKER.findall(source)) or not methods:
            raise ValueError(f"unrecognized WP6 [Test] declaration: {file.name}")
        for method in methods:
            full_name = f"{NAMESPACE}.{file.stem}.{method}"
            if full_name in expected:
                raise ValueError(f"duplicate WP6 test source declaration: {full_name}")
            expected[full_name] = file.name
    return expected


def verify(results: Path, test_directory: Path) -> tuple[int, int]:
    expected = source_methods(test_directory)
    # Older base branches/main may have NO WP6 test classes yet. Do not
    # introduce a permanent failure in their unrelated Unity CI runs.
    if not expected:
        print("SKIP: this checkout has no WP6 EditMode NUnit source tests")
        return (0, 0)

    if results.is_symlink() or not results.is_file() or not 0 < results.stat().st_size <= MAX_XML_BYTES:
        raise ValueError("fresh, bounded Unity EditMode test result XML is missing")
    # Avoid parsing expanding entities or unbounded files even if an
    # untrusted artifact changes between stat and open.
    with results.open("rb") as stream:
        raw = stream.read(MAX_XML_BYTES + 1)
    if len(raw) > MAX_XML_BYTES or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("Unity result XML is oversized or contains disallowed XML declarations")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as error:
        raise ValueError(f"malformed Unity EditMode XML: {error}") from error
    if root.tag != "test-run":
        raise ValueError("expected NUnit test-run XML, not a clone/other result file")
    counts = {}
    for label in ("total", "passed", "failed", "skipped", "inconclusive"):
        value = root.get(label, "")
        if not re.fullmatch(r"[0-9]+", value):
            raise ValueError(f"Unity result root lacks a valid {label} count")
        counts[label] = int(value)
    if counts["total"] != sum(counts[name] for name in (
        "passed", "failed", "skipped", "inconclusive"
    )) or counts["passed"] == 0 or counts["failed"] or counts["inconclusive"]:
        raise ValueError("Unity result root reports invalid or failing tests")

    all_cases = list(root.iter("test-case"))
    if len(all_cases) != counts["total"]:
        raise ValueError("Unity result summary differs from actual NUnit test-case count")
    actual = {}
    for case in all_cases:
        name = case.get("fullname", "")
        if name in expected:
            if name in actual:
                raise ValueError(f"duplicate WP6 result: {name}")
            actual[name] = case.get("result", "")
            if case.get("methodname") != name.rsplit(".", 1)[-1]:
                raise ValueError(f"WP6 test identity mismatched in NUnit XML: {name}")

    missing = sorted(set(expected) - set(actual))
    invalid = sorted((name, result) for name, result in actual.items()
                     if result != "Passed")
    if missing or invalid:
        detail = []
        if missing:
            detail.append("missing from Unity run: " + ", ".join(missing[:12]))
        if invalid:
            detail.append("not passed: " + ", ".join(
                f"{name}={result}" for name, result in invalid[:12]
            ))
        raise ValueError("; ".join(detail))
    print(f"PASS: {len(expected)} WP6 EditMode test methods in "
          f"{len(set(expected.values()))} source classes actually passed "
          f"(Unity run passed={counts['passed']}, skipped={counts['skipped']})")
    return (len(expected), len(set(expected.values())))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, required=True,
                        help="Exact game-ci primary EditMode XML path for this run")
    parser.add_argument("--tests-dir", type=Path,
                        default=Path(__file__).resolve().parent.parent /
                        "unity-package/com.eunsung.teamforge/Tests/Editor")
    args = parser.parse_args()
    try:
        verify(args.results, args.tests_dir)
    except (OSError, ValueError, UnicodeError) as error:
        print(f"WP6 Unity execution evidence refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
