#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$ROOT" "$WORK" <<'PY'
import importlib.util
import json
import re
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
assert detect("frontend/src/App.vue")["targetServices"] == {"tx": ["wotb-frontend"]}
assert detect("java/wotb-core/src/main/java/com/wotb/core/Main.java")["deployServices"] == ["business-api"]
assert detect("java/wotb-core/src/main/java/com/wotb/core/Main.java")["targetServices"] == {"tx": ["business-api"]}
assert detect("keycloak-wargaming-provider/src/main/java/Provider.java")["deployServices"] == ["keycloak"]
frontend_diagnostics = detect("frontend/vite.config.js")
assert frontend_diagnostics["images"] == {"backend": False, "frontend": True, "keycloak": False, "minio": False, "parser-worker": False}
assert frontend_diagnostics["buildServices"] == ["wotb-frontend"]
assert frontend_diagnostics["deployServices"] == ["wotb-frontend"]
keycloak_diagnostics = detect("docker/keycloak/wotbtools-entrypoint.sh")
assert keycloak_diagnostics["images"] == {"backend": False, "frontend": False, "keycloak": True, "minio": False, "parser-worker": False}
assert keycloak_diagnostics["buildServices"] == ["keycloak"]
assert keycloak_diagnostics["deployServices"] == ["keycloak"]
backend_diagnostics = detect("java/wotb-web/src/main/java/com/wotb/web/config/StartupReleaseDiagnostics.java")
assert backend_diagnostics["images"] == {"backend": True, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False}
assert backend_diagnostics["buildServices"] == ["business-api"]
assert backend_diagnostics["deployServices"] == ["business-api"]
bootstrap_diagnostics = detect(
    "java/wotb-web/src/main/java/com/wotb/web/config/StartupReleaseDiagnostics.java",
    "frontend/vite.config.js",
    "docker/keycloak/wotbtools-entrypoint.sh",
)
assert bootstrap_diagnostics["images"] == {"backend": True, "frontend": True, "keycloak": True, "minio": False, "parser-worker": False}
assert bootstrap_diagnostics["buildServices"] == ["business-api", "wotb-frontend", "keycloak"]
assert bootstrap_diagnostics["deployServices"] == ["business-api", "wotb-frontend", "keycloak"]
assert set(detect("frontend/src/App.vue", "java/wotb-core/src/main/java/com/wotb/core/Main.java")["deployServices"]) == {
    "wotb-frontend", "business-api"
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
assert detect("contracts/http/openapi.yaml")["buildServices"] == ["business-api", "wotb-frontend"]
assert detect("contracts/android-native-bridge.json")["ciSurfaces"]["android"]
assert not detect("contracts/android-native-bridge.json")["imageServices"]
deploy_script_plan = detect("deploy/deploy.sh")
assert deploy_script_plan["deployConfig"]
assert deploy_script_plan["images"] == {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False}
assert deploy_script_plan["buildServices"] == []
assert deploy_script_plan["imageServices"] == []
assert deploy_script_plan["deployServices"] == []

backend_health_probe_fix = detect(
    "deploy/deploy.sh",
    "deploy/test-deploy-contract.sh",
    "deploy/test-release-plan.sh",
    "deploy/AGENTS.md",
    "docs/CHANGELOG.md",
    "docs/DEVELOPER_GUIDE.md",
    "java/wotb-web/src/test/java/com/wotb/web/config/BackendManagementHealthContractTest.java",
)
assert backend_health_probe_fix["images"] == {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False}
assert backend_health_probe_fix["buildServices"] == []
assert backend_health_probe_fix["imageServices"] == []
# Nothing here changes a production runtime artifact (deploy scripts, docs, and a backend
# *test*), so no application service may be selected. The rollout stays config-only, exactly
# like the deploy/deploy.sh-only case asserted above: a test edit must never redeploy business-api.
assert backend_health_probe_fix["deployServices"] == []
assert backend_health_probe_fix["targetServices"] == {}
assert backend_health_probe_fix["deployConfig"]
assert detect("deploy/docker-compose.prod.yml")["deployServices"] == [
    "node-exporter", "prometheus", "loki", "alloy", "grafana"
]
assert detect("deploy/docker-compose.prod.yml")["targetServices"] == {"yecao": [
    "node-exporter", "prometheus", "loki", "alloy", "grafana"
]}
# The retired Yecao application services are not derivable from the Yecao Compose any more.
for retired_service in ("postgres", "wotb-backend", "wotb-frontend", "keycloak"):
    assert retired_service not in detect("deploy/docker-compose.prod.yml")["deployServices"], retired_service
tx_config_services = ["keycloak-postgres", "keycloak", "wotb-frontend", "business-api"]
assert detect("deploy/tx/docker-compose.prod.yml")["deployServices"] == tx_config_services
assert detect("deploy/tx/docker-compose.prod.yml")["images"] == {
    "backend": True, "frontend": True, "keycloak": True, "minio": False, "parser-worker": False
}
assert detect("deploy/tx/docker-compose.prod.yml")["targetServices"] == {
    "tx": tx_config_services
}
keycloak_tofu = detect("infra/tofu/keycloak/realm.tf")
assert keycloak_tofu["images"] == {"backend": True, "frontend": True, "keycloak": True, "minio": False, "parser-worker": False}
assert keycloak_tofu["deployServices"] == tx_config_services
assert keycloak_tofu["targetServices"] == {
    "tx": tx_config_services
}
rabbitmq_tofu = detect("infra/tofu/rabbitmq/rabbitmq.tf")
assert rabbitmq_tofu["images"] == {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False}
assert rabbitmq_tofu["deployServices"] == ["rabbitmq"]
assert rabbitmq_tofu["targetServices"] == {"tx": ["rabbitmq"]}
business_postgres_tofu = detect("infra/tofu/postgres-business/business.tf")
assert business_postgres_tofu["images"] == {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False}
assert business_postgres_tofu["buildServices"] == []
assert business_postgres_tofu["deployServices"] == ["business-postgres"]
assert business_postgres_tofu["targetServices"] == {"tx": ["business-postgres"]}
assert detect("infra/tofu/postgres-business/.terraform.lock.hcl")["deployServices"] == ["business-postgres"]
assert detect("deploy/tx/docker-compose.yml")["deployServices"] == tx_config_services
assert "business-postgres" not in detect("deploy/tx/docker-compose.yml")["deployServices"]
assert detect("deploy/docker-compose.prod.yml")["ciSurfaces"]["deploy"]
minio_image = detect("docker/Dockerfile.minio")
assert minio_image["images"] == {"backend": False, "frontend": False, "keycloak": False, "minio": True, "parser-worker": False}
assert minio_image["buildServices"] == ["minio"]
assert minio_image["deployServices"] == []
assert detect("deploy/docker-compose.minio.yml")["deployServices"] == []
parser_worker_image = detect("docker/Dockerfile.parser-worker")
assert parser_worker_image["images"] == {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": True}
assert parser_worker_image["buildServices"] == ["parser-worker"]
assert parser_worker_image["deployServices"] == []
assert parser_worker_image["targetServices"] == {}
parser_worker_module = detect("java/wotb-parser-worker/src/main/java/com/wotb/parserworker/ParserWorkerApplication.java")
assert parser_worker_module["images"] == {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": True}
assert parser_worker_module["buildServices"] == ["parser-worker"]
assert parser_worker_module["deployServices"] == []
assert parser_worker_module["targetServices"] == {}
# Shared inputs must select exactly the images whose Dockerfile COPYs them.
# tank_tactical_profiles.json is copied by BOTH docker/Dockerfile.backend and
# docker/Dockerfile.parser-worker, so both publish (only business-api deploys).
# contracts/mq is not a Docker build input at all, so it stays parser-worker-only.
for shared_input, expected_images, expected_build, expected_deploy in (
    (
        "common/tank_tactical_profiles.json",
        {"backend": True, "frontend": False, "keycloak": False, "minio": False, "parser-worker": True},
        ["business-api", "parser-worker"],
        ["business-api"],
    ),
    (
        "contracts/mq/parser-messages.json",
        {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": True},
        ["parser-worker"],
        [],
    ),
):
    shared_input_plan = detect(shared_input)
    assert shared_input_plan["images"] == expected_images, shared_input
    assert shared_input_plan["buildServices"] == expected_build, shared_input
    assert shared_input_plan["imageServices"] == expected_build, shared_input
    assert shared_input_plan["deployServices"] == expected_deploy, shared_input
    assert shared_input_plan["targetServices"] == (
        {"tx": expected_deploy} if expected_deploy else {}
    ), shared_input
assert detect(".github/workflows/ci.yml")["ciSurfaces"]["full"]
assert detect("common/unrelated-fixture.json")["ciSurfaces"]["data"]
assert detect("common/unrelated-fixture.json")["imageServices"] == []
assert detect("java/wotb-web/src/test/java/FooTest.java")["imageServices"] == []
assert detect("java/wotb-parser-worker/src/test/java/FooTest.java")["imageServices"] == []
assert set(detect(".dockerignore")["imageServices"]) == {
    "business-api", "wotb-frontend", "keycloak"
}
# Every production Dockerfile must select exactly its own image and nothing else.
for dockerfile, expected_images, expected_deploy in (
    ("docker/Dockerfile.backend", ["business-api"], ["business-api"]),
    ("docker/Dockerfile.frontend", ["wotb-frontend"], ["wotb-frontend"]),
    ("docker/Dockerfile.keycloak", ["keycloak"], ["keycloak"]),
    ("docker/Dockerfile.minio", ["minio"], []),
    ("docker/Dockerfile.parser-worker", ["parser-worker"], []),
):
    dockerfile_plan = detect(dockerfile)
    assert dockerfile_plan["imageServices"] == expected_images, dockerfile
    assert dockerfile_plan["buildServices"] == expected_images, dockerfile
    assert dockerfile_plan["deployServices"] == expected_deploy, dockerfile
NO_IMAGES = {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False}
# The parent reactor and the shared Docker Maven settings are inputs to every image whose
# Dockerfile COPYs them, and to no image that does not.
parent_pom_plan = detect("java/pom.xml")
assert parent_pom_plan["images"] == {**NO_IMAGES, "backend": True, "parser-worker": True}
assert parent_pom_plan["buildServices"] == ["business-api", "parser-worker"]
assert parent_pom_plan["deployServices"] == ["business-api"]
settings_plan = detect("java/settings-docker.xml")
assert settings_plan["images"] == {**NO_IMAGES, "backend": True, "keycloak": True, "parser-worker": True}
assert settings_plan["buildServices"] == ["business-api", "keycloak", "parser-worker"]
assert settings_plan["deployServices"] == ["business-api", "keycloak"]
# Shared Maven modules rebuild every image consumer; a module must never cross-select the
# image whose Dockerfile does not COPY its sources.
for shared_module in (
    "wotb-contracts", "wotb-object-storage-minio", "wotb-broker-rabbitmq", "wotb-core",
    "wotb-result", "wotb-playback", "wotb-replay-processing",
):
    shared_plan = detect(f"java/{shared_module}/src/main/java/Foo.java")
    assert shared_plan["buildServices"] == ["business-api", "parser-worker"], shared_module
    assert shared_plan["deployServices"] == ["business-api"], shared_module
for backend_only_module in ("wotb-replay-coordinator", "wotb-ai", "wotb-web"):
    backend_only_plan = detect(f"java/{backend_only_module}/src/main/java/Foo.java")
    assert backend_only_plan["images"] == {**NO_IMAGES, "backend": True}, backend_only_module
    assert backend_only_plan["deployServices"] == ["business-api"], backend_only_module
worker_only_module_plan = detect("java/wotb-parser-worker/src/main/java/Foo.java")
assert worker_only_module_plan["images"] == {**NO_IMAGES, "parser-worker": True}
assert worker_only_module_plan["deployServices"] == []
# A Keycloak provider test is not a runtime input: it must validate CI without publishing
# or deploying the Keycloak image (docker/Dockerfile.keycloak packages only src/main).
for provider in ("keycloak-juhe-qq-provider", "keycloak-qq-provider", "keycloak-wargaming-provider"):
    provider_test_plan = detect(f"{provider}/src/test/java/ProviderTest.java")
    assert provider_test_plan["images"] == NO_IMAGES, provider
    assert provider_test_plan["buildServices"] == [], provider
    assert provider_test_plan["deployServices"] == [], provider
    assert provider_test_plan["ciSurfaces"]["keycloakProvider"], provider
# HISTORY.md is COPYed into the frontend build stage and inlined by HistoryPage with `?raw`,
# so it must republish wotb-frontend rather than count as an inert document.
history_plan = detect("HISTORY.md")
assert history_plan["images"] == {**NO_IMAGES, "frontend": True}
assert history_plan["buildServices"] == ["wotb-frontend"]
assert history_plan["deployServices"] == ["wotb-frontend"]
assert history_plan["targetServices"] == {"tx": ["wotb-frontend"]}
# The legacy whole-stack ``all`` selector implied the retired Yecao control plane, so it must not be
# selectable through the manual alias path either.
assert subprocess.run(
    ["python3", str(tool), "detect", "--manual-service", "all"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
).returncode != 0
assert manual("backend")["deployServices"] == ["business-api"]
assert manual("backend")["targetServices"] == {"tx": ["business-api"]}
assert manual("frontend")["deployServices"] == ["wotb-frontend"]
assert manual("keycloak")["deployServices"] == ["keycloak"]
assert manual("minio")["deployServices"] == ["minio"]
assert manual("minio")["targetServices"] == {"yecao": ["minio"]}
assert manual("parser-worker")["images"] == {
    "backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": True
}
assert manual("parser-worker")["buildServices"] == ["parser-worker"]
assert manual("parser-worker")["imageServices"] == ["parser-worker"]
assert manual("parser-worker")["deployServices"] == ["parser-worker"]
assert manual("parser-worker")["targetServices"] == {"yecao": ["parser-worker"]}
assert set(manual("backend")["imageServices"]).isdisjoint({"minio", "parser-worker"})
for unsupported in (
    "all", "postgres", "wotb-backend", "wotb-frontend", "keycloak-postgres", "business-api",
    "grafana", "parser",
):
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
assert manual_result["imageTag"] == "sha-0123456789ab"
assert manual_result["imageServices"] == ["wotb-frontend"]
assert subprocess.run(
    ["python3", str(tool), "manual", "--service", "frontend", "--commit-sha", commit,
     "--image-tag", "sha-0123456789ab"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
).returncode != 0
manifest_path = work / "manifest.json"
manifest = {
    "schemaVersion": 2,
    "commitSha": commit,
    "imageTag": "sha-0123456789ab",
    "buildRunId": "42",
    "buildRunNumber": 42,
    "backendMigrationMaxVersion": 22,
    "images": plan["images"],
    "buildServices": plan["imageServices"],
    "imageServices": plan["imageServices"],
    "deployServices": plan["deployServices"],
    "targetServices": plan["targetServices"],
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
manifest["buildServices"] = []
manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
assert subprocess.run(
    ["python3", str(tool), "validate", "--manifest", str(manifest_path), "--expected-sha", commit],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
).returncode != 0

minio_manifest = json.loads(subprocess.check_output([
    "python3", str(tool), "manual", "--service", "minio", "--commit-sha", commit,
]))
assert minio_manifest["imageTag"] == "sha-0123456789ab"
assert minio_manifest["imageServices"] == ["minio"]
assert minio_manifest["deployServices"] == ["minio"]
assert minio_manifest["targetServices"] == {"yecao": ["minio"]}

parser_worker_manifest = json.loads(subprocess.check_output([
    "python3", str(tool), "manual", "--service", "parser-worker", "--commit-sha", commit,
]))
assert parser_worker_manifest["imageTag"] == "sha-0123456789ab"
assert parser_worker_manifest["imageServices"] == ["parser-worker"]
assert parser_worker_manifest["deployServices"] == ["parser-worker"]
assert parser_worker_manifest["targetServices"] == {"yecao": ["parser-worker"]}
parser_worker_manifest_path = work / "parser-worker-manifest.json"
parser_worker_manifest_path.write_text(json.dumps(parser_worker_manifest), encoding="utf-8")
subprocess.check_call([
    "python3", str(tool), "validate", "--manifest", str(parser_worker_manifest_path),
    "--expected-sha", commit,
])
parser_worker_manifest["targetServices"] = {"tx": ["parser-worker"]}
parser_worker_manifest_path.write_text(json.dumps(parser_worker_manifest), encoding="utf-8")
assert subprocess.run(
    ["python3", str(tool), "validate", "--manifest", str(parser_worker_manifest_path), "--expected-sha", commit],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
).returncode != 0, "a parser-worker image must stay routed to the yecao target"
parser_worker_manifest["targetServices"] = {"yecao": ["parser-worker"]}
parser_worker_manifest_path.write_text(json.dumps(parser_worker_manifest), encoding="utf-8")
subprocess.check_call([
    "python3", str(tool), "validate", "--manifest", str(parser_worker_manifest_path),
    "--expected-sha", commit,
])

business_api_manifest = json.loads(subprocess.check_output([
    "python3", str(tool), "manual", "--service", "backend", "--commit-sha", commit,
]))
assert business_api_manifest["imageTag"] == "sha-0123456789ab"
assert business_api_manifest["imageServices"] == ["business-api"]
assert business_api_manifest["deployServices"] == ["business-api"]
assert business_api_manifest["targetServices"] == {"tx": ["business-api"]}
business_api_manifest_path = work / "business-api-manifest.json"
business_api_manifest_path.write_text(json.dumps(business_api_manifest), encoding="utf-8")
subprocess.check_call([
    "python3", str(tool), "validate", "--manifest", str(business_api_manifest_path),
    "--expected-sha", commit,
])
# The backend image belongs to the TX business runtime now, so a manifest that
# keeps the image set but routes it back to the Yecao legacy target is rejected.
business_api_manifest["targetServices"] = {"yecao": ["business-api"]}
business_api_manifest_path.write_text(json.dumps(business_api_manifest), encoding="utf-8")
assert subprocess.run(
    ["python3", str(tool), "validate", "--manifest", str(business_api_manifest_path), "--expected-sha", commit],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
).returncode != 0, "the business-api service must stay routed to the tx target"

# Caddy is an explicit TX selector in deploy/tx/deploy.sh, so a manifest naming
# it must validate and stay routed to the TX target. Before this contract the
# selector existed only in the deploy script and a Caddy-only change could not be
# derived from the impact surface at all.
spec = importlib.util.spec_from_file_location("release_plan", tool)
release_plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_plan)
assert "caddy" in release_plan.DEPLOYABLE_SERVICES
assert release_plan.TARGET_BY_SERVICE["caddy"] == "tx"
tx_deploy_text = (root / "deploy" / "tx" / "deploy.sh").read_text(encoding="utf-8")
selector_match = re.search(r"all\|[a-z0-9|-]+\) ;;", tx_deploy_text)
assert selector_match, "deploy/tx/deploy.sh service selector list is missing"
for selector in selector_match.group(0).split(")")[0].split("|"):
    assert selector in release_plan.DEPLOYABLE_SERVICES, \
        f"deploy/tx/deploy.sh selector missing from the release plan: {selector}"
caddy_manifest = {
    "schemaVersion": 2,
    "commitSha": commit,
    "imageTag": "sha-0123456789ab",
    "buildRunId": "42",
    "buildRunNumber": 42,
    "backendMigrationMaxVersion": 22,
    "images": {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False},
    "buildServices": [],
    "imageServices": [],
    "deployServices": ["caddy"],
    "targetServices": {"tx": ["caddy"]},
}
caddy_manifest_path = work / "caddy-manifest.json"
caddy_manifest_path.write_text(json.dumps(caddy_manifest), encoding="utf-8")
subprocess.check_call([
    "python3", str(tool), "validate", "--manifest", str(caddy_manifest_path),
    "--expected-sha", commit,
])
caddy_manifest["targetServices"] = {"yecao": ["caddy"]}
caddy_manifest_path.write_text(json.dumps(caddy_manifest), encoding="utf-8")
assert subprocess.run(
    ["python3", str(tool), "validate", "--manifest", str(caddy_manifest_path),
     "--expected-sha", commit],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
).returncode != 0, "the caddy service must stay routed to the tx target"

print("release plan detection and manifest contract OK")
PY
