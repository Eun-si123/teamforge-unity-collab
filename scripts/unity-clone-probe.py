#!/usr/bin/env python3
"""Own one CI clone and validate evidence from two sequential Unity Editors.

No Unity launch, license handling, retry, or collaboration assertions live here.
Paths in a receipt never grant deletion authority; the CLI run identity does.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import uuid
import xml.etree.ElementTree as ET

PACKAGE = "com.eunsung.teamforge"
EDITOR = "6000.3.21f1"
EXPORT_TEST = "EunSung.TeamForge.Tests.TeamForgeCloneEditorProbeTests.ExportCloneForSeparateEditor"
PROBE_TEST = "EunSung.TeamForge.Tests.TeamForgeCloneEditorProbeTests.CloneEditorResolvesItsOwnEmbeddedPackage"
EXCLUDED = {".git", ".svn", "library", "temp", "logs", "obj", "usersettings", ".vs", ".idea"}
MAX_JSON = 4 * 1024 * 1024
MAX_BYTES = 1024 * 1024 * 1024
# Exact additions observed in the pinned Unity 6000.3.21f1 Linux Editor's
# 2026-11-06 GitHub CI clone-export receipt (SHA-256 3e3d4631...).
# These names and versions are not general permission to change the graph.
INITIAL_EDITOR_SDKS = {"com.unity.sdk.linux-arm64": "1.1.1", "com.unity.sdk.linux-x86_64": "1.1.1",
                       "com.unity.toolchain.linux-x86_64-linux": "1.1.1"}


class ProbeError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise ProbeError(code)


def direct_directory(path):
    path = Path(path).absolute()
    for parent in (path, *path.parents):
        require(stat.S_ISDIR(parent.lstat().st_mode), "directory_not_direct")
    return path


def mkdir_direct(path):
    path = Path(path).absolute()
    if not path.exists():
        mkdir_direct(path.parent)
        path.mkdir()
    return direct_directory(path)


def open_regular(path, maximum):
    direct_directory(Path(path).parent)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(path, flags)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode), "file_not_regular")
        require(0 <= info.st_size <= maximum, "file_size_limit")
        return os.fdopen(descriptor, "rb")
    except BaseException:
        os.close(descriptor)
        raise


def read_bytes(path, maximum=MAX_JSON):
    with open_regular(path, maximum) as stream:
        value = stream.read(maximum + 1)
    require(len(value) <= maximum, "file_size_limit")
    return value


def digest(path):
    result = hashlib.sha256()
    total = 0
    with open_regular(path, MAX_BYTES) as stream:
        while block := stream.read(1024 * 1024):
            total += len(block)
            require(total <= MAX_BYTES, "file_size_limit")
            result.update(block)
    return total, result.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def parse_json(raw):
    return json.loads(raw.decode("utf-8-sig", errors="strict"), object_pairs_hook=unique_object,
                      parse_constant=lambda _: require(False, "invalid_json_number"))


def read_json(path):
    result = parse_json(read_bytes(path))
    require(isinstance(result, dict), "json_object_required")
    return result


def semantic_hash(value):
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def validate_initialized_manifest(manifest, baseline):
    dependencies = manifest.get("dependencies")
    require(isinstance(dependencies, dict), "dependencies_missing")
    optional = baseline.get("initialEditorSdkNames")
    require(isinstance(optional, list) and len(optional) <= len(INITIAL_EDITOR_SDKS) and
            all(isinstance(name, str) and name in INITIAL_EDITOR_SDKS for name in optional) and
            len(set(optional)) == len(optional), "invalid_source_baseline")
    normalized = dict(manifest, dependencies=dict(dependencies))
    for name in optional:
        if name in normalized["dependencies"]:
            require(normalized["dependencies"][name] == INITIAL_EDITOR_SDKS[name], "source_manifest_changed")
            del normalized["dependencies"][name]
    require(semantic_hash(normalized) == baseline.get("sourceManifestSemanticSha256"), "source_manifest_changed")


def write_new(path, value):
    with Path(path).open("xb") as stream:
        stream.write(json.dumps(value, ensure_ascii=True, indent=2).encode("utf-8"))


def inventory(root):
    root = direct_directory(root)
    files, count, total = {}, 0, 0

    def visit(directory, depth):
        nonlocal count, total
        require(depth <= 64, "package_depth_limit")
        with os.scandir(directory) as entries:
            for entry in entries:
                count += 1
                require(count <= 20000, "package_entry_limit")
                kind = entry.stat(follow_symlinks=False).st_mode
                require(not stat.S_ISLNK(kind), "package_link")
                if stat.S_ISDIR(kind):
                    if entry.name.lower() not in EXCLUDED:
                        visit(Path(entry.path), depth + 1)
                elif entry.name.lower() != ".git":
                    require(stat.S_ISREG(kind), "file_not_regular")
                    length, sha256 = digest(entry.path)
                    total += length
                    require(total <= MAX_BYTES, "package_size_limit")
                    files[Path(entry.path).relative_to(root).as_posix()] = (length, sha256)
    visit(root, 0)
    require("package.json" in files, "package_identity_missing")
    return files


def file_list(files):
    return [{"path": path, "length": length, "sha256": sha256}
            for path, (length, sha256) in sorted(files.items())]


def receipt_inventory(value):
    require(isinstance(value, list) and 0 < len(value) <= 20000, "invalid_package_inventory")
    result, total = {}, 0
    for item in value:
        require(isinstance(item, dict) and set(item) == {"path", "length", "sha256"}, "invalid_package_inventory")
        path, length, sha256 = item["path"], item["length"], item["sha256"]
        require(isinstance(path, str) and len(path) <= 4096 and "\\" not in path and
                all(part not in ("", ".", "..") for part in path.split("/")) and
                not path.startswith("/") and not re.search(r"[\x00-\x1f\x7f:]", path), "invalid_package_path")
        require(path not in result and type(length) is int and 0 <= length <= MAX_BYTES, "invalid_package_inventory")
        require(isinstance(sha256, str) and re.fullmatch(r"[0-9a-f]{64}", sha256), "invalid_package_hash")
        total += length
        require(total <= MAX_BYTES, "package_size_limit")
        result[path] = (length, sha256)
    return result


def lock_state(project):
    path = project / "Packages/packages-lock.json"
    if not os.path.lexists(path):
        return {"sourceLockPresent": False, "sourceLockSha256": ""}
    return {"sourceLockPresent": True, "sourceLockSha256": digest(path)[1]}


def expected_owner(args, token):
    require(re.fullmatch(r"[0-9]{1,20}", args.run_id) and re.fullmatch(r"[0-9]{1,10}", args.run_attempt), "invalid_run")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source_sha) and args.editor == EDITOR, "invalid_source_identity")
    require(re.fullmatch(re.escape(args.run_id + "-" + args.run_attempt + "-") + r"[0-9a-f]{32}", token), "invalid_run_token")
    return {"schemaVersion": 1, "runId": args.run_id, "runAttempt": args.run_attempt,
            "sourceSha": args.source_sha, "editor": args.editor, "token": token}


def context(args):
    workspace = direct_directory(args.workspace)
    expected = expected_owner(args, args.token)
    root = direct_directory(workspace / "test-results/clone-editor" / args.token)
    require(read_json(root / "owner.json") == expected, "owner_mismatch")
    return workspace, root, expected


def init(args):
    workspace = direct_directory(args.workspace)
    token = args.run_id + "-" + args.run_attempt + "-" + uuid.uuid4().hex
    owner = expected_owner(args, token)
    source = workspace / "unity-project"
    manifest_bytes = read_bytes(source / "Packages/manifest.json")
    manifest = parse_json(manifest_bytes)
    require(isinstance(manifest, dict) and isinstance(manifest.get("dependencies"), dict), "dependencies_missing")
    baseline = {"sourceManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                "sourceManifestSemanticSha256": semantic_hash(manifest),
                "initialEditorSdkNames": [name for name in INITIAL_EDITOR_SDKS if name not in manifest["dependencies"]],
                "packageFiles": file_list(inventory(workspace / "unity-package" / PACKAGE)), **lock_state(source)}
    parent = mkdir_direct(workspace / "test-results/clone-editor")
    root = parent / token
    root.mkdir()  # Exclusive allocation: no prior clone/evidence is removed.
    evidence = mkdir_direct(workspace / "test-results/clone-editor-evidence") / token
    evidence.mkdir()
    write_new(root / "owner.json", owner)
    write_new(root / "baseline.json", baseline)
    return {"token": token, "exportParameters": "-teamforgeCiExportClone -teamforgeCiCloneRun " + token,
            "sourceResultsPath": evidence.relative_to(workspace).as_posix() + "/source-results",
            "probeResultsPath": evidence.relative_to(workspace).as_posix() + "/probe-results"}


def validate_xml(workspace, token, relative, stage, expected_test):
    expected = f"test-results/clone-editor-evidence/{token}/{stage}-results"
    require(relative == expected, "results_path_mismatch")
    directory = direct_directory(workspace / relative)
    xml_files = []
    with os.scandir(directory) as entries:
        for count, entry in enumerate(entries, 1):
            require(count <= 64, "result_entry_limit")
            if entry.name.endswith(".xml"):
                xml_files.append(Path(entry.path))
    require(len(xml_files) == 1, "fresh_xml_required")
    raw = read_bytes(xml_files[0], 5 * 1024 * 1024)
    require(b"<!DOCTYPE" not in raw.upper() and b"<!ENTITY" not in raw.upper(), "xml_dtd_forbidden")
    result = ET.fromstring(raw)
    # Unity marks a successful full suite with intentionally ignored tests as
    # Skipped:Ignored. Only the source suite may have that aggregate result;
    # the separately selected probe must execute once without any skips.
    allowed_results = {"Passed", "Skipped:Ignored"} if stage == "source" else {"Passed"}
    require(result.tag == "test-run" and result.get("result") in allowed_results, "unity_result_not_passed")
    counts = {}
    for key in ("total", "passed", "failed", "skipped", "inconclusive"):
        text = result.get(key, "")
        require(re.fullmatch(r"[0-9]{1,9}", text), "invalid_unity_counts")
        counts[key] = int(text)
    require(counts["total"] == sum(counts[k] for k in ("passed", "failed", "skipped", "inconclusive")) and
            counts["passed"] > 0 and counts["failed"] == counts["inconclusive"] == 0, "unity_result_not_passed")
    cases = list(result.iter("test-case"))
    selected = [case for case in cases if case.get("fullname") == expected_test]
    require(len(selected) == 1 and selected[0].get("result") == "Passed", "exact_test_not_passed")
    if stage == "probe":
        require(counts == {"total": 1, "passed": 1, "failed": 0, "skipped": 0, "inconclusive": 0}
                and len(cases) == 1, "probe_must_execute_once")
    require(len(cases) == counts["total"] and
            sum(case.get("result") == "Passed" for case in cases) == counts["passed"] and
            sum(case.get("result") == "Skipped" for case in cases) == counts["skipped"],
            "unity_case_counts_mismatch")


def verify_files(workspace, root, owner):
    receipt = read_json(root / "export.json")
    for key in ("schemaVersion", "token", "sourceSha", "editor"):
        require(receipt.get(key) == owner[key], "export_identity_mismatch")
    require(receipt.get("packageName") == PACKAGE and isinstance(receipt.get("packageVersion"), str)
            and 0 < len(receipt["packageVersion"]) <= 128, "package_identity_mismatch")
    clone_path = receipt.get("clonePath")
    prefix = f"test-results/clone-editor/{owner['token']}/clones/TF-B-"
    require(isinstance(clone_path, str) and re.fullmatch(re.escape(prefix) + r"[0-9a-f]{32}", clone_path), "invalid_clone_path")
    clone = direct_directory(workspace / clone_path)
    source = workspace / "unity-project"
    baseline = read_json(root / "baseline.json")
    files = receipt_inventory(receipt.get("packageFiles"))
    require(files == receipt_inventory(baseline.get("packageFiles")), "source_package_changed")
    require(inventory(workspace / "unity-package" / PACKAGE) == files, "source_package_changed")
    require(inventory(clone / "Packages" / PACKAGE) == files, "clone_package_changed")
    source_hash = digest(source / "Packages/manifest.json")[1]
    # The Editor may initialize its known SDK entries before the exporter runs.
    # After that point the source must remain byte-identical to the exporter's
    # before/after-copy snapshot, through both Editor invocations.
    if source_hash != receipt.get("sourceManifestSha256"):
        # Diagnose which safe boundary changed without logging paths, bytes,
        # manifest fields, or dependency values. A later CI pass can tell a
        # checkout restoration from an unexpected post-export mutation.
        restored = source_hash == baseline.get("sourceManifestSha256")
        raise ProbeError("source_manifest_changed (restored_baseline=" + str(restored).lower() + ")")
    require(digest(clone / "Packages/manifest.json")[1] == receipt.get("cloneManifestSha256"), "clone_manifest_changed")
    original = read_json(source / "Packages/manifest.json")
    cloned = read_json(clone / "Packages/manifest.json")
    validate_initialized_manifest(original, baseline)
    require(isinstance(original.get("dependencies"), dict), "dependencies_missing")
    original["dependencies"][PACKAGE] = "file:" + PACKAGE
    require(cloned == original, "clone_manifest_semantics_changed")
    current_lock = lock_state(source)
    require(type(receipt.get("sourceLockPresent")) is bool and
            current_lock == {key: receipt.get(key) for key in current_lock}, "source_lock_changed")
    if baseline.get("sourceLockPresent"):
        require(current_lock == {key: baseline.get(key) for key in current_lock}, "source_lock_changed")
    if current_lock["sourceLockPresent"]:
        require(digest(root / "initial-lock.json")[1] == current_lock["sourceLockSha256"], "initial_lock_changed")
    else:
        require(not os.path.lexists(root / "initial-lock.json"), "unexpected_initial_lock")
    require(not os.path.lexists(clone / "UserSettings/TeamForgeCloneBootstrap.json"), "unexpected_bootstrap")
    return receipt, clone


def verify_export(args):
    workspace, root, owner = context(args)
    receipt, clone = verify_files(workspace, root, owner)
    for name in ("Library", "Temp", "Logs", "UserSettings", ".git"):
        require(not os.path.lexists(clone / name), "clone_not_fresh")
    require(lock_state(clone) == lock_state(workspace / "unity-project"), "initial_clone_lock_changed")
    validate_xml(workspace, owner["token"], args.source_results, "source", EXPORT_TEST)
    # This host receipt makes post-probe verification depend on a successful
    # pre-open check. It is never accepted from the Editor export alone.
    write_new(root / "verified-export.json", {"token": owner["token"], "exportSha256": digest(root / "export.json")[1]})
    return {"clonePath": receipt["clonePath"], "ready": "true"}


def verify_probe(args):
    workspace, root, owner = context(args)
    verified = read_json(root / "verified-export.json")
    require(verified == {"token": owner["token"], "exportSha256": digest(root / "export.json")[1]}, "export_not_verified")
    receipt, clone = verify_files(workspace, root, owner)
    proof = read_json(root / "probe.json")
    expected = {key: receipt[key] for key in ("schemaVersion", "token", "sourceSha", "editor", "clonePath", "packageName", "packageVersion")}
    expected["packageSource"] = "Embedded"
    require(proof == expected, "probe_identity_mismatch")
    validate_xml(workspace, owner["token"], args.probe_results, "probe", PROBE_TEST)
    if receipt["sourceLockPresent"]:
        before, after = read_json(root / "initial-lock.json"), read_json(clone / "Packages/packages-lock.json")
        for lock in (before, after):
            require(isinstance(lock.get("dependencies"), dict), "invalid_lock")
            lock["dependencies"].pop(PACKAGE, None)
        require(after == before, "unrelated_lock_changed")
    return {"result": "PASS", "scope": "sequential-clone-editor-import-compile-upm"}


def cleanup(args):
    _, root, _ = context(args)
    # Validate the whole owned tree before deletion. Never follow a static link
    # or use a clonePath from export/probe JSON to choose what is removed.
    count = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        direct_directory(directory)
        for name in dirs + files:
            count += 1
            require(count <= 100000, "cleanup_entry_limit")
            mode = (Path(directory) / name).lstat().st_mode
            require(stat.S_ISDIR(mode) or stat.S_ISREG(mode), "cleanup_not_direct")
    shutil.rmtree(root)
    return {"cleanup": "owned-clone-removed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("init", "verify-export", "verify-probe", "cleanup"))
    for field in ("workspace", "run-id", "run-attempt", "source-sha", "editor"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--token")
    parser.add_argument("--source-results")
    parser.add_argument("--probe-results")
    args = parser.parse_args()
    try:
        values = globals()[args.command.replace("-", "_")](args)
        for key, value in values.items():
            print(f"{key}={value}")
        return 0
    except ProbeError as error:
        # ProbeError messages are fixed guard codes, never input values or paths.
        print(f"Clone Editor evidence validation failed ({error}); this stage is not PASS.", file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, RecursionError, ET.ParseError):
        # Public CI output must not echo private paths or arbitrary JSON text.
        print("Clone Editor evidence validation failed; this stage is not PASS.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
