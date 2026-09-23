#!/usr/bin/env python3
"""Interpret one complete Git range for PR validation and production release.

The checked out files are deliberately not used as the source of the Maven or
Compose graph: both are read from --head, the same frozen commit that is built.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHA = re.compile(r"[0-9a-f]{40}\Z")
COMPONENTS = ("business-api", "frontend", "keycloak", "parser-worker", "minio")
IMAGE_SERVICES = set(COMPONENTS)
TX_SERVICES = ("keycloak-postgres", "business-postgres", "rabbitmq", "keycloak", "frontend", "business-api", "caddy")
YECAO_SERVICES = ("parser-worker", "node-exporter", "prometheus", "loki", "alloy", "grafana", "minio")
COMPOSE_NAMES = {
    "deploy/tx/docker-compose.yml": {"wotb-frontend": "frontend", "health-probe": None},
    "deploy/docker-compose.prod.yml": {},
    "deploy/docker-compose.minio.yml": {},
}
TOFU_ROOTS = {
    "keycloak": "infra/tofu/keycloak/",
    "rabbitmq": "infra/tofu/rabbitmq/",
    "business-postgres": "infra/tofu/postgres-business/",
    "keycloak-postgres": "infra/tofu/postgres-keycloak/",
    "minio": "infra/tofu/minio/",
    "cos": "infra/tofu/environments/prod/",
    "grafana": "infra/tofu/grafana/",
}
SURFACES = (
    "backend", "frontend", "keycloak", "httpContract", "data", "liveData",
    "deploy", "observability", "android", "keycloakProvider", "keycloakRuntime", "full",
)
PROVIDER_DIRS = ("keycloak-qq-provider/", "keycloak-wargaming-provider/")
COMMON_JAVA = (
    "common/tankopedia-tier7.json", "common/tankopedia-tier8.json",
    "common/tankopedia-tier9.json", "common/tankopedia-tier10.json",
    "common/map_names.json", "common/tank_tactical_profiles.json",
)
FRONTEND_COMMON = (
    "common/map_names.json", "common/tankopedia-tier10.json",
    # docker/Dockerfile.frontend COPYs these documents and the SPA inlines them with
    # `?raw`, so editing one changes the produced bundle; .dockerignore re-includes them.
    "HISTORY.md", "docs/architecture/TECHNICAL_EVOLUTION.md", "docs/WotBTools_League_Rating_V6.md",
)
# The browser suites are the slow end-to-end checks, so they follow the frontend
# surfaces that mount, route or size every view rather than a filename substring:
# the HTML entry, the app bootstrap/root component, the shell package (AppShell,
# router, ViewHost, navigation, view registry) and the global stylesheets. A change
# there can break both the playback layout and the workspace interaction flows, so
# both suites run; the playback-only heuristics stay below.
FRONTEND_GLOBAL_PATHS = (
    "frontend/index.html",
    "frontend/src/main.js",
    "frontend/src/App.vue",
    "frontend/src/styles/app-shell.css",
    "frontend/src/styles/tokens.css",
)
FRONTEND_GLOBAL_PREFIXES = ("frontend/src/app/",)
BROWSER_SUITES = ("playback-layout", "workspace-interaction")
OBS_CONFIG = {
    "deploy/observability/prometheus/": "prometheus",
    "deploy/observability/loki/": "loki",
    "deploy/observability/alloy/": "alloy",
    "deploy/observability/grafana/provisioning/": "grafana",
}


def git(*args: str, allow_missing: bool = False) -> bytes | None:
    run = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if run.returncode:
        if allow_missing:
            return None
        raise ValueError(f"git {' '.join(args[:2])} failed: {run.stderr.decode(errors='replace').strip()}")
    return run.stdout


def blob(sha: str, path: str) -> str | None:
    value = git("show", f"{sha}:{path}", allow_missing=True)
    return None if value is None else value.decode("utf-8")


def changed_paths(base: str, head: str) -> list[str]:
    raw = git("diff", "--name-status", "-z", "-M", base, head)
    assert raw is not None
    fields = raw.decode("utf-8").split("\0")
    result: list[str] = []
    position = 0
    while position < len(fields) - 1:
        status = fields[position]
        position += 1
        if not status or status[0] not in "ACDMRTUXB":
            raise ValueError(f"unsupported git change status {status!r}")
        count = 2 if status[0] in "RC" else 1
        result.extend(fields[position:position + count])
        position += count
    return sorted(set(result))


def validate_revisions(base: str, head: str) -> None:
    for name, sha in (("base", base), ("head", head)):
        if not SHA.fullmatch(sha):
            raise ValueError(f"{name} must be a full lowercase commit SHA")
        kind = git("cat-file", "-t", sha)
        if kind != b"commit\n":
            raise ValueError(f"{name} is not a commit")


def pom_graph(head: str) -> tuple[list[str], dict[str, set[str]]]:
    namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
    root_text = blob(head, "java/pom.xml")
    if root_text is None:
        raise ValueError("missing java/pom.xml")
    try:
        root = ET.fromstring(root_text)
        modules = [node.text for node in root.findall("m:modules/m:module", namespace)]
        if not modules or any(not item or "/" in item or item.startswith(".") for item in modules):
            raise ValueError("invalid Maven reactor module list")
        if len(set(modules)) != len(modules):
            raise ValueError("duplicate Maven reactor module")
        dependencies: dict[str, set[str]] = {}
        for module in modules:
            source = blob(head, f"java/{module}/pom.xml")
            if source is None:
                raise ValueError(f"missing POM for {module}")
            pom = ET.fromstring(source)
            artifact = pom.findtext("m:artifactId", namespaces=namespace)
            if artifact != module:
                raise ValueError(f"module {module} artifactId mismatch: {artifact}")
            dependencies[module] = set()
            for dependency in pom.findall("m:dependencies/m:dependency", namespace):
                if dependency.findtext("m:groupId", namespaces=namespace) != "com.wotb":
                    continue
                target = dependency.findtext("m:artifactId", namespaces=namespace)
                if target not in modules:
                    raise ValueError(f"{module} has unknown reactor dependency {target}")
                dependencies[module].add(target)
        for module in modules:
            walk_closure(module, dependencies)
        for image_root in ("wotb-web", "wotb-parser-worker"):
            if image_root not in modules:
                raise ValueError(f"missing production reactor root {image_root}")
        return modules, dependencies
    except ET.ParseError as error:
        raise ValueError(f"invalid Maven POM: {error}") from error


def walk_closure(module: str, graph: dict[str, set[str]], visiting: set[str] | None = None) -> set[str]:
    visiting = set() if visiting is None else visiting
    if module in visiting:
        raise ValueError(f"Maven reactor cycle at {module}")
    visiting.add(module)
    result = {module}
    for dependency in graph[module]:
        result.update(walk_closure(dependency, graph, visiting))
    visiting.remove(module)
    return result


def compose_parts(source: str | None) -> tuple[dict[str, str], str]:
    if source is None:
        raise ValueError("missing production Compose file")
    lines = source.splitlines(keepends=True)
    starts = [index for index, line in enumerate(lines) if re.match(r"^services:\s*(?:#.*)?$", line)]
    if len(starts) != 1:
        raise ValueError("Compose must contain one top-level services section")
    start = starts[0]
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^[^\s#][^:]*:", lines[i])), len(lines))
    service_lines = lines[start + 1:end]
    boundaries = [(i, re.match(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$", line).group(1))
                  for i, line in enumerate(service_lines)
                  if re.match(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$", line)]
    if not boundaries:
        raise ValueError("Compose has no recognizable services")
    services = {name: "".join(service_lines[index:boundaries[pos + 1][0] if pos + 1 < len(boundaries) else len(service_lines)])
                for pos, (index, name) in enumerate(boundaries)}
    shared = "".join(lines[:start + 1] + lines[end:]) + "".join(service_lines[:boundaries[0][0]])
    return services, shared


def compose_affected(base: str, head: str, path: str) -> tuple[set[str], str | None]:
    before, before_shared = compose_parts(blob(base, path))
    after, after_shared = compose_parts(blob(head, path))
    aliases = COMPOSE_NAMES[path]
    expected = set(TX_SERVICES if path.startswith("deploy/tx/") else ("minio",) if path.endswith("minio.yml") else YECAO_SERVICES) - ({"minio"} if path.endswith("prod.yml") else set())
    actual = {aliases.get(name, name) for name in after} - {None}
    if actual != expected:
        raise ValueError(f"unexpected Compose service set in {path}: {sorted(actual ^ expected)}")
    if set(before) != set(after) or before_shared != after_shared:
        return actual, "shared Compose change selects every service"
    if path.startswith("deploy/tx/") and before.get("health-probe") != after.get("health-probe"):
        return actual, "shared TX verification probe change selects every service"
    selected = {aliases.get(name, name) for name in after if before[name] != after[name]} - {None}
    return selected, None


def matches(path: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(path, pattern)


def plan(base: str, head: str) -> dict[str, object]:
    validate_revisions(base, head)
    paths = changed_paths(base, head)
    modules, graph = pom_graph(head)
    closures = {"business-api": walk_closure("wotb-web", graph), "parser-worker": walk_closure("wotb-parser-worker", graph)}
    surfaces = {name: False for name in SURFACES}
    build: set[str] = set()
    deploy: set[str] = set()
    tofu: set[str] = set()
    packaging: set[str] = set()
    java_modules: set[str] = set()
    browser: set[str] = set()
    reasons: dict[str, str] = {}
    java_full = False
    for path in paths:
        if path.endswith(".md") and path not in FRONTEND_COMMON:
            continue
        if path.startswith("docs/") and path not in FRONTEND_COMMON:
            continue
        if path.startswith(".github/workflows/") or path.startswith("scripts/ci/") or path == "deploy/release_plan.py":
            surfaces["full"] = True
            continue
        if path.startswith("java/"):
            surfaces["backend"] = True
            if path == "java/pom.xml":
                java_full = True
                surfaces["full"] = True
                build.update(("business-api", "parser-worker"))
            elif path == "java/settings-docker.xml":
                build.update(("business-api", "parser-worker", "keycloak"))
                surfaces["keycloak"] = surfaces["keycloakRuntime"] = True
            elif path == "java/settings.xml":
                surfaces["full"] = True
            elif path.startswith("java/") and len(path.split("/")) >= 3:
                module = path.split("/")[1]
                if module not in modules:
                    raise ValueError(f"unknown changed Java module {module}")
                java_modules.add(module)
                if "/src/main/" in path or path.endswith("/pom.xml"):
                    build.update(component for component, closure in closures.items() if module in closure)
                if module == "wotb-web":
                    surfaces["httpContract"] = True
            else:
                # A new global Java build input cannot be assigned to one module.
                java_full = surfaces["full"] = True
                build.update(("business-api", "parser-worker"))
            continue
        if path.startswith("frontend/"):
            surfaces["frontend"] = True
            frontend_test = path.endswith((".test.js", ".test.ts", ".spec.js", ".spec.ts"))
            if ((path.startswith("frontend/src/") and not frontend_test)
                    or path.startswith("frontend/public/") or path.startswith("frontend/homepage/")
                    or path in ("frontend/index.html", "frontend/package.json", "frontend/package-lock.json", "frontend/vite.config.js")):
                build.add("frontend")
            if path.startswith("frontend/src/api/"):
                surfaces["httpContract"] = True
            if path in FRONTEND_GLOBAL_PATHS or path.startswith(FRONTEND_GLOBAL_PREFIXES):
                browser.update(BROWSER_SUITES)
            if "Playback" in path or "ReplayWorkspace" in path or "ReplayPage" in path:
                browser.add("workspace-interaction")
            if path.endswith(".css") or "Layout" in path or "Playback" in path or "ReplayPage" in path:
                browser.add("playback-layout")
            if path in ("frontend/package.json", "frontend/package-lock.json", "frontend/vite.config.js", "frontend/vitest.config.js"):
                surfaces["full"] = True
            continue
        if path.startswith(PROVIDER_DIRS):
            surfaces["keycloak"] = surfaces["keycloakProvider"] = True
            if "/src/main/" in path or path.endswith("/pom.xml"):
                build.add("keycloak")
                surfaces["keycloakRuntime"] = True
                packaging.add("keycloak")
            continue
        if path.startswith("docker/"):
            surfaces["deploy"] = True
            if path.startswith("docker/keycloak/"):
                build.add("keycloak")
                surfaces["keycloakRuntime"] = True
                packaging.add("keycloak")
            elif path.startswith("docker/Dockerfile."):
                component = path.removeprefix("docker/Dockerfile.")
                component = "business-api" if component in ("backend", "business-api") else component
                if component not in COMPONENTS:
                    raise ValueError(f"unknown production Dockerfile {path}")
                build.add(component)
                packaging.add(component)
                if component == "keycloak":
                    surfaces["keycloakRuntime"] = True
            else:
                raise ValueError(f"unmapped production Docker input {path}")
            continue
        if path == ".dockerignore":
            surfaces["full"] = surfaces["deploy"] = True
            build.update(COMPONENTS)
            packaging.update(COMPONENTS)
            continue
        if path in COMMON_JAVA or path.startswith("common/map-semantics/"):
            surfaces["backend"] = surfaces["data"] = True
            build.update(("business-api", "parser-worker"))
        elif path.startswith("common/assets/"):
            surfaces["frontend"] = surfaces["data"] = True
            build.add("frontend")
        elif path.startswith("common/") or path.startswith("map-semanticizer/"):
            surfaces["data"] = True
        if path in FRONTEND_COMMON:
            surfaces["frontend"] = True
            build.add("frontend")
        if path.startswith("common/wotb-item-catalog-json/") or matches(path, "common/tankopedia-*.json") or path in ("common/crew-skills.json",):
            surfaces["liveData"] = True
        if path.startswith("contracts/http/"):
            surfaces["httpContract"] = surfaces["backend"] = surfaces["frontend"] = True
        if path.startswith("contracts/mq/"):
            surfaces["backend"] = True
            java_modules.update(("wotb-broker-rabbitmq", "wotb-parser-worker"))
        if path.startswith("contracts/android-native-bridge.json") or path.startswith("android/") or path.startswith("scripts/android-release/"):
            surfaces["android"] = True
        if path in ("frontend/src/platform/nativeBridgeContract.js",):
            surfaces["android"] = True
        if path.startswith("infra/tofu/"):
            surfaces["deploy"] = True
            for name, prefix in TOFU_ROOTS.items():
                if path.startswith(prefix):
                    tofu.add(name)
                    break
            else:
                raise ValueError(f"unknown production OpenTofu input {path}")
        if path.startswith("deploy/"):
            surfaces["deploy"] = True
            if path.startswith("deploy/observability/"):
                surfaces["observability"] = True
                recognized = False
                for prefix, service in OBS_CONFIG.items():
                    if path.startswith(prefix):
                        deploy.add(service)
                        recognized = True
                        break
                # Dashboard JSON is owned by Grafana OpenTofu.
                if path.startswith("deploy/observability/grafana/dashboards/"):
                    tofu.add("grafana")
                    recognized = True
                if not recognized and not path.endswith(".md") and not Path(path).name.startswith("test-"):
                    raise ValueError(f"unmapped observability production input {path}")
            elif path.startswith("deploy/nginx/"):
                if path == "deploy/nginx/nginx.conf":
                    surfaces["observability"] = True
                    build.add("frontend")
                elif not path.endswith(".md") and not Path(path).name.startswith("test-"):
                    raise ValueError(f"unmapped frontend nginx production input {path}")
            elif path in COMPOSE_NAMES:
                affected, reason = compose_affected(base, head, path)
                deploy.update(affected)
                if reason:
                    reasons[path] = reason
            elif path.startswith("deploy/tx/caddy/") or path.startswith("deploy/tx/Caddyfile"):
                deploy.add("caddy")
            elif path.startswith("deploy/tx/nginx/"):
                deploy.add("frontend")
            elif path == "deploy/tx/rabbitmq.tofurc":
                tofu.add("rabbitmq")
            elif path == "deploy/tx/business-postgres.tofurc":
                tofu.add("business-postgres")
            elif path == "deploy/tx/keycloak-tofu.sh":
                tofu.add("keycloak")
            elif path in ("deploy/tx/runtime-check.sh", "deploy/tx/publish-loaded-image-to-tcr.sh", "deploy/tx/business-postgres-backup.sh", "deploy/tx/business-postgres-restore.sh"):
                pass
            elif path.startswith("deploy/tx/") and not Path(path).name.startswith("test-") and path != "deploy/tx/deploy.sh":
                raise ValueError(f"unmapped TX production config {path}")
            elif path in ("deploy/deploy.sh", "deploy/tx/deploy.sh", "deploy/minio-deploy.sh") or Path(path).name.startswith("test-") or path.startswith("deploy/observability/"):
                pass
            else:
                # Operational scripts do not by themselves change a running service.
                if path.endswith((".env", ".yml", ".yaml", ".json")):
                    raise ValueError(f"unmapped production deploy input {path}")
    deploy.update(build)
    if surfaces["backend"] and not java_modules:
        java_full = True
    if surfaces["full"]:
        java_full = True
    if java_full:
        java_modules.clear()
    return {
        "schemaVersion": 2,
        "baseSha": base,
        "headSha": head,
        "validation": {
            "surfaces": surfaces,
            "javaModules": [module for module in modules if module in java_modules],
            "javaFull": java_full,
            "frontendBrowserSuites": sorted(browser),
            "packagingComponents": [name for name in COMPONENTS if name in packaging],
            "tofuRoots": [name for name in TOFU_ROOTS if name in tofu],
        },
        "release": {
            "buildComponents": [name for name in COMPONENTS if name in build],
            "deployServices": [name for name in (*TX_SERVICES, *YECAO_SERVICES) if name in deploy],
            "tofuRoots": [name for name in TOFU_ROOTS if name in tofu],
        },
        "reasons": reasons,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    try:
        result = plan(args.base, args.head)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"release plan error: {error}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
