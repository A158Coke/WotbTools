#!/usr/bin/env python3
"""Select PR validation jobs from one complete Git base..head range.

This selector describes CI validation only. Production build, deploy, and
OpenTofu apply selection belongs to the service-owned workflows.
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


ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"[0-9a-f]{40}\Z")
TOFU_ROOTS = {
    "keycloak": "infra/tofu/keycloak/",
    "rabbitmq": "infra/tofu/rabbitmq/",
    "business-postgres": "infra/tofu/postgres-business/",
    "keycloak-postgres": "infra/tofu/postgres-keycloak/",
    "minio": "infra/tofu/minio/",
    "grafana": "infra/tofu/grafana/",
}
SURFACES = (
    "backend", "frontend", "httpContract", "data", "liveData", "deploy",
    "observability", "android", "keycloakProvider", "keycloakRuntime", "full",
)
COMMON_JAVA = {
    "common/tankopedia-tier7.json",
    "common/tankopedia-tier8.json",
    "common/tankopedia-tier9.json",
    "common/tankopedia-tier10.json",
    "common/map_names.json",
    "common/tank_tactical_profiles.json",
}
FRONTEND_COMMON = {
    "common/map_names.json",
    "common/tankopedia-tier10.json",
    "HISTORY.md",
    "docs/architecture/TECHNICAL_EVOLUTION.md",
    "docs/WotBTools_League_Rating_V6.md",
}
FRONTEND_GLOBAL_PATHS = {
    "frontend/index.html",
    "frontend/src/main.js",
    "frontend/src/App.vue",
    "frontend/src/styles/app-shell.css",
    "frontend/src/styles/tokens.css",
}
FRONTEND_GLOBAL_PREFIXES = ("frontend/src/app/",)
BROWSER_SUITES = ("playback-layout", "workspace-interaction")
OBS_CONFIG_PREFIXES = (
    "deploy/observability/prometheus/",
    "deploy/observability/loki/",
    "deploy/observability/alloy/",
    "deploy/observability/grafana/provisioning/",
)


def git(*args: str, allow_missing: bool = False) -> bytes | None:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode:
        if allow_missing:
            return None
        detail = result.stderr.decode(errors="replace").strip()
        raise ValueError(f"git {' '.join(args[:2])} failed: {detail}")
    return result.stdout


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
        if git("cat-file", "-t", sha) != b"commit\n":
            raise ValueError(f"{name} is not a commit")


def reactor_modules(head: str) -> list[str]:
    namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
    source = blob(head, "java/pom.xml")
    if source is None:
        raise ValueError("missing java/pom.xml")
    try:
        root = ET.fromstring(source)
        modules = [node.text for node in root.findall("m:modules/m:module", namespace)]
        if not modules or any(not item or "/" in item or item.startswith(".") for item in modules):
            raise ValueError("invalid Maven reactor module list")
        if len(set(modules)) != len(modules):
            raise ValueError("duplicate Maven reactor module")
        for module in modules:
            module_source = blob(head, f"java/{module}/pom.xml")
            if module_source is None:
                raise ValueError(f"missing POM for {module}")
            artifact = ET.fromstring(module_source).findtext("m:artifactId", namespaces=namespace)
            if artifact != module:
                raise ValueError(f"module {module} artifactId mismatch: {artifact}")
        return modules
    except ET.ParseError as error:
        raise ValueError(f"invalid Maven POM: {error}") from error


def matches(path: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(path, pattern)


def select(base: str, head: str) -> dict[str, object]:
    validate_revisions(base, head)
    paths = changed_paths(base, head)
    modules = reactor_modules(head)
    base_modules = reactor_modules(base)
    surfaces = {name: False for name in SURFACES}
    java_modules: set[str] = set()
    browser: set[str] = set()
    tofu: set[str] = set()
    java_full = False

    for path in paths:
        if (path.endswith(".md") and path not in FRONTEND_COMMON) or (
            path.startswith("docs/") and path not in FRONTEND_COMMON
        ):
            continue
        if path.startswith((".github/", "scripts/ci/")):
            surfaces["full"] = True
            continue
        if path.startswith("java/"):
            surfaces["backend"] = True
            if path == "java/pom.xml" or path == "java/settings.xml":
                java_full = surfaces["full"] = True
            elif path == "java/settings-docker.xml":
                # PR CI does not build production images, so exercise the broad CI suite
                # while the owning main workflow validates the Docker Maven settings.
                java_full = surfaces["full"] = True
                surfaces["keycloakProvider"] = surfaces["keycloakRuntime"] = True
            elif len(path.split("/")) >= 3:
                module = path.split("/")[1]
                if module not in modules:
                    if module in base_modules:
                        # A deleted module is still a changed production input.
                        # Run the full backend selection instead of treating the
                        # base-only path as an unrecognized newly added module.
                        java_full = surfaces["full"] = True
                    else:
                        raise ValueError(f"unknown changed Java module {module}")
                else:
                    java_modules.add(module)
                if module == "wotb-web":
                    surfaces["httpContract"] = True
            else:
                java_full = surfaces["full"] = True
            continue
        if path.startswith("frontend/"):
            surfaces["frontend"] = True
            if path.startswith("frontend/src/api/"):
                surfaces["httpContract"] = True
            if path in FRONTEND_GLOBAL_PATHS or path.startswith(FRONTEND_GLOBAL_PREFIXES):
                browser.update(BROWSER_SUITES)
            if "Playback" in path or "ReplayWorkspace" in path or "ReplayPage" in path:
                browser.add("workspace-interaction")
            if path.endswith(".css") or "Layout" in path or "Playback" in path or "ReplayPage" in path:
                browser.add("playback-layout")
            if path in (
                "frontend/package.json", "frontend/package-lock.json",
                "frontend/vite.config.js", "frontend/vitest.config.js",
            ):
                surfaces["full"] = True
            continue
        if path.startswith(("keycloak-qq-provider/", "keycloak-wargaming-provider/")):
            surfaces["keycloakProvider"] = surfaces["keycloakRuntime"] = True
            continue
        if path.startswith("docker/"):
            surfaces["deploy"] = True
            if path.startswith("docker/keycloak/") or path == "docker/Dockerfile.keycloak":
                surfaces["keycloakRuntime"] = True
            elif path.startswith("docker/Dockerfile."):
                if path.removeprefix("docker/Dockerfile.") not in {
                    "backend", "business-api", "frontend", "parser-worker", "minio",
                }:
                    raise ValueError(f"unknown production Dockerfile {path}")
            else:
                raise ValueError(f"unmapped production Docker input {path}")
            continue
        if path == ".dockerignore":
            surfaces["full"] = surfaces["deploy"] = True
            continue
        if path in COMMON_JAVA or path.startswith("common/map-semantics/"):
            surfaces["backend"] = surfaces["data"] = True
        elif path.startswith("common/assets/"):
            surfaces["frontend"] = surfaces["data"] = True
        elif path.startswith("common/") or path.startswith("map-semanticizer/"):
            surfaces["data"] = True
        if path in FRONTEND_COMMON:
            surfaces["frontend"] = True
        if path.startswith("common/wotb-item-catalog-json/") or matches(path, "common/tankopedia-*.json") or path == "common/crew-skills.json":
            surfaces["liveData"] = True
        if path.startswith("contracts/http/"):
            surfaces["httpContract"] = surfaces["backend"] = surfaces["frontend"] = True
        if path.startswith("contracts/mq/"):
            surfaces["backend"] = True
            java_modules.update(("wotb-broker-rabbitmq", "wotb-parser-worker"))
        if path == "contracts/android-native-bridge.json" or path.startswith("android/") or path.startswith("scripts/android-release/"):
            surfaces["android"] = True
        if path == "frontend/src/platform/nativeBridgeContract.js":
            surfaces["android"] = True
        if path.startswith("infra/tofu/"):
            surfaces["deploy"] = True
            for name, prefix in TOFU_ROOTS.items():
                if path.startswith(prefix):
                    tofu.add(name)
                    break
            else:
                raise ValueError(f"unknown OpenTofu validation root {path}")
        if path.startswith("deploy/"):
            # The deploy contract job owns the shared readiness probe, its
            # protocol fixtures, and both TX/Yecao deployment entrypoints.
            surfaces["deploy"] = True
            if path == "deploy/tx/keycloak-tofu.sh":
                tofu.add("keycloak")
            elif path == "deploy/tx/rabbitmq.tofurc":
                tofu.add("rabbitmq")
            elif path == "deploy/tx/business-postgres.tofurc":
                tofu.add("business-postgres")
            elif path == "deploy/minio/tofurc":
                tofu.add("minio")
            if path.startswith("deploy/observability/"):
                surfaces["observability"] = True
                recognized = any(path.startswith(prefix) for prefix in OBS_CONFIG_PREFIXES)
                if path.startswith("deploy/observability/grafana/dashboards/"):
                    tofu.add("grafana")
                    recognized = True
                if not recognized and not path.endswith(".md") and not Path(path).name.startswith("test-"):
                    raise ValueError(f"unmapped observability production input {path}")
            elif path.startswith("deploy/nginx/"):
                if path == "deploy/nginx/nginx.conf":
                    surfaces["observability"] = True
                elif not path.endswith(".md") and not Path(path).name.startswith("test-"):
                    raise ValueError(f"unmapped frontend nginx production input {path}")
            # Other deploy inputs use the static and disposable fixtures owned by
            # the deployment contract job; production selection lives elsewhere.

    if surfaces["backend"] and not java_modules:
        java_full = True
    if surfaces["full"]:
        java_full = True
    if java_full:
        java_modules.clear()

    return {
        "surfaces": surfaces,
        "javaModules": [module for module in modules if module in java_modules],
        "javaFull": java_full,
        "frontendBrowserSuites": sorted(browser),
        "tofuRoots": [name for name in TOFU_ROOTS if name in tofu],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    try:
        result = select(args.base, args.head)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"CI impact selection failed: {error}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
