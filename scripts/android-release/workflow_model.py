#!/usr/bin/env python3
"""Resolve the split Android release workflows into the original logical model.

The release protocol lives in one orchestrator plus three workflow_call
workflows, with every inline shell block in a step script. Tests should keep
asserting the protocol rather than the file layout, so they load the model.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

JOB_WORKFLOWS = {
    "stage": "android-stage.yml",
    "publish_gate": "android-publish-gate.yml",
    "publish": "android-publish.yml",
}
_RUN_PATH = re.compile(r'/scripts/android-release/steps/([^"]+\.sh)"')


def _load(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _step_text(path: Path) -> str:
    """Return an extracted step body without its provenance header."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if lines and lines[0].startswith("#!"):
        lines = lines[3:]
    return "\n".join(lines).strip("\n") + "\n"


def load(root) -> dict:
    """Return the release workflow as one logical object.

    Job-level if/needs/permissions come from the caller jobs; each run step
    exposes its external script as run and each remote command file as
    with.script, matching the pre-split workflow shape.
    """
    root = Path(root)
    workflows = root / ".github" / "workflows"
    orchestrator = _load(workflows / "android-release.yml")
    model = {
        "name": orchestrator.get("name"),
        "on": orchestrator.get(True, orchestrator.get("on")),
        "permissions": orchestrator.get("permissions"),
        "concurrency": orchestrator.get("concurrency"),
        "env": orchestrator.get("env", {}),
        "jobs": {},
    }
    for job_id, filename in JOB_WORKFLOWS.items():
        caller = orchestrator["jobs"][job_id]
        called = _load(workflows / filename)["jobs"][job_id]
        job = dict(called)
        for key in ("if", "needs", "permissions"):
            if key in caller:
                job[key] = caller[key]
        steps = []
        for step in called.get("steps", []):
            resolved = dict(step)
            if "run" in resolved:
                match = _RUN_PATH.search(resolved["run"])
                if not match:
                    raise ValueError(f"cannot resolve run script for {job_id}: {resolved['run']}")
                resolved["run_path"] = f"scripts/android-release/steps/{match.group(1)}"
                resolved["run"] = _step_text(root / resolved["run_path"])
            if "with" in resolved and "script_path" in resolved["with"]:
                with_ = dict(resolved["with"])
                with_["script"] = _step_text(root / with_["script_path"])
                resolved["with"] = with_
            steps.append(resolved)
        job["steps"] = steps
        model["jobs"][job_id] = job
    return model
