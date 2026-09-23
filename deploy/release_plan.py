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


IMAGE_NAMES = ("backend", "frontend", "keycloak", "minio", "parser-worker")
APPLICATION_IMAGE_NAMES = ("backend", "frontend", "keycloak")
# The deploy service a built image is published as. The backend image is owned
# by TX since the business runtime moved there; no Yecao application service is
# deployable any more, so nothing here routes to a retired Yecao container.
APPLICATION_SERVICES = {
    "backend": "business-api",
    "frontend": "wotb-frontend",
    "keycloak": "keycloak",
    "minio": "minio",
    "parser-worker": "parser-worker",
}
DEPLOYABLE_SERVICES = {
    # ``all`` is TX's whole-runtime selector in deploy/tx/deploy.sh. No release plan produces it any
    # more (the deploy workflow expands it before it reaches WOTB_DEPLOY_SERVICES, and the legacy
    # Yecao whole-stack meaning is retired), but it stays a validatable service name because the TX
    # selector list is cross-checked against this set.
    "all",
    "node-exporter",
    "prometheus",
    "loki",
    "alloy",
    "grafana",
    "keycloak",
    "wotb-frontend",
    "business-api",
    "keycloak-postgres",
    "business-postgres",
    "rabbitmq",
    "minio",
    "parser-worker",
    # Caddy is an explicit TX selector in deploy/tx/deploy.sh and is recreated
    # whenever its staged configuration or a proxied application changes. It was
    # missing here, so a manifest naming it could not be validated at all.
    "caddy",
}
DEPLOY_TARGETS = ("tx", "yecao")
TARGET_BY_SERVICE = {
    # ``all`` only exists as the TX whole-runtime selector now; the retired Yecao whole-stack
    # meaning is gone.
    "all": "tx",
    "keycloak": "tx",
    "keycloak-postgres": "tx",
    "business-postgres": "tx",
    "rabbitmq": "tx",
    "wotb-frontend": "tx",
    "business-api": "tx",
    "caddy": "tx",
    "node-exporter": "yecao",
    "prometheus": "yecao",
    "loki": "yecao",
    "alloy": "yecao",
    "grafana": "yecao",
    "minio": "yecao",
    "parser-worker": "yecao",
}
IMAGE_SERVICE_BY_DEPLOY_SERVICE = {
    value: key for key, value in APPLICATION_SERVICES.items()
}
# The backend image is published as ``business-api`` (TX), so no manual alias maps
# to a retired Yecao application service, and the legacy whole-stack ``all``
# selector (which implied the old Yecao control plane) no longer exists.
MANUAL_SERVICE_ALIASES = {
    "backend": "backend",
    "frontend": "frontend",
    "keycloak": "keycloak",
    "minio": "minio",
    "parser-worker": "parser-worker",
}
MANUAL_SERVICES = set(MANUAL_SERVICE_ALIASES)

FRONTEND_PATTERNS = (
    "frontend/**",
    "docker/Dockerfile.frontend",
    "common/map_names.json",
    "common/tankopedia-tier10.json",
    "common/assets/**",
    # docker/Dockerfile.frontend COPYs both documents into the build stage and
    # HistoryPage/TechnicalEvolutionPage/RatingDocsPage inline them with `?raw`, so editing
    # any one changes the produced bundle. `.dockerignore` explicitly re-includes them.
    "HISTORY.md",
    "docs/architecture/TECHNICAL_EVOLUTION.md",
    "docs/WotBTools_League_Rating_V6.md",
    "deploy/nginx/**",
    "contracts/http/**",
)
# Production-image inputs are intentionally narrower than CI test surfaces.
# A Java test, an unrelated reactor module, or an unrelated common fixture must
# not publish a new immutable production image. Keep these lists aligned with
# the Maven reactor closure copied by each production Dockerfile.
BACKEND_JAVA_MODULES = (
    "wotb-contracts",
    "wotb-object-storage-minio",
    "wotb-broker-rabbitmq",
    "wotb-core",
    "wotb-result",
    "wotb-playback",
    "wotb-replay-coordinator",
    "wotb-replay-processing",
    "wotb-ai",
    "wotb-web",
)
PARSER_WORKER_JAVA_MODULES = (
    "wotb-contracts",
    "wotb-object-storage-minio",
    "wotb-broker-rabbitmq",
    "wotb-core",
    "wotb-result",
    "wotb-playback",
    "wotb-replay-processing",
    "wotb-parser-worker",
)


def _production_java_patterns(modules: tuple[str, ...]) -> tuple[str, ...]:
    patterns = ["java/pom.xml", "java/settings-docker.xml"]
    for module in modules:
        patterns.extend((
            f"java/{module}/pom.xml",
            f"java/{module}/src/main/**",
        ))
    return tuple(patterns)


BACKEND_PATTERNS = (
    *_production_java_patterns(BACKEND_JAVA_MODULES),
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
# CI remains deliberately broader than production-image publication: Java tests
# still validate the backend surface even though they cannot change a runtime image.
BACKEND_CI_PATTERNS = (
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

# docker/Dockerfile.keycloak packages only each vendored provider's ``src/main``
# (``mvn -DskipTests clean package``), so a provider test change cannot alter a
# provider jar. Keep the image surface on the runtime inputs; provider tests stay
# on the broader KEYCLOAK_CI_PATTERNS surface below.
KEYCLOAK_PATTERNS = (
    "keycloak-qq-provider/pom.xml",
    "keycloak-qq-provider/src/main/**",
    "keycloak-wargaming-provider/pom.xml",
    "keycloak-wargaming-provider/src/main/**",
    "docker/keycloak/**",
    "docker/Dockerfile.keycloak",
    "infra/tofu/keycloak/**",
    "java/settings-docker.xml",
)
# CI remains deliberately broader than production-image publication here too:
# provider tests still validate the SPI surface even though they cannot change a
# provider jar, exactly like java/**/src/test/** does for the backend surface.
KEYCLOAK_CI_PATTERNS = (
    "keycloak-qq-provider/**",
    "keycloak-wargaming-provider/**",
    "docker/keycloak/**",
    "docker/Dockerfile.keycloak",
    "infra/tofu/keycloak/**",
    "java/settings-docker.xml",
)
MINIO_BUILD_PATTERNS = ("docker/Dockerfile.minio",)
PARSER_WORKER_BUILD_PATTERNS = (
    *_production_java_patterns(PARSER_WORKER_JAVA_MODULES),
    "docker/Dockerfile.parser-worker",
    "common/tankopedia-tier7.json",
    "common/tankopedia-tier8.json",
    "common/tankopedia-tier9.json",
    "common/tankopedia-tier10.json",
    "common/map_names.json",
    "common/tank_tactical_profiles.json",
    "common/map-semantics/**",
    "contracts/mq/**",
)
ALL_DEPLOY_PATTERNS = (
    "deploy/docker-compose.prod.yml",
    "deploy/deploy.sh",
    "deploy/verify-observability.sh",
    "deploy/validate-alloy-config.sh",
    "deploy/grafana-api-request.sh",
)
TX_DEPLOY_PATTERNS = ("deploy/tx/**", "infra/tofu/keycloak/**")
RABBITMQ_TX_DEPLOY_PATTERNS = ("infra/tofu/rabbitmq/**",)
BUSINESS_POSTGRES_TX_DEPLOY_PATTERNS = ("infra/tofu/postgres-business/**",)
RUNTIME_CONFIG_PATTERNS = (
    "deploy/docker-compose.prod.yml",
    *TX_DEPLOY_PATTERNS,
    *RABBITMQ_TX_DEPLOY_PATTERNS,
    *BUSINESS_POSTGRES_TX_DEPLOY_PATTERNS,
)
CI_SURFACE_PATTERNS = {
    "backend": BACKEND_CI_PATTERNS,
    "frontend": FRONTEND_PATTERNS,
    "keycloak": KEYCLOAK_CI_PATTERNS,
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
        "infra/tofu/keycloak/**",
        "infra/tofu/rabbitmq/**",
        "infra/tofu/postgres-business/**",
        # The MinIO root's policy and plan-safety contracts run in the deploy smoke
        # job. It selects no runtime deployment: MinIO provisioning stays an explicit
        # manual `target=minio` action, and deployServices stays empty.
        "infra/tofu/minio/**",
        ".github/workflows/deploy*.yml",
        ".github/workflows/postgres-business-tofu.yml",
        "java/wotb-web/src/main/resources/db/migration/**",
        "java/settings-docker.xml",
    ),
    "observability": (
        "deploy/observability/**",
        "infra/tofu/grafana/**",
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
        "keycloak-qq-provider/src/main/java/**",
        "keycloak-qq-provider/src/test/**",
        "keycloak-qq-provider/pom.xml",
    ),
    "keycloakRuntime": (
        "keycloak-wargaming-provider/src/main/java/**",
        "keycloak-wargaming-provider/pom.xml",
        "keycloak-wargaming-provider/src/main/resources/**",
        "keycloak-qq-provider/src/main/java/**",
        "keycloak-qq-provider/pom.xml",
        "keycloak-qq-provider/src/main/resources/**",
        "docker/Dockerfile.keycloak",
        "docker/keycloak/**",
        "infra/tofu/keycloak/**",
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
            for name in APPLICATION_IMAGE_NAMES:
                images[name] = True
        if _matches_any(path, FRONTEND_PATTERNS):
            images["frontend"] = True
        if _matches_any(path, BACKEND_PATTERNS):
            images["backend"] = True
        if _matches_any(path, KEYCLOAK_PATTERNS):
            images["keycloak"] = True
        if _matches_any(path, MINIO_BUILD_PATTERNS):
            # Building the source-pinned MinIO image never implies a runtime
            # deployment. Its deployment is an explicit manual action only.
            images["minio"] = True
        if _matches_any(path, PARSER_WORKER_BUILD_PATTERNS):
            # The Yecao parser-worker shares the JVM build surface with the
            # backend and consumes the same common data plus the MQ contract.
            # Building it never implies a runtime deployment either: the
            # generic Yecao deploy path only accepts service names that
            # deploy.sh validates, so the parser-worker is an explicit manual
            # action until that deploy path owns it.
            images["parser-worker"] = True
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
        # A Compose-config change selects the affected runtime services instead
        # of inferring them from application image changes. Observability
        # services declared by file provisioning are the one exception and stay
        # additive.
        deploy_services = [name for name in deploy_services if name in OBSERVABILITY_DEPLOY_PATTERNS]
        if any(_matches(path, "deploy/docker-compose.prod.yml") for path in normalized_paths):
            # The Yecao runtime is the parser execution plane plus the shared
            # observability stack. The retired Yecao application services
            # (postgres, wotb-backend, wotb-frontend, keycloak) are gone: TX owns
            # the business runtime, its PostgreSQL, Keycloak and the frontend, so
            # a Yecao Compose-config release can no longer select them.
            deploy_services.extend([
                "node-exporter", "prometheus", "loki", "alloy", "grafana"
            ])
        if any(_matches_any(path, TX_DEPLOY_PATTERNS) for path in normalized_paths):
            # A TX topology change cannot safely infer an application image
            # identity from prior metadata. Rebuild the TX application images
            # from the frozen commit and deploy that exact set after Tofu; this
            # also guarantees a Compose-only change actually reaches the running
            # business runtime.
            images["frontend"] = True
            images["keycloak"] = True
            images["backend"] = True
            deploy_services.extend(["keycloak-postgres", "keycloak", "wotb-frontend", "business-api"])
        if any(_matches_any(path, RABBITMQ_TX_DEPLOY_PATTERNS) for path in normalized_paths):
            # RabbitMQ's runtime image is upstream-pinned in Compose. Its
            # isolated provider root must not rebuild or restart Keycloak,
            # PostgreSQL, or the frontend.
            deploy_services.append("rabbitmq")
        if any(_matches_any(path, BUSINESS_POSTGRES_TX_DEPLOY_PATTERNS) for path in normalized_paths):
            # Business PostgreSQL's runtime image is upstream-pinned in Compose
            # and no application image consumes it yet. Its isolated root must
            # never rebuild or restart Keycloak, PostgreSQL, or the frontend.
            deploy_services.append("business-postgres")
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
    image_services = [APPLICATION_SERVICES[name] for name in IMAGE_NAMES if images[name]]
    return {
        "images": images,
        "buildServices": image_services,
        "imageServices": image_services,
        "ciSurfaces": ci_surfaces,
        "deployConfig": deploy_config,
        "deployServices": _dedupe(deploy_services),
        "targetServices": _target_services(_dedupe(deploy_services)),
    }


def _target_services(services: list[str]) -> dict[str, list[str]]:
    """Route each deploy service to one explicit host target."""
    result = {target: [] for target in DEPLOY_TARGETS}
    for service in services:
        result[TARGET_BY_SERVICE[service]].append(service)
    return {target: values for target, values in result.items() if values}


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
        "schemaVersion": 2,
        "commitSha": commit_sha,
        "imageTag": image_tag,
        "buildRunId": build_run_id,
        "buildRunNumber": int(build_run_number),
        "backendMigrationMaxVersion": int(plan.get("backendMigrationMaxVersion", 0)),
        "images": plan["images"],
        "buildServices": plan["buildServices"],
        "imageServices": plan["imageServices"],
        "deployServices": plan["deployServices"],
        "targetServices": plan["targetServices"],
    }


def validate_manifest(
    manifest: dict[str, object],
    expected_sha: str | None = None,
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
        "targetServices",
    }
    missing = sorted(required - manifest.keys())
    if missing:
        raise ValueError(f"manifest missing fields: {', '.join(missing)}")
    if manifest["schemaVersion"] != 2:
        raise ValueError("unsupported manifest schemaVersion")
    commit_sha = manifest["commitSha"]
    manifest_image_tag = manifest["imageTag"]
    if not isinstance(commit_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        raise ValueError("manifest commitSha must be a full lowercase commit SHA")
    if expected_sha is not None and commit_sha != expected_sha:
        raise ValueError(f"manifest commitSha {commit_sha} does not match release SHA {expected_sha}")
    expected_tag = image_tag(commit_sha)
    if manifest_image_tag != expected_tag:
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
        raise ValueError(
            f"manifest images must contain boolean {'/'.join(IMAGE_NAMES)} values"
        )
    build_services = manifest["buildServices"]
    image_services = manifest["imageServices"]
    deploy_services = manifest["deployServices"]
    target_services = manifest["targetServices"]
    if (
        not _valid_service_list(build_services)
        or not _valid_service_list(image_services)
        or not _valid_service_list(deploy_services)
    ):
        raise ValueError("manifest contains an unsupported or duplicate service")
    expected_image_services = {APPLICATION_SERVICES[name] for name in IMAGE_NAMES if images[name]}
    if set(image_services) != expected_image_services:
        raise ValueError("manifest imageServices does not match images")
    if build_services != image_services:
        raise ValueError("manifest buildServices must match imageServices")
    for service in deploy_services:
        if service in IMAGE_SERVICE_BY_DEPLOY_SERVICE and service not in image_services:
            raise ValueError(f"deploy service {service} has no corresponding built image")
    if not isinstance(target_services, dict):
        raise ValueError("manifest targetServices must be an object")
    if not deploy_services and target_services:
        raise ValueError("manifest targetServices must be empty for a no-op release")
    if deploy_services and not target_services:
        raise ValueError("manifest targetServices must be non-empty when services deploy")
    if set(target_services) - set(DEPLOY_TARGETS):
        raise ValueError("manifest targetServices contains an unsupported target")
    flattened: list[str] = []
    for target, services in target_services.items():
        if not _valid_service_list(services):
            raise ValueError(f"manifest targetServices[{target}] is invalid")
        for service in services:
            expected_target = TARGET_BY_SERVICE[service]
            if target != expected_target:
                raise ValueError(f"deploy service {service} is routed to {target}, expected {expected_target}")
        flattened.extend(services)
    if len(flattened) != len(set(flattened)) or set(flattened) != set(deploy_services):
        raise ValueError("manifest targetServices must contain each deploy service exactly once")
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
                image_tag(args.commit_sha),
                args.build_run_id,
                args.build_run_number,
                plan,
            )
            validate_manifest(result, args.commit_sha)
        else:
            result = validate_manifest(
                json.loads(open(args.manifest, encoding="utf-8").read()),
                args.expected_sha,
            )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"release plan error: {error}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
