#!/usr/bin/env python3
"""Advisory PR area check; taxonomy is shared with the metrics exporter."""

import json
import os
from pathlib import Path


def check(event, taxonomy):
    """Return an advisory for missing/unknown areas without blocking a PR."""
    pr = event.get("pull_request")
    if not pr:
        return []
    labels = {label["name"] for label in pr.get("labels", [])}
    areas = {f"area/{area}" for area in taxonomy}
    messages = []
    if not labels & areas:
        messages.append("PR has no recognized area/* label; choose at least one from the documented taxonomy.")
    if any(label.startswith("area/") and label not in areas for label in labels):
        messages.append("PR has an unknown area/* label; update the taxonomy explicitly before using a new area.")
    return messages


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    taxonomy = json.loads((root / "deploy/observability/dev-metrics/area-taxonomy.json").read_text())
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    for message in check(event, taxonomy):
        print(f"::warning::{message}")
