#!/usr/bin/env python3
"""Build/deploy release planning and manifest validation.

This is intentionally standard-library-only so the same contract can run in
GitHub Actions without installing a project dependency.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys


IMAGE_NAMES = ("backend", "frontend", "keycloak")
APPLICATION_SERVICES = {
    "backend": "wotb-backend",
    "frontend": "wotb-frontend",
    "keycloak": "keycloak",
}
DEPLOYABLE_SERVICES = {
    "all",
    "postgres",
    "node-exporter",
    "prometheus",
    "loki",
    "alloy",
    "grafana",
    "keycloak",
    "wotb-backend",
    "wotb-frontend",
}
IMAGE_SERVICE_BY_DEPLOY_SERVICE = {
    value: key for key, value in APPLICATION_SERVICES.items()
}
MANUAL_SERVICE_ALIASES = {
    "backend": "backend",
    "frontend": "frontend",
    "keycloak": "keycloak",
}
MANUAL_SERVICES = {"all", *MANUAL_SERVICE_ALIASES}

FRONTEND_PATTERNS = (
    "frontend/**",
    "docker/Dockerfile.frontend",
    "common/map_names.json",
    "common/tankopedia-tier10.json",
    "common/assets/**",
    "docs/WotBTools_League_Rating_V6.md",
    "deploy/nginx/**",
    "contracts/http/**",
)
BACKEND_PATTERNS = (
    "java/**",
    "docker/Dockerfile.backend",
    "common/tankopedia-tier7.json",
    "common/tankopedia-tier8.json",
    "common/tankopedia-tier9.json",
    "common/tankopedia-tier10.json",
    "common/map_names.json",
    "common/tank_tactical_profiles.json",
    "common/map-semantics/**",
    "contracts/http/**",
)
KEYCLOAK_PATTERNS = (
    "keycloak-juhe-qq-provider/**",
    "keycloak-wargaming-provider/**",
    "docker/keycloak/**",
    "docker/Dockerfile.keycloak",
    "java/settings-docker.xml",
)
ALL_DEPLOY_PATTERNS = (
    "deploy/docker-compose.prod.yml",
    "deploy/deploy.sh",
    "deploy/verify-observability.sh",
    "deploy/validate-alloy-config.sh",
    "deploy/grafana-api-request.sh",
)
RUNTIME_CONFIG_PATTERNS = ("deploy/docker-compose.prod.yml",)
CI_SURFACE_PATTERNS = {
    "backend": BACKEND_PATTERNS,
    "frontend": FRONTEND_PATTERNS,
    "keycloak": KEYCLOAK_PATTERNS,
    "httpContract": (
        "contracts/http/**",
        "frontend/src/api/**",
        "frontend/scripts/*contract*",
        "java/wotb-web/**",
    ),
    "data": (
        "common/**",
        "map-semanticizer/**",
        "common/python/**",
    ),
    "liveData": (
        "common/wotb-item-catalog-json/**",
        "common/tankopedia-*.json",
        "common/crew-skills.json",
        "common/python/blitzkit_snapshot.py",
        "common/python/sync_equipment_snapshot.py",
        "common/python/sync_tankopedia_snapshot.py",
        "common/python/update_equipment.py",
        "common/python/update_crew_skills.py",
        "common/python/update_tankopedia.py",
        "common/python/validate_locked_equipment_contract.py",
        "common/python/validate_tankopedia_equipment.py",
    ),
    "deploy": (
        "deploy/**",
        "docker/**",
        ".github/workflows/deploy*.yml",
        "java/wotb-web/src/main/resources/db/migration/**",
        "java/settings-docker.xml",
    ),
    "observability": (
        "deploy/observability/**",
        "infra/tofu/grafana/**",
        "docker/online/docker-compose.yml",
        "deploy/nginx/**",
    ),
    "android": (
        "android/**",
        "contracts/android-native-bridge.json",
        "frontend/src/platform/nativeBridgeContract.js",
        "scripts/android-release/**",
    ),
    "keycloakProvider": (
        "keycloak-wargaming-provider/src/main/java/**",
        "keycloak-wargaming-provider/src/test/**",
        "keycloak-wargaming-provider/pom.xml",
        "keycloak-juhe-qq-provider/src/main/java/**",
        "keycloak-juhe-qq-provider/src/test/**",
        "keycloak-juhe-qq-provider/pom.xml",
    ),
    "keycloakRuntime": (
        "keycloak-wargaming-provider/src/main/java/**",
        "keycloak-wargaming-provider/pom.xml",
        "keycloak-wargaming-provider/src/main/resources/**",
        "keycloak-juhe-qq-provider/src/main/java/**",
        "keycloak-juhe-qq-provider/pom.xml",
        "keycloak-juhe-qq-provider/src/main/resources/**",
        "docker/Dockerfile.keycloak",
        "docker/keycloak/**",
        "docker/online/docker-compose.yml",
        "java/settings-docker.xml",
    ),
}
FULL_PATTERNS = (
    ".github/workflows/**",
    "java/pom.xml",
    "java/**/pom.xml",
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/vite.config.js",
    "frontend/vitest.config.js",
    "frontend/tsconfig.json",
    "frontend/tsconfig.app.json",
    "android/build.gradle.kts",
    "android/settings.gradle.kts",
    "android/gradle.properties",
    ".dockerignore",
    "Makefile",
    "scripts/build/**",
)
OBSERVABILITY_DEPLOY_PATTERNS = {
    "prometheus": ("deploy/observability/prometheus/**",),
    "loki": ("deploy/observability/loki/**",),
    "alloy": ("deploy/observability/alloy/**",),
    "grafana": ("deploy/observability/grafana/provisioning/**",),
}
COMMON_BUILD_PATTERNS = (".dockerignore",)
IMAGE_TAG_SHA_LENGTH = 12


def _matches(path: str, pattern: str) -> bool:
    path = path.replace("\\", "/")
    if path.startswith("./"):
        path = path[2:]
    pattern = pattern.replace("\\", "/")
    if fnmatch.fnmatchcase(path, pattern):
        return True
    if pattern.endswith("/**"):
        prefix = pattern[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    return False


def _matches_any(path: str, patterns: tuple[str, ...]) -> bool:
    return any(_matches(path, pattern) for pattern in patterns)


def detect(paths: list[str], manual_service: str | None = None) -> dict[str, object]:
    images = {name: False for name in IMAGE_NAMES}
    deploy_services: list[str] = []
    deploy_config = False
    ci_surfaces = {name: False for name in (
        "backend", "frontend", "keycloak", "httpContract", "data", "liveData", "deploy",
        "observability", "android", "keycloakProvider", "keycloakRuntime", "full",
    )}

    if manual_service is not None:
        if manual_service not in MANUAL_SERVICES:
            raise ValueError(f"unsupported manual service: {manual_service}")
        if manual_service == "all":
            images = {name: True for name in IMAGE_NAMES}
            deploy_services = ["all"]
        elif manual_service in MANUAL_SERVICE_ALIASES:
            image_name = MANUAL_SERVICE_ALIASES[manual_service]
            images[image_name] = True
            deploy_services = [APPLICATION_SERVICES[image_name]]
        return _result(images, deploy_services, deploy_config, ci_surfaces)

    normalized_paths = sorted({
        (path.replace("\\", "/")[2:] if path.replace("\\", "/").startswith("./") else path.replace("\\", "/"))
        for path in paths if path
    })
    for path in normalized_paths:
        if _matches_any(path, COMMON_BUILD_PATTERNS):
            images = {name: True for name in IMAGE_NAMES}
        if _matches_any(path, FRONTEND_PATTERNS):
            images["frontend"] = True
        if _matches_any(path, BACKEND_PATTERNS):
            images["backend"] = True
        if _matches_any(path, KEYCLOAK_PATTERNS):
            images["keycloak"] = True
        if _matches_any(path, ALL_DEPLOY_PATTERNS):
            deploy_config = True
        for surface, patterns in CI_SURFACE_PATTERNS.items():
            if _matches_any(path, patterns):
                ci_surfaces[surface] = True
        if _matches_any(path, FULL_PATTERNS):
            ci_surfaces["full"] = True
        for service, patterns in OBSERVABILITY_DEPLOY_PATTERNS.items():
            if _matches_any(path, patterns):
                deploy_services.append(service)

    if any(_matches_any(path, RUNTIME_CONFIG_PATTERNS) for path in normalized_paths):
        deploy_config = True
        deploy_services = ["all"]
    else:
        deploy_services.extend(
            APPLICATION_SERVICES[name]
            for name in ("backend", "frontend", "keycloak")
            if images[name]
        )

    return _result(images, _dedupe(deploy_services), deploy_config, ci_surfaces)


def _result(
    images: dict[str, bool],
    deploy_services: list[str],
    deploy_config: bool,
    ci_surfaces: dict[str, bool],
) -> dict[str, object]:
    image_services = [
        APPLICATION_SERVICES[name] for name in ("backend", "frontend", "keycloak") if images[name]
    ]
    return {
        "images": images,
        "buildServices": image_services,
        "imageServices": image_services,
        "ciSurfaces": ci_surfaces,
        "deployConfig": deploy_config,
        "deployServices": _dedupe(deploy_services),
    }


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def make_manifest(
    commit_sha: str,
    image_tag: str,
    build_run_id: str,
    build_run_number: str,
    plan: dict[str, object],
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "commitSha": commit_sha,
        "imageTag": image_tag,
        "buildRunId": build_run_id,
        "buildRunNumber": int(build_run_number),
        "backendMigrationMaxVersion": int(plan.get("backendMigrationMaxVersion", 0)),
        "images": plan["images"],
        "buildServices": plan["buildServices"],
        "imageServices": plan["imageServices"],
        "deployServices": plan["deployServices"],
    }


def validate_manifest(
    manifest: dict[str, object],
    expected_sha: str | None = None,
    allow_latest: bool = False,
) -> dict[str, object]:
    required = {
        "schemaVersion",
        "commitSha",
        "imageTag",
        "buildRunId",
        "buildRunNumber",
        "backendMigrationMaxVersion",
        "images",
        "buildServices",
        "imageServices",
        "deployServices",
    }
    missing = sorted(required - manifest.keys())
    if missing:
        raise ValueError(f"manifest missing fields: {', '.join(missing)}")
    if manifest["schemaVersion"] != 1:
        raise ValueError("unsupported manifest schemaVersion")
    commit_sha = manifest["commitSha"]
    manifest_image_tag = manifest["imageTag"]
    if not isinstance(commit_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        raise ValueError("manifest commitSha must be a full lowercase commit SHA")
    if expected_sha is not None and commit_sha != expected_sha:
        raise ValueError(f"manifest commitSha {commit_sha} does not match release SHA {expected_sha}")
    expected_tag = image_tag(commit_sha)
    valid_tags = {expected_tag}
    if allow_latest:
        valid_tags.add("latest")
    if manifest_image_tag not in valid_tags:
        raise ValueError(f"manifest imageTag must be {expected_tag}")
    if not isinstance(manifest["buildRunNumber"], int) or manifest["buildRunNumber"] < 1:
        raise ValueError("manifest buildRunNumber must be a positive integer")
    if (
        not isinstance(manifest["backendMigrationMaxVersion"], int)
        or manifest["backendMigrationMaxVersion"] < 0
    ):
        raise ValueError("manifest backendMigrationMaxVersion must be a non-negative integer")
    images = manifest["images"]
    if not isinstance(images, dict) or set(images) != set(IMAGE_NAMES) or any(
        not isinstance(images[name], bool) for name in IMAGE_NAMES
    ):
        raise ValueError("manifest images must contain boolean backend/frontend/keycloak values")
    build_services = manifest["buildServices"]
    image_services = manifest["imageServices"]
    deploy_services = manifest["deployServices"]
    if (
        not _valid_service_list(build_services)
        or not _valid_service_list(image_services)
        or not _valid_service_list(deploy_services)
    ):
        raise ValueError("manifest contains an unsupported or duplicate service")
    expected_image_services = {
        APPLICATION_SERVICES[name] for name in IMAGE_NAMES if images[name]
    }
    if set(image_services) != expected_image_services:
        raise ValueError("manifest imageServices does not match images")
    if build_services != image_services:
        raise ValueError("manifest buildServices must match imageServices")
    for service in deploy_services:
        if service in IMAGE_SERVICE_BY_DEPLOY_SERVICE and service not in image_services:
            raise ValueError(f"deploy service {service} has no corresponding built image")
    return manifest


def image_tag(commit_sha: str) -> str:
    return f"sha-{commit_sha[:IMAGE_TAG_SHA_LENGTH]}"


def _valid_service_list(value: object) -> bool:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return False
    return len(value) == len(set(value)) and all(item in DEPLOYABLE_SERVICES for item in value)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    detect_parser = subparsers.add_parser("detect")
    detect_parser.add_argument("--paths-file")
    detect_parser.add_argument("--manual-service")

    manifest_parser = subparsers.add_parser("manifest")
    manifest_parser.add_argument("--commit-sha", required=True)
    manifest_parser.add_argument("--image-tag", required=True)
    manifest_parser.add_argument("--build-run-id", required=True)
    manifest_parser.add_argument("--build-run-number", required=True)
    manifest_parser.add_argument("--plan", required=True)

    manual_parser = subparsers.add_parser("manual")
    manual_parser.add_argument("--service", required=True)
    manual_parser.add_argument("--commit-sha", required=True)
    manual_parser.add_argument("--build-run-id", default="manual")
    manual_parser.add_argument("--build-run-number", default="1")

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--manifest", required=True)
    validate_parser.add_argument("--expected-sha")
    validate_parser.add_argument("--allow-latest", action="store_true")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "detect":
            if args.manual_service:
                result = detect([], args.manual_service)
            else:
                paths = []
                if args.paths_file:
                    paths = open(args.paths_file, encoding="utf-8").read().splitlines()
                result = detect(paths)
        elif args.command == "manifest":
            plan = json.loads(open(args.plan, encoding="utf-8").read())
            result = make_manifest(
                args.commit_sha,
                args.image_tag,
                args.build_run_id,
                args.build_run_number,
                plan,
            )
            validate_manifest(result, args.commit_sha)
        elif args.command == "manual":
            plan = detect([], args.service)
            result = make_manifest(
                args.commit_sha,
                "latest",
                args.build_run_id,
                args.build_run_number,
                plan,
            )
            validate_manifest(result, args.commit_sha, allow_latest=True)
        else:
            result = validate_manifest(
                json.loads(open(args.manifest, encoding="utf-8").read()),
                args.expected_sha,
                allow_latest=args.allow_latest,
            )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"release plan error: {error}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
