#!/usr/bin/env python3
"""Android release workflow contract checks, split from test-workflow-contract.sh."""
import json
import re
import sys
from pathlib import Path

import yaml

WORKFLOW_FILES = {
    "stage": "android-stage.yml",
    "publish_gate": "android-publish-gate.yml",
    "publish": "android-publish.yml",
}
CALLER = "android-release.yml"


def _load(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _on(document):
    return document.get(True, document.get("on"))


def _text(steps) -> str:
    parts = []
    for step in steps:
        parts.append(step.get("run") or "")
        parts.append((step.get("with") or {}).get("script") or "")
    return "\n".join(parts)


def _assert_compact(path: Path) -> None:
    data = path.read_bytes()
    assert b"\r\n" not in data, f"{path} must use LF line endings"
    lines = data.decode("utf-8").splitlines()
    assert len(lines) <= 500, f"{path} must stay under the 500-line production limit, got {len(lines)}"


def main(root: Path) -> None:
    sys.path.insert(0, str(root / "scripts" / "android-release"))
    import workflow_model

    workflow_dir = root / ".github" / "workflows"
    ci_android = (workflow_dir / "ci-android.yml").read_text(encoding="utf-8")
    caller = _load(workflow_dir / CALLER)
    model = workflow_model.load(str(root))
    stage = model["jobs"]["stage"]
    publish = model["jobs"]["publish"]
    stage_text = _text(stage["steps"])
    publish_text = _text(publish["steps"])
    release_text = stage_text + "\n" + publish_text

    # APK/bundle content assertions must never pipe into grep -q: under pipefail a hit
    # makes the producer take SIGPIPE (141) and a present file reads as missing.
    for name, text in (("ci-android.yml", ci_android), (CALLER, release_text)):
        offenders = [
            line.strip() for line in text.splitlines()
            if "| grep -q" in line and not line.lstrip().startswith("#")
        ]
        assert not offenders, \
            f"{name} must not pipe into grep -q (SIGPIPE false negative under pipefail): {offenders[:2]}"
    assert "listing_file" in ci_android and "unzip -Z1" in ci_android, \
        "ci-android.yml must assert APK contents from a listing file"
    assert "listing_file" in stage_text and "unzip -Z1" in stage_text, \
        "android stage must assert APK contents from a listing file"

    setup_nodes = [
        step for step in stage["steps"]
        if "actions/setup-node@" in (step.get("uses") or "")
    ]
    assert len(setup_nodes) == 1, \
        f"android stage must declare actions/setup-node exactly once (SHA-pinned), got {len(setup_nodes)}"

    assert "https://wotbtools.com/version.json" not in publish_text
    assert "FE_COMMIT" not in publish_text
    assert "android_contract.py bundle" in stage_text and "android_contract.py bundle" in publish_text
    assert "android_contract.py cors" in publish_text

    # Publish candidate must come from the explicit workflow_dispatch version input.
    inputs = model["on"]["workflow_dispatch"]["inputs"]
    assert {"mode", "version", "auto_publish"} <= set(inputs), inputs
    version_input = inputs["version"]
    assert version_input.get("type") == "string" and version_input.get("required") is False, version_input
    assert "inputs.version" in json.dumps(publish, ensure_ascii=False), \
        "the publish job must consume the explicit version input"
    assert "steps.version.outputs" not in publish_text, \
        "publish must not derive the candidate from the current main committed version"
    assert "resolve-staged-version.sh" in publish_text, \
        "publish must resolve the staged version from the tag target"
    assert 'TAG="android-v$REQUESTED_VERSION"' in publish_text and "git archive" in publish_text

    # staged versionCode 唯一来源是 stagedref 输出；不得把 Python 局部变量当 shell 变量。
    staged = next(step for step in publish["steps"] if step.get("id") == "staged")
    assert staged.get("env", {}).get("STAGED_VERSION_CODE") == \
        "${{ steps.stagedref.outputs.versionCode }}", staged.get("env", {})
    staged_shell_lines = [line for line in (staged.get("run") or "").splitlines()
                          if not line.lstrip().startswith("#")]
    assert any('echo "versionCode=$STAGED_VERSION_CODE" >> "$GITHUB_OUTPUT"' in line
               for line in staged_shell_lines), \
        "publish must write the staged versionCode from STAGED_VERSION_CODE"
    assert not any("$expected" in line or "${expected}" in line for line in staged_shell_lines), \
        "publish shell must not read the Python-local expected variable"

    for forbidden in ("assembleRelease", "wotbKeystorePath", "keystore.jks", "ANDROID_KEYSTORE_BASE64"):
        assert forbidden not in publish_text, f"publish must not rebuild or re-sign ({forbidden})"

    # version.json 是最后一个 mutation，且只由 staged 身份写出。
    names = [step.get("name", "") for step in publish["steps"]]
    write_i = next(i for i, name in enumerate(names) if name.startswith("Write version.json"))
    upload_i = next(i for i, name in enumerate(names) if name.startswith("Upload version.json"))
    verify_i = next(i for i, name in enumerate(names) if name.startswith("Verify production version.json"))
    assert write_i < upload_i < verify_i, names
    write_step = publish["steps"][write_i]
    assert write_step.get("env", {}).get("STEP_STAGED_VERSIONCODE") == \
        "${{ steps.staged.outputs.versionCode }}", \
        "version.json must be written from the staged identity"
    assert "$STEP_STAGED_VERSIONCODE" in (write_step.get("run") or ""), \
        "version.json writer must consume the staged versionCode env binding"
    upload_step = publish["steps"][upload_i]
    assert upload_step.get("uses", "").startswith("appleboy/scp-action@"), upload_step.get("uses")
    assert upload_step.get("with", {}).get("source") == "release-staging/version.json", upload_step.get("with")

    # Split structure: the orchestrator only dispatches; protocol lives in reusable workflows + scripts.
    assert set(caller["jobs"]) == set(WORKFLOW_FILES), set(caller["jobs"])
    for job_id, filename in WORKFLOW_FILES.items():
        caller_job = caller["jobs"][job_id]
        assert caller_job.get("uses") == f"./.github/workflows/{filename}", caller_job.get("uses")
        assert caller_job.get("secrets") == "inherit", caller_job.get("secrets")
    assert caller["jobs"]["stage"].get("if") == \
        "github.event_name != 'workflow_dispatch' || inputs.mode != 'publish'"
    assert caller["jobs"]["stage"].get("permissions") == \
        {"contents": "write", "id-token": "write", "attestations": "write"}
    assert caller["jobs"]["publish_gate"].get("permissions") == {"contents": "read"}
    assert caller["jobs"]["publish"].get("permissions") == {"contents": "read"}
    assert caller["jobs"]["publish"].get("needs") == "publish_gate"

    top_env = caller.get("env", {})
    assert top_env, "android release must keep the top-level env block"
    called = {}
    for job_id, filename in WORKFLOW_FILES.items():
        document = _load(workflow_dir / filename)
        called[job_id] = document
        assert job_id in document["jobs"], f"{filename} must define job {job_id}"
        assert document.get("env") == top_env, \
            f"{filename} must duplicate the caller env: workflow_call does not inherit it"
        assert "workflow_call" in _on(document), f"{filename} must be a reusable workflow"
    assert called["publish_gate"]["jobs"]["publish_gate"]["outputs"]["superseded"] == \
        "${{ steps.freshness.outputs.superseded }}"
    gate_call = _on(called["publish_gate"])["workflow_call"]
    assert gate_call["outputs"]["superseded"]["value"] == \
        "${{ jobs.publish_gate.outputs.superseded }}"
    assert {"version", "auto_publish"} <= set(gate_call["inputs"])
    for job_id in ("stage", "publish"):
        assert "version" in _on(called[job_id])["workflow_call"]["inputs"], called[job_id]

    # Every run delegates to one step script; remote commands carry no workflow expressions.
    delegate = re.compile(
        r'bash -eo pipefail "\$GITHUB_WORKSPACE/scripts/android-release/steps/([A-Za-z0-9_.-]+\.sh)"'
    )
    referenced = set()
    for job_id, document in called.items():
        for step in document["jobs"][job_id]["steps"]:
            run = step.get("run")
            if run is not None:
                match = delegate.fullmatch(run)
                assert match, f"{job_id} has a non-delegated run block: {run!r}"
                path = root / "scripts" / "android-release" / "steps" / match.group(1)
                assert path.is_file(), f"{job_id} delegates to a missing script: {path}"
                referenced.add(path)
            with_ = step.get("with") or {}
            assert "script" not in with_, f"{job_id} still has an inline remote script"
            if "script_path" in with_:
                path = root / with_["script_path"]
                assert path.is_file(), f"{job_id} remote script missing: {path}"
                referenced.add(path)
    all_scripts = set((root / "scripts" / "android-release" / "steps").glob("*.sh"))
    assert referenced == all_scripts, \
        "step script inventory mismatch: " \
        f"unreferenced={sorted(p.name for p in all_scripts - referenced)}, " \
        f"missing={sorted(str(p) for p in referenced - all_scripts)}"

    for step in stage["steps"] + publish["steps"]:
        if "run" in step:
            assert step.get("run_path"), f"model lost run_path for {step.get('name')}"
        if "script_path" in (step.get("with") or {}):
            assert (step.get("with") or {}).get("script"), f"model lost remote script for {step.get('name')}"

    for path in [workflow_dir / CALLER, *(workflow_dir / name for name in WORKFLOW_FILES.values()),
                 root / "scripts" / "android-release" / "workflow_model.py", *sorted(all_scripts)]:
        _assert_compact(path)

    print("Android workflow contract: PASS")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
