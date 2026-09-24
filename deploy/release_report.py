#!/usr/bin/env python3
"""Build and validate run-scoped reports for the Production Release DAG."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


SHA = re.compile(r"[0-9a-f]{40}\Z")
DOMAINS = ("foundation", "cloud", "tx", "yecao", "observability")
KINDS = {"build": "buildComponents", "deploy": "deployServices", "tofu": "tofuRoots"}
JOB_SUCCESS = "success"
VALID_JOB_RESULTS = frozenset({"success", "failure", "cancelled", "skipped"})
DOMAIN_OPERATIONS = {
    "foundation": {
        "build": {"minio"},
        "deploy": {"rabbitmq", "business-postgres", "keycloak-postgres", "minio"},
        "tofu": {"rabbitmq", "business-postgres", "keycloak-postgres", "minio"},
    },
    "cloud": {"build": set(), "deploy": set(), "tofu": {"cos"}},
    "tx": {
        "build": {"business-api", "frontend", "keycloak"},
        "deploy": {"business-api", "frontend", "keycloak", "caddy"},
        "tofu": {"keycloak"},
    },
    "yecao": {"build": {"parser-worker"}, "deploy": {"parser-worker"}, "tofu": set()},
    "observability": {
        "build": set(),
        "deploy": {"node-exporter", "prometheus", "loki", "alloy", "grafana"},
        "tofu": {"grafana"},
    },
}


def json_object(value: str, label: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} is not valid JSON: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{label} must be a JSON object")
    return parsed


def json_needs(value: str) -> dict[str, dict[str, Any]]:
    parsed = json_object(value, "needs")
    needs: dict[str, dict[str, Any]] = {}
    for job_id, job in parsed.items():
        if not isinstance(job_id, str) or not isinstance(job, dict):
            raise ValueError("needs entries must map job ids to objects")
        result = job.get("result")
        if not isinstance(result, str) or result not in VALID_JOB_RESULTS:
            raise ValueError(f"job {job_id} has an invalid result")
        needs[job_id] = job
    return needs


def json_array(value: str, label: str) -> list[str]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} is not valid JSON: {exc.msg}") from exc
    if not isinstance(parsed, list) or any(not isinstance(item, str) for item in parsed):
        raise ValueError(f"{label} must be a JSON string array")
    if len(set(parsed)) != len(parsed):
        raise ValueError(f"{label} contains duplicate values")
    return parsed


def selected_from_args(args: argparse.Namespace) -> dict[str, list[str]]:
    return {
        "buildComponents": json_array(args.build_components, "build_components"),
        "deployServices": json_array(args.deploy_services, "deploy_services"),
        "tofuRoots": json_array(args.tofu_roots, "tofu_roots"),
    }


def validate_identity(report: Any, *, run_id: str, attempt: str, source_sha: str, domain: str) -> None:
    if not isinstance(report, dict) or report.get("schemaVersion") != 1:
        raise ValueError("report schemaVersion is missing or unsupported")
    expected = {
        "runId": str(run_id),
        "runAttempt": str(attempt),
        "sourceSha": source_sha,
        "domain": domain,
    }
    for key, value in expected.items():
        if str(report.get(key, "")) != value:
            raise ValueError(f"report {key} does not match this release run")
    jobs = report.get("jobs")
    selected = report.get("selected")
    if not isinstance(jobs, dict) or not isinstance(selected, dict):
        raise ValueError("report jobs/selected shape is invalid")
    if set(selected) != set(KINDS.values()) or any(
        not isinstance(selected[key], list)
        or any(not isinstance(item, str) for item in selected[key])
        or len(set(selected[key])) != len(selected[key])
        for key in KINDS.values()
    ):
        raise ValueError("report selected work has an invalid shape")
    if any(
        not isinstance(job_id, str)
        or not isinstance(result, str)
        or result not in VALID_JOB_RESULTS
        for job_id, result in jobs.items()
    ):
        raise ValueError("report job results have an invalid shape")


def write_report(args: argparse.Namespace) -> None:
    if args.domain not in DOMAINS:
        raise ValueError(f"unsupported domain: {args.domain}")
    if not SHA.fullmatch(args.source_sha):
        raise ValueError("source SHA must be a full lowercase commit SHA")
    if not args.run_id.isdigit() or not args.run_attempt.isdigit():
        raise ValueError("run id and attempt must be positive integers")
    selected = selected_from_args(args)
    needs = json_needs(args.needs_json)
    jobs: dict[str, str] = {}
    for job_id, job in needs.items():
        jobs[job_id] = job["result"]
    build_outputs: dict[str, dict[str, str]] = {}
    for component in ("business-api", "frontend", "keycloak", "parser-worker", "minio"):
        job_id = selected_job_id("build", component)
        job = needs.get(job_id)
        if not isinstance(job, dict) or job.get("result") != JOB_SUCCESS:
            continue
        outputs = job.get("outputs")
        if not isinstance(outputs, dict):
            continue
        image = outputs.get("image")
        digest = outputs.get("digest")
        commit_sha = outputs.get("commit_sha")
        tag = outputs.get("tag")
        if all(isinstance(value, str) and value for value in (image, digest, commit_sha, tag)):
            build_outputs[component] = {
                "image": image,
                "digest": digest,
                "commitSha": commit_sha,
                "tag": tag,
            }
    report = {
        "schemaVersion": 1,
        "runId": args.run_id,
        "runAttempt": args.run_attempt,
        "sourceSha": args.source_sha,
        "domain": args.domain,
        "selected": selected,
        "jobs": jobs,
        "builds": build_outputs,
    }
    gate_job = needs.get("dependency_gates")
    if isinstance(gate_job, dict) and gate_job.get("result") == JOB_SUCCESS:
        outputs = gate_job.get("outputs")
        raw_diagnostics = outputs.get("diagnostics") if isinstance(outputs, dict) else None
        if isinstance(raw_diagnostics, str):
            try:
                diagnostics = json.loads(raw_diagnostics)
            except json.JSONDecodeError as exc:
                raise ValueError("dependency gate diagnostics are not valid JSON") from exc
            if not isinstance(diagnostics, dict) or any(
                not isinstance(consumer, str)
                or not isinstance(reasons, list)
                or any(not isinstance(reason, str) for reason in reasons)
                for consumer, reasons in diagnostics.items()
            ):
                raise ValueError("dependency gate diagnostics have an invalid shape")
            report["gates"] = diagnostics
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)


def check_domain(args: argparse.Namespace) -> None:
    if args.domain not in DOMAIN_OPERATIONS:
        raise ValueError(f"unsupported domain: {args.domain}")
    selected = selected_from_args(args)
    needs = json_needs(args.needs_json)
    failures: list[str] = []
    for kind, items in DOMAIN_OPERATIONS[args.domain].items():
        planned_items = set(selected[KINDS[kind]]) & items
        for item in sorted(planned_items):
            job_id = selected_job_id(kind, item)
            job = needs.get(job_id)
            result = job.get("result") if isinstance(job, dict) else None
            if result != JOB_SUCCESS:
                failures.append(f"selected {kind}/{item} ended as {result or 'missing'}")
    if failures:
        raise ValueError("; ".join(failures))


def selected_job_id(kind: str, item: str) -> str:
    return f"{kind}_{item.replace('-', '_')}"


def dependency_gate(args: argparse.Namespace) -> None:
    if not SHA.fullmatch(args.source_sha):
        raise ValueError("source SHA must be a full lowercase commit SHA")
    if not args.run_id.isdigit() or not args.run_attempt.isdigit():
        raise ValueError("run id and attempt must be positive integers")
    selectors = {kind: json_array(getattr(args, kind), KINDS[kind]) for kind in KINDS}
    try:
        gates = json.loads(args.gates_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"gates is not valid JSON: {exc.msg}") from exc
    if not isinstance(gates, dict) or not gates:
        raise ValueError("gates must be a non-empty JSON object")

    reports: dict[str, Any] = {}
    for domain, filename in (("foundation", args.foundation_report), ("cloud", args.cloud_report)):
        path = Path(filename)
        if path.is_file():
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                validate_identity(
                    value,
                    run_id=args.run_id,
                    attempt=args.run_attempt,
                    source_sha=args.source_sha,
                    domain=domain,
                )
                reports[domain] = value
            except (OSError, ValueError) as exc:
                reports[domain] = exc

    lines: list[str] = []
    summary: list[str] = []
    diagnostics: dict[str, list[str]] = {}
    for consumer, dependencies in gates.items():
        if not isinstance(consumer, str) or not isinstance(dependencies, dict):
            raise ValueError("each gate must map a consumer id to domain requirements")
        failures: list[str] = []
        for domain, requirements in dependencies.items():
            if domain not in ("foundation", "cloud") or not isinstance(requirements, list):
                raise ValueError(f"invalid requirements for {consumer}/{domain}")
            for requirement in requirements:
                if (
                    not isinstance(requirement, list)
                    or len(requirement) != 2
                    or requirement[0] not in KINDS
                    or not isinstance(requirement[1], str)
                ):
                    raise ValueError(f"invalid requirement for {consumer}/{domain}")
                kind, item = requirement
                if item not in selectors[kind]:
                    continue
                report = reports.get(domain)
                if report is None:
                    failures.append(f"{domain} report missing for selected {kind}/{item}")
                    continue
                if isinstance(report, Exception):
                    failures.append(f"{domain} report invalid: {report}")
                    continue
                selected_key = KINDS[kind]
                if item not in report["selected"].get(selected_key, []):
                    failures.append(f"{domain} report omitted selected {kind}/{item}")
                    continue
                job_id = selected_job_id(kind, item)
                result = report["jobs"].get(job_id)
                if result != JOB_SUCCESS:
                    failures.append(f"{domain}/{job_id} result is {result or 'missing'}")
        output_key = f"{consumer}_ready"
        lines.append(f"{output_key}={'false' if failures else 'true'}")
        diagnostics[consumer] = failures
        if failures:
            summary.append(f"{consumer}: BLOCKED: {'; '.join(failures)}")
        else:
            summary.append(f"{consumer}: selected dependencies are ready or unchanged")
    lines.append(f"diagnostics={json.dumps(diagnostics, separators=(',', ':'))}")
    Path(args.output).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(summary))
    if args.summary_output:
        summary_path = Path(args.summary_output)
        with summary_path.open("a", encoding="utf-8") as output:
            output.write("# Release dependency gates\n\n")
            output.writelines(f"- {line}\n" for line in summary)


def render_plan_summary(args: argparse.Namespace) -> None:
    plan = json.loads(Path(args.plan_file).read_text(encoding="utf-8"))
    release = plan.get("release")
    if not isinstance(release, dict):
        raise ValueError("planner output lacks release section")
    output = [
        "# Production Release Plan",
        "",
        f"- Range: `{args.base_sha}` → `{args.head_sha}`",
        f"- Build: {', '.join(release.get('buildComponents', [])) or 'none'}",
        f"- Deploy: {', '.join(release.get('deployServices', [])) or 'none'}",
        f"- ToFu: {', '.join(release.get('tofuRoots', [])) or 'none'}",
        "",
        "## Selection reasons",
        "",
    ]
    reasons = plan.get("reasons", {})
    if reasons:
        output.extend(f"- `{key}`: {value}" for key, value in reasons.items())
    else:
        output.append("- No production changes selected.")
    Path(args.output).write_text("\n".join(output) + "\n", encoding="utf-8")


def render_final_summary(args: argparse.Namespace) -> None:
    try:
        plan = json.loads(Path(args.plan_file).read_text(encoding="utf-8"))
        if not isinstance(plan, dict) or not isinstance(plan.get("release"), dict):
            raise ValueError("release plan object is invalid")
        release = plan["release"]
        builds = release.get("buildComponents")
        services = release.get("deployServices")
        roots = release.get("tofuRoots")
        for label, value in (("buildComponents", builds), ("deployServices", services), ("tofuRoots", roots)):
            if (
                not isinstance(value, list)
                or any(not isinstance(item, str) for item in value)
                or len(set(value)) != len(value)
            ):
                raise ValueError(f"release plan {label} is invalid")
        reasons = plan.get("reasons", {})
        if not isinstance(reasons, dict) or any(
            not isinstance(key, str) or not isinstance(reason, str)
            for key, reason in reasons.items()
        ):
            raise ValueError("release plan reasons are invalid")
    except (OSError, KeyError, TypeError, ValueError) as exc:
        Path(args.output).write_text(
            "# Production Release\n\nPlan artifact is missing or invalid; no release result can be confirmed.\n",
            encoding="utf-8",
        )
        raise ValueError(f"release plan artifact is missing or invalid: {exc}") from exc

    try:
        needs = json_needs(args.needs_json)
    except ValueError as exc:
        needs = {}
        parse_error = str(exc)
    else:
        parse_error = ""

    domain_work = {
        "foundation": bool(set(builds) & {"minio"}
                           or set(services) & {"rabbitmq", "business-postgres", "keycloak-postgres", "minio"}
                           or set(roots) & {"rabbitmq", "business-postgres", "keycloak-postgres", "minio"}),
        "cloud": "cos" in roots,
        "tx": bool(set(builds) & {"business-api", "frontend", "keycloak"}
                   or set(services) & {"business-api", "frontend", "keycloak", "caddy"}
                   or "keycloak" in roots),
        "yecao": bool("parser-worker" in builds or "parser-worker" in services),
        "observability": bool(set(services) & {"node-exporter", "prometheus", "loki", "alloy", "grafana"}
                              or "grafana" in roots),
    }
    statuses = {name: str(needs.get(name, {}).get("result", "missing")) for name in domain_work}
    failures = [f"{domain}: {statuses[domain]}" for domain, selected in domain_work.items()
                if selected and statuses[domain] != JOB_SUCCESS]
    report_builds: dict[str, dict[str, str]] = {}
    reports: dict[str, dict[str, Any]] = {}
    report_gates: dict[str, dict[str, list[str]]] = {}
    for domain, selected in domain_work.items():
        if not selected:
            continue
        report_path = Path(args.reports_dir) / domain / "release-report.json"
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
            validate_identity(
                report,
                run_id=args.run_id,
                attempt=args.run_attempt,
                source_sha=args.head_sha,
                domain=domain,
            )
            if report.get("selected") != {
                "buildComponents": builds,
                "deployServices": services,
                "tofuRoots": roots,
            }:
                raise ValueError("report selected work differs from the Release plan")
            if not isinstance(report.get("builds"), dict):
                raise ValueError("report build identities are missing")
            reports[domain] = report
            for component, identity in report["builds"].items():
                if (
                    not isinstance(component, str)
                    or not isinstance(identity, dict)
                    or any(not isinstance(identity.get(key), str) or not identity[key]
                           for key in ("image", "digest", "commitSha", "tag"))
                ):
                    raise ValueError("report contains an invalid build identity")
                report_builds[component] = identity
            gates = report.get("gates", {})
            if not isinstance(gates, dict) or any(
                not isinstance(consumer, str)
                or not isinstance(reasons, list)
                or any(not isinstance(reason, str) for reason in reasons)
                for consumer, reasons in gates.items()
            ):
                raise ValueError("report dependency gates are invalid")
            report_gates[domain] = gates
        except (OSError, ValueError) as exc:
            failures.append(f"{domain}: report unavailable or invalid ({exc})")
    operation_results: list[tuple[str, str, str]] = []
    for kind, items, candidate_domains in (
        ("build", builds, ("foundation", "tx", "yecao", "observability")),
        ("deploy", services, ("foundation", "tx", "yecao", "observability")),
        ("tofu", roots, ("foundation", "cloud", "tx", "observability")),
    ):
        for item in items:
            domain = next(
                (candidate for candidate in candidate_domains
                 if item in DOMAIN_OPERATIONS[candidate][kind]),
                None,
            )
            if domain is None:
                failures.append(f"selected {kind}/{item}: no owning domain")
                operation_results.append((f"{kind}/{item}", "unknown", "invalid plan"))
                continue
            report = reports.get(domain, {})
            job_result = report.get("jobs", {}).get(selected_job_id(kind, item), "missing")
            operation_results.append((f"{kind}/{item}", domain, str(job_result)))
            if job_result != JOB_SUCCESS:
                failures.append(f"{kind}/{item}: {job_result} in {domain}")
            if kind == "build" and job_result == JOB_SUCCESS and item not in report_builds:
                failures.append(f"build/{item}: image identity unavailable")
    failed = bool(parse_error or failures)

    output = [
        "# Production Release",
        "",
        f"- Commit: `{args.head_sha}`",
        f"- Range: `{args.base_sha}` → `{args.head_sha}`",
        "",
        "## Selected work",
        "",
        "| Work | Selection |",
        "|---|---|",
        f"| Build | {', '.join(builds) or 'none'} |",
        f"| Deploy | {', '.join(services) or 'none'} |",
        f"| ToFu | {', '.join(roots) or 'none'} |",
        "",
        "## Domain results",
        "",
        "| Domain | Work selected | Result |",
        "|---|---:|---|",
    ]
    output.extend(
        f"| {domain} | {'yes' if selected else 'no'} | {statuses[domain]} |"
        for domain, selected in domain_work.items()
    )
    output.extend(["", "## Selected operation results", "", "| Operation | Domain | Result |", "|---|---|---|"])
    output.extend(f"| {name} | {domain} | {result} |" for name, domain, result in operation_results)
    blocked_consumers = {
        "business-api": ("tx", "business_api"),
        "keycloak": ("tx", "keycloak"),
        "frontend": ("tx", "frontend"),
        "caddy": ("tx", "caddy"),
        "parser-worker": ("yecao", "parser_worker"),
    }
    blockers = [
        f"{service}: {'; '.join(report_gates.get(domain, {}).get(consumer, []))}"
        for service in services
        if service in blocked_consumers
        for domain, consumer in [blocked_consumers[service]]
        if report_gates.get(domain, {}).get(consumer)
    ]
    output.extend(["", "## Dependency blockers", ""])
    output.extend(f"- {blocker}" for blocker in blockers)
    if not blockers:
        output.append("- None reported.")
    output.extend(["", "## Images", "", "| Component | Immutable image | Digest | Source SHA |", "|---|---|---|---|"])
    for component in builds:
        image = report_builds.get(component)
        if image:
            output.append(f"| {component} | `{image['image']}` | `{image['digest']}` | `{image['commitSha']}` |")
        else:
            output.append(f"| {component} | identity unavailable | unavailable | unavailable |")
    output.extend(["", "## Selection reasons", ""])
    output.extend(f"- `{key}`: {value}" for key, value in reasons.items())
    if parse_error:
        output.extend(["", f"**Release failed:** {parse_error}"])
    elif failures:
        output.extend(["", "**Selected release work did not complete:**", ""])
        output.extend(f"- {failure}" for failure in failures)
        output.extend(["", "Inspect the matching domain report artifact for operation-level results."])
    elif not any(domain_work.values()):
        output.extend(["", "No production work was selected."])
    Path(args.output).write_text("\n".join(output) + "\n", encoding="utf-8")
    if failed:
        raise ValueError("selected release work did not all succeed")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    command = commands.add_parser("write")
    command.add_argument("--domain", required=True)
    command.add_argument("--run-id", required=True)
    command.add_argument("--run-attempt", required=True)
    command.add_argument("--source-sha", required=True)
    command.add_argument("--build-components", required=True)
    command.add_argument("--deploy-services", required=True)
    command.add_argument("--tofu-roots", required=True)
    command.add_argument("--needs-json", required=True)
    command.add_argument("--output", required=True)
    command.set_defaults(func=write_report)
    gate = commands.add_parser("gate")
    gate.add_argument("--run-id", required=True)
    gate.add_argument("--run-attempt", required=True)
    gate.add_argument("--source-sha", required=True)
    gate.add_argument("--build", required=True)
    gate.add_argument("--deploy", required=True)
    gate.add_argument("--tofu", required=True)
    gate.add_argument("--foundation-report", required=True)
    gate.add_argument("--cloud-report", required=True)
    gate.add_argument("--gates-json", required=True)
    gate.add_argument("--output", required=True)
    gate.add_argument("--summary-output")
    gate.set_defaults(func=dependency_gate)
    check = commands.add_parser("check-domain")
    check.add_argument("--domain", required=True)
    check.add_argument("--build-components", required=True)
    check.add_argument("--deploy-services", required=True)
    check.add_argument("--tofu-roots", required=True)
    check.add_argument("--needs-json", required=True)
    check.set_defaults(func=check_domain)
    plan = commands.add_parser("plan-summary")
    plan.add_argument("--plan-file", required=True)
    plan.add_argument("--base-sha", required=True)
    plan.add_argument("--head-sha", required=True)
    plan.add_argument("--output", required=True)
    plan.set_defaults(func=render_plan_summary)
    summary = commands.add_parser("summary")
    summary.add_argument("--plan-file", required=True)
    summary.add_argument("--needs-json", required=True)
    summary.add_argument("--base-sha", required=True)
    summary.add_argument("--head-sha", required=True)
    summary.add_argument("--run-id", required=True)
    summary.add_argument("--run-attempt", required=True)
    summary.add_argument("--reports-dir", default="release-artifacts")
    summary.add_argument("--output", required=True)
    summary.set_defaults(func=render_final_summary)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        args.func(args)
    except (OSError, ValueError) as exc:
        print(f"release report error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
