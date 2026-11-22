#!/usr/bin/env python3
"""Print the conclusion of the stage job for an Android release run.

GitHub reports a reusable-workflow job as '<caller job name> / <called job
name>' (for example 'stage / stage'). Runs created before the split report the
bare caller job name 'stage'. Both shapes identify the same stage job; anything
else is ambiguous and must fail closed.
"""
from __future__ import annotations

import json
import sys

STAGE_JOB_NAMES = ("stage", "stage / stage")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"cannot parse gh run view jobs JSON: {exc}", file=sys.stderr)
        return 1
    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        print("gh run view output has no jobs list", file=sys.stderr)
        return 1
    matches = [job for job in jobs if job.get("name") in STAGE_JOB_NAMES]
    if len(matches) != 1:
        names = sorted(str(job.get("name")) for job in jobs)
        print(
            f"expected exactly one stage job named 'stage' or 'stage / stage', "
            f"found {len(matches)}; jobs={names}",
            file=sys.stderr,
        )
        return 1
    conclusion = matches[0].get("conclusion")
    if not conclusion:
        print("stage job has no conclusion yet", file=sys.stderr)
        return 1
    print(conclusion)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
