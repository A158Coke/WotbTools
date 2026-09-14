#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$ROOT" "$WORK" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
work = Path(sys.argv[2])
tool = root / "deploy" / "release_plan.py"


def detect(*paths):
    path_file = work / "paths.txt"
    path_file.write_text("\n".join(paths) + "\n", encoding="utf-8")
    return json.loads(subprocess.check_output(["python3", str(tool), "detect", "--paths-file", str(path_file)]))


def manual(service):
    return json.loads(subprocess.check_output(["python3", str(tool), "detect", "--manual-service", service]))


assert detect("frontend/src/App.vue")["deployServices"] == ["wotb-frontend"]
assert detect("java/wotb-core/src/Main.java")["deployServices"] == ["wotb-backend"]
assert detect("keycloak-wargaming-provider/src/Main.java")["deployServices"] == ["keycloak"]
frontend_diagnostics = detect("frontend/vite.config.js")
assert frontend_diagnostics["images"] == {"backend": False, "frontend": True, "keycloak": False}
assert frontend_diagnostics["buildServices"] == ["wotb-frontend"]
assert frontend_diagnostics["deployServices"] == ["wotb-frontend"]
keycloak_diagnostics = detect("docker/keycloak/wotbtools-entrypoint.sh")
assert keycloak_diagnostics["images"] == {"backend": False, "frontend": False, "keycloak": True}
assert keycloak_diagnostics["buildServices"] == ["keycloak"]
assert keycloak_diagnostics["deployServices"] == ["keycloak"]
backend_diagnostics = detect("java/wotb-web/src/main/java/com/wotb/web/config/StartupReleaseDiagnostics.java")
assert backend_diagnostics["images"] == {"backend": True, "frontend": False, "keycloak": False}
assert backend_diagnostics["buildServices"] == ["wotb-backend"]
assert backend_diagnostics["deployServices"] == ["wotb-backend"]
bootstrap_diagnostics = detect(
    "java/wotb-web/src/main/java/com/wotb/web/config/StartupReleaseDiagnostics.java",
    "frontend/vite.config.js",
    "docker/keycloak/wotbtools-entrypoint.sh",
)
assert bootstrap_diagnostics["images"] == {"backend": True, "frontend": True, "keycloak": True}
assert bootstrap_diagnostics["buildServices"] == ["wotb-backend", "wotb-frontend", "keycloak"]
assert bootstrap_diagnostics["deployServices"] == ["wotb-backend", "wotb-frontend", "keycloak"]
assert set(detect("frontend/src/App.vue", "java/wotb-core/src/Main.java")["deployServices"]) == {
    "wotb-frontend", "wotb-backend"
}
assert detect("README.md")["deployServices"] == []
assert detect("docs/CHANGELOG.md")["imageServices"] == []
assert detect("docs/CHANGELOG.md")["deployServices"] == []
assert detect("docs/WotBTools_League_Rating_V6.md")["imageServices"] == ["wotb-frontend"]
assert detect("deploy/observability/prometheus/prometheus.yml")["deployServices"] == ["prometheus"]
assert detect("deploy/observability/grafana/dashboards/home.json")["deployServices"] == []
assert detect("deploy/observability/grafana/dashboards/home.json")["ciSurfaces"] == {
    "backend": False, "frontend": False, "keycloak": False, "httpContract": False,
    "data": False, "liveData": False, "deploy": True, "observability": True, "android": False,
    "keycloakProvider": False, "keycloakRuntime": False, "full": False,
}
assert detect("contracts/http/openapi.yaml")["ciSurfaces"]["httpContract"]
assert detect("contracts/http/openapi.yaml")["buildServices"] == ["wotb-backend", "wotb-frontend"]
assert detect("contracts/android-native-bridge.json")["ciSurfaces"]["android"]
assert not detect("contracts/android-native-bridge.json")["imageServices"]
assert detect("deploy/deploy.sh")["deployConfig"]
assert detect("deploy/deploy.sh")["deployServices"] == []

backend_health_probe_fix = detect(
    "deploy/deploy.sh",
    "deploy/test-deploy-contract.sh",
    "deploy/test-release-plan.sh",
    "deploy/AGENTS.md",
    "docs/CHANGELOG.md",
    "docs/DEVELOPER_GUIDE.md",
    "java/wotb-web/src/test/java/com/wotb/web/config/BackendManagementHealthContractTest.java",
)
assert backend_health_probe_fix["images"] == {"backend": True, "frontend": False, "keycloak": False}
assert backend_health_probe_fix["buildServices"] == ["wotb-backend"]
assert backend_health_probe_fix["imageServices"] == ["wotb-backend"]
assert backend_health_probe_fix["deployServices"] == ["wotb-backend"]
assert backend_health_probe_fix["deployConfig"]
assert detect("deploy/docker-compose.prod.yml")["deployServices"] == ["all"]
assert detect("deploy/docker-compose.prod.yml")["ciSurfaces"]["deploy"]
assert detect(".github/workflows/ci.yml")["ciSurfaces"]["full"]
assert detect("common/unrelated-fixture.json")["ciSurfaces"]["data"]
assert not detect("common/unrelated-fixture.json")["imageServices"]
assert set(detect(".dockerignore")["imageServices"]) == {
    "wotb-backend", "wotb-frontend", "keycloak"
}
assert manual("all")["deployServices"] == ["all"]
assert set(manual("all")["imageServices"]) == {
    "wotb-backend", "wotb-frontend", "keycloak"
}
assert manual("backend")["deployServices"] == ["wotb-backend"]
assert manual("frontend")["deployServices"] == ["wotb-frontend"]
assert manual("keycloak")["deployServices"] == ["keycloak"]
for unsupported in ("postgres", "grafana", "wotb-backend", "wotb-frontend"):
    assert subprocess.run(
        ["python3", str(tool), "detect", "--manual-service", unsupported],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode != 0

commit = "0123456789abcdef0123456789abcdef01234567"
plan = manual("frontend")
manual_result = json.loads(subprocess.check_output([
    "python3", str(tool), "manual", "--service", "frontend", "--commit-sha", commit,
]))
assert manual_result["imageTag"] == "latest"
assert manual_result["imageServices"] == ["wotb-frontend"]
assert subprocess.run(
    ["python3", str(tool), "manual", "--service", "frontend", "--commit-sha", commit,
     "--image-tag", "sha-0123456789ab"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
).returncode != 0
manifest_path = work / "manifest.json"
manifest = {
    "schemaVersion": 1,
    "commitSha": commit,
    "imageTag": "sha-0123456789ab",
    "buildRunId": "42",
    "buildRunNumber": 42,
    "backendMigrationMaxVersion": 22,
    "images": plan["images"],
    "buildServices": plan["imageServices"],
    "imageServices": plan["imageServices"],
    "deployServices": plan["deployServices"],
}
manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
subprocess.check_call(["python3", str(tool), "validate", "--manifest", str(manifest_path), "--expected-sha", commit])
manifest["commitSha"] = "fedcba9876543210fedcba9876543210fedcba98"
manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
assert subprocess.run(["python3", str(tool), "validate", "--manifest", str(manifest_path), "--expected-sha", commit]).returncode != 0
manifest["commitSha"] = commit
manifest["imageTag"] = "latest"
manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
assert subprocess.run(["python3", str(tool), "validate", "--manifest", str(manifest_path), "--expected-sha", commit]).returncode != 0
subprocess.check_call([
    "python3", str(tool), "validate", "--manifest", str(manifest_path),
    "--expected-sha", commit, "--allow-latest",
])
manifest["buildServices"] = []
manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
assert subprocess.run(
    ["python3", str(tool), "validate", "--manifest", str(manifest_path), "--expected-sha", commit,
     "--allow-latest"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
).returncode != 0

print("release plan detection and manifest contract OK")
PY
