import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PLANNER = ROOT / "deploy" / "release_plan.py"

NO_IMAGES = {"backend": False, "frontend": False, "keycloak": False, "minio": False, "parser-worker": False}
KEYCLOAK_ONLY_IMAGES = {**NO_IMAGES, "keycloak": True}

# Which production images actually package a given Maven module's runtime sources,
# derived from the COPY lists in docker/Dockerfile.backend / docker/Dockerfile.parser-worker
# and their `-am` reactor closures. Shared modules must rebuild every consumer; a module
# must never cross-select the image whose Dockerfile does not copy its sources.
MODULE_BUILD_SERVICES = {
    # Copied by both Dockerfiles (shared reactor closure).
    "wotb-contracts": ["business-api", "parser-worker"],
    "wotb-object-storage-minio": ["business-api", "parser-worker"],
    "wotb-broker-rabbitmq": ["business-api", "parser-worker"],
    "wotb-core": ["business-api", "parser-worker"],
    "wotb-result": ["business-api", "parser-worker"],
    "wotb-playback": ["business-api", "parser-worker"],
    "wotb-replay-processing": ["business-api", "parser-worker"],
    # Backend-only reactor closure (`mvn -pl wotb-core,wotb-web -am`).
    "wotb-replay-coordinator": ["business-api"],
    "wotb-ai": ["business-api"],
    "wotb-web": ["business-api"],
    # Parser-worker-only reactor closure (`mvn -pl wotb-parser-worker -am`).
    "wotb-parser-worker": ["parser-worker"],
}


def detect(*paths):
    with tempfile.TemporaryDirectory() as directory:
        path_file = Path(directory) / "changed-files.txt"
        path_file.write_text("\n".join(paths) + "\n", encoding="utf-8")
        output = subprocess.check_output(
            [sys.executable, str(PLANNER), "detect", "--paths-file", str(path_file)],
            text=True,
        )
    return json.loads(output)


class CiPathFilterTest(unittest.TestCase):
    def assert_surfaces(self, paths, expected):
        actual = {
            name for name, changed in detect(*paths)["ciSurfaces"].items() if changed
        }
        self.assertEqual(actual, set(expected))

    def test_docs_only(self):
        self.assert_surfaces(["docs/foo.md"], [])
        self.assertEqual(detect("docs/foo.md")["imageServices"], [])

    def test_java_only(self):
        self.assert_surfaces(["java/wotb-core/src/main/java/FooService.java"], ["backend"])
        self.assert_surfaces(
            ["java/wotb-web/src/main/java/FooService.java"], ["backend", "httpContract"]
        )

    def test_frontend_only(self):
        self.assert_surfaces(["frontend/src/components/Foo.vue"], ["frontend"])

    def test_frontend_embedded_doc(self):
        self.assert_surfaces(["docs/WotBTools_League_Rating_V6.md"], ["frontend"])

    def test_openapi(self):
        plan = detect("contracts/http/openapi.yaml")
        self.assert_surfaces(["contracts/http/openapi.yaml"], ["backend", "frontend", "httpContract"])
        self.assertEqual(plan["buildServices"], ["business-api", "wotb-frontend"])

    def test_android_bridge(self):
        self.assert_surfaces(["contracts/android-native-bridge.json"], ["android"])
        self.assertEqual(detect("contracts/android-native-bridge.json")["imageServices"], [])

    def test_backend_dockerfile(self):
        self.assert_surfaces(["docker/Dockerfile.backend"], ["backend", "deploy"])

    def test_minio_image_build_never_selects_a_runtime_deployment(self):
        plan = detect("docker/Dockerfile.minio")
        self.assert_surfaces(["docker/Dockerfile.minio"], ["deploy"])
        self.assertEqual(plan["buildServices"], ["minio"])
        self.assertEqual(plan["deployServices"], [])

    def test_minio_compose_never_selects_a_runtime_deployment(self):
        plan = detect("deploy/docker-compose.minio.yml")
        self.assert_surfaces(["deploy/docker-compose.minio.yml"], ["deploy"])
        self.assertEqual(plan["deployServices"], [])

    def test_minio_opentofu_root_runs_deploy_smoke_without_a_runtime_deployment(self):
        # Every other OpenTofu root selects the deploy smoke job that validates its
        # plan-safety contract; the MinIO root must do the same, or a policy-only
        # change reaches main with no validation at all. Provisioning stays manual:
        # no build and no runtime deployment may be inferred from the root.
        for path in (
            "infra/tofu/minio/minio.tf",
            "infra/tofu/minio/validate-plan.sh",
            "infra/tofu/minio/test-validate-plan.sh",
            "infra/tofu/minio/variables.tf",
        ):
            plan = detect(path)
            self.assert_surfaces([path], ["deploy"])
            self.assertEqual(plan["buildServices"], [], path)
            self.assertEqual(plan["imageServices"], [], path)
            self.assertEqual(plan["deployServices"], [], path)
            self.assertEqual(plan["targetServices"], {}, path)

    def test_parser_worker_image_build_never_selects_a_runtime_deployment(self):
        for path, expected_build_services, expected_deploy_services in (
            ("docker/Dockerfile.parser-worker", ["parser-worker"], []),
            ("contracts/mq/parser-messages.json", ["parser-worker"], []),
            (
                "java/wotb-parser-worker/src/main/java/com/wotb/parserworker/ParserWorkerApplication.java",
                ["parser-worker"],
                [],
            ),
        ):
            plan = detect(path)
            self.assertEqual(plan["buildServices"], expected_build_services, path)
            self.assertEqual(plan["imageServices"], expected_build_services, path)
            self.assertEqual(plan["deployServices"], expected_deploy_services, path)
            self.assertEqual(
                plan["targetServices"],
                {"tx": expected_deploy_services} if expected_deploy_services else {},
                path,
            )
        self.assert_surfaces(["docker/Dockerfile.parser-worker"], ["deploy"])
        self.assert_surfaces(
            ["java/wotb-parser-worker/src/main/java/com/wotb/parserworker/ParserWorkerApplication.java"],
            ["backend"],
        )

    def test_parser_worker_dockerfile_is_not_the_minio_image(self):
        plan = detect("docker/Dockerfile.parser-worker")
        self.assertNotIn("minio", plan["imageServices"])
        self.assertEqual(plan["images"]["minio"], False)
        self.assertEqual(plan["images"]["parser-worker"], True)

    def test_unrelated_common_data_does_not_publish_runtime_images(self):
        plan = detect("common/unrelated-fixture.json")
        self.assertEqual(plan["buildServices"], [])
        self.assertEqual(plan["deployServices"], [])

    def test_runtime_data_shared_by_images_builds_only_consumers(self):
        plan = detect("common/tank_tactical_profiles.json")
        self.assertEqual(plan["buildServices"], ["business-api", "parser-worker"])
        self.assertEqual(plan["deployServices"], ["business-api"])

    def test_java_test_changes_validate_ci_without_publishing_images(self):
        for path in (
            "java/wotb-web/src/test/java/FooTest.java",
            "java/wotb-parser-worker/src/test/java/WorkerTest.java",
        ):
            plan = detect(path)
            self.assertTrue(plan["ciSurfaces"]["backend"], path)
            self.assertEqual(plan["buildServices"], [], path)
            self.assertEqual(plan["imageServices"], [], path)
            self.assertEqual(plan["deployServices"], [], path)
            self.assertEqual(plan["targetServices"], {}, path)
            self.assertEqual(plan["images"], NO_IMAGES, path)

    def test_java_runtime_modules_build_only_images_that_consume_them(self):
        web = detect("java/wotb-web/src/main/java/Foo.java")
        self.assertEqual(web["buildServices"], ["business-api"])
        self.assertEqual(web["deployServices"], ["business-api"])
        worker = detect("java/wotb-parser-worker/src/main/java/Worker.java")
        self.assertEqual(worker["buildServices"], ["parser-worker"])
        self.assertEqual(worker["deployServices"], [])

    # --- production image build surface ------------------------------------------------
    # Expected values below are derived from the COPY lists in
    # docker/Dockerfile.backend / docker/Dockerfile.parser-worker and the Maven reactor
    # closures (`mvn -pl wotb-core,wotb-web -am` and `mvn -pl wotb-parser-worker -am`),
    # so these tests independently pin the real build inputs instead of restating the
    # planner's own module constants.

    def test_java_module_image_matrix_matches_the_dockerfile_copy_lists(self):
        for module, expected in MODULE_BUILD_SERVICES.items():
            plan = detect(f"java/{module}/src/main/java/Foo.java")
            self.assertEqual(plan["buildServices"], expected, module)
            self.assertEqual(plan["imageServices"], expected, module)
            self.assertEqual(
                plan["images"],
                {
                    "backend": "business-api" in expected,
                    "frontend": False,
                    "keycloak": False,
                    "minio": False,
                    "parser-worker": "parser-worker" in expected,
                },
                module,
            )
            # Only the TX business runtime is deployable from a Java image build.
            self.assertEqual(
                plan["deployServices"],
                ["business-api"] if "business-api" in expected else [],
                module,
            )

    def test_java_module_poms_select_only_their_own_image(self):
        # Both Dockerfiles COPY every module pom so the reactor resolves, but `-am`
        # only builds the selected closure: a module pom must not cross-select the
        # sibling image.
        for module, expected in (
            ("wotb-web", ["business-api"]),
            ("wotb-ai", ["business-api"]),
            ("wotb-replay-coordinator", ["business-api"]),
            ("wotb-parser-worker", ["parser-worker"]),
            ("wotb-core", ["business-api", "parser-worker"]),
        ):
            plan = detect(f"java/{module}/pom.xml")
            self.assertEqual(plan["buildServices"], expected, module)
            self.assertTrue(plan["ciSurfaces"]["full"], module)

    def test_parent_maven_build_inputs_select_every_dependent_java_image(self):
        # java/pom.xml is the shared parent reactor: both Java images embed it.
        parent = detect("java/pom.xml")
        self.assertEqual(parent["buildServices"], ["business-api", "parser-worker"])
        self.assertEqual(parent["deployServices"], ["business-api"])
        self.assertTrue(parent["ciSurfaces"]["full"])
        # settings-docker.xml is COPYed by the backend, keycloak and parser-worker Dockerfiles.
        settings = detect("java/settings-docker.xml")
        self.assertEqual(settings["buildServices"], ["business-api", "keycloak", "parser-worker"])
        self.assertEqual(settings["deployServices"], ["business-api", "keycloak"])
        self.assertTrue(settings["ciSurfaces"]["keycloakRuntime"])

    def test_common_build_inputs_select_only_the_dockerfiles_that_copy_them(self):
        self.assertEqual(detect("common/unrelated-fixture.json")["buildServices"], [])
        self.assertEqual(detect("common/unrelated-fixture.json")["deployServices"], [])
        # COPYed by docker/Dockerfile.backend and docker/Dockerfile.parser-worker.
        for path in (
            "common/tankopedia-tier7.json",
            "common/tankopedia-tier8.json",
            "common/tankopedia-tier9.json",
            "common/tank_tactical_profiles.json",
            "common/map-semantics/europe.json",
        ):
            plan = detect(path)
            self.assertEqual(plan["buildServices"], ["business-api", "parser-worker"], path)
            self.assertEqual(plan["deployServices"], ["business-api"], path)
        # Additionally COPYed by docker/Dockerfile.frontend.
        for path in ("common/tankopedia-tier10.json", "common/map_names.json"):
            plan = detect(path)
            self.assertEqual(
                plan["buildServices"], ["business-api", "wotb-frontend", "parser-worker"], path
            )
            self.assertEqual(plan["deployServices"], ["business-api", "wotb-frontend"], path)

    def test_frontend_build_inputs_select_frontend_only(self):
        for path in (
            "frontend/src/main.js",
            "HISTORY.md",
            "docs/WotBTools_League_Rating_V6.md",
            "deploy/nginx/nginx.conf",
        ):
            plan = detect(path)
            self.assertEqual(plan["buildServices"], ["wotb-frontend"], path)
            self.assertEqual(plan["deployServices"], ["wotb-frontend"], path)
            self.assertTrue(plan["ciSurfaces"]["frontend"], path)
        # Also COPYed by the frontend Dockerfile, but these are shared with the Java images.
        for path in ("common/assets/icon.ico", "common/map_names.json", "common/tankopedia-tier10.json"):
            self.assertIn("wotb-frontend", detect(path)["buildServices"], path)

    def test_history_document_is_a_frontend_build_input(self):
        # HistoryPage imports HISTORY.md with `?raw` and .dockerignore re-includes it,
        # so editing it changes the produced bundle instead of being a docs-only no-op.
        plan = detect("HISTORY.md")
        self.assertEqual(
            plan["images"],
            {"backend": False, "frontend": True, "keycloak": False, "minio": False, "parser-worker": False},
        )
        self.assertTrue(plan["ciSurfaces"]["frontend"])
        self.assertFalse(plan["ciSurfaces"]["full"])

    def test_keycloak_provider_runtime_inputs_select_keycloak_only(self):
        # Every entry is COPYed into docker/Dockerfile.keycloak.
        for path in (
            "keycloak-wargaming-provider/src/main/java/Provider.java",
            "keycloak-qq-provider/src/main/resources/META-INF/services/provider",
            "docker/keycloak/wotbtools-entrypoint.sh",
        ):
            plan = detect(path)
            self.assertEqual(plan["buildServices"], ["keycloak"], path)
            self.assertEqual(plan["deployServices"], ["keycloak"], path)
            self.assertEqual(plan["images"], KEYCLOAK_ONLY_IMAGES, path)

    def test_keycloak_provider_test_inputs_publish_no_image(self):
        # `mvn -DskipTests clean package` never packages src/test into a provider jar,
        # so provider tests must run CI validation without publishing the Keycloak image.
        for provider in ("keycloak-qq-provider", "keycloak-wargaming-provider"):
            path = f"{provider}/src/test/java/ProviderTest.java"
            plan = detect(path)
            self.assertEqual(plan["buildServices"], [], path)
            self.assertEqual(plan["imageServices"], [], path)
            self.assertEqual(plan["deployServices"], [], path)
            self.assertEqual(plan["images"], NO_IMAGES, path)
            # CI still validates the provider SPI surface.
            self.assertTrue(plan["ciSurfaces"]["keycloak"], path)
            self.assertTrue(plan["ciSurfaces"]["keycloakProvider"], path)
            self.assertFalse(plan["ciSurfaces"]["keycloakRuntime"], path)

    def test_production_dockerfile_selects_exactly_its_own_image(self):
        for dockerfile, expected, expected_deploy in (
            ("docker/Dockerfile.backend", ["business-api"], ["business-api"]),
            ("docker/Dockerfile.frontend", ["wotb-frontend"], ["wotb-frontend"]),
            ("docker/Dockerfile.keycloak", ["keycloak"], ["keycloak"]),
            ("docker/Dockerfile.minio", ["minio"], []),
            ("docker/Dockerfile.parser-worker", ["parser-worker"], []),
        ):
            plan = detect(dockerfile)
            self.assertEqual(plan["buildServices"], expected, dockerfile)
            self.assertEqual(plan["imageServices"], expected, dockerfile)
            self.assertEqual(plan["deployServices"], expected_deploy, dockerfile)
            self.assertTrue(plan["ciSurfaces"]["deploy"], dockerfile)

    def test_grafana_dashboard(self):
        self.assert_surfaces(
            ["deploy/observability/grafana/dashboards/home.json"], ["deploy", "observability"]
        )

    def test_ci_workflow_is_full(self):
        plan = detect(".github/workflows/ci.yml")
        self.assert_surfaces([".github/workflows/ci.yml"], ["full"])
        self.assertFalse(plan["ciSurfaces"]["liveData"])

    def test_deploy_workflow_does_not_trigger_live_data_contracts(self):
        plan = detect(".github/workflows/deploy.yml")
        self.assertFalse(plan["ciSurfaces"]["liveData"])

    def test_deploy_script_does_not_trigger_live_data_contracts(self):
        plan = detect("deploy/deploy.sh")
        self.assert_surfaces(["deploy/deploy.sh"], ["deploy"])
        self.assertFalse(plan["ciSurfaces"]["liveData"])

    def test_live_data_inputs_trigger_live_data_contracts(self):
        equipment_sync = detect("common/python/sync_equipment_snapshot.py")
        self.assertTrue(equipment_sync["ciSurfaces"]["liveData"])
        tankopedia_snapshot = detect("common/tankopedia-tier10.json")
        self.assertTrue(tankopedia_snapshot["ciSurfaces"]["liveData"])

    def test_yecao_runtime_compose_does_not_refresh_retired_application_services(self):
        plan = detect("deploy/docker-compose.prod.yml")
        self.assertEqual(plan["deployServices"], [
            "node-exporter", "prometheus", "loki", "alloy", "grafana"
        ])
        self.assertEqual(plan["targetServices"], {"yecao": plan["deployServices"]})
        # The retired Yecao application runtime must not be reachable from a Compose-config release.
        for retired in ("postgres", "wotb-backend", "wotb-frontend", "keycloak"):
            self.assertNotIn(retired, plan["deployServices"])
        self.assert_surfaces(["deploy/docker-compose.prod.yml"], ["deploy"])

    def test_provider_source_runs_provider_and_runtime_smoke(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-qq-provider"):
            source = f"{provider}/src/main/java/Provider.java"
            self.assert_surfaces([source], ["keycloak", "keycloakProvider", "keycloakRuntime"])

    def test_provider_tests_only_run_provider_tests(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-qq-provider"):
            test = f"{provider}/src/test/java/ProviderTest.java"
            self.assert_surfaces([test], ["keycloak", "keycloakProvider"])

    def test_provider_build_inputs_run_provider_and_runtime(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-qq-provider"):
            pom = f"{provider}/pom.xml"
            resources = f"{provider}/src/main/resources/META-INF/services/provider"
            self.assert_surfaces([pom], ["keycloak", "keycloakProvider", "keycloakRuntime"])
            self.assert_surfaces([resources], ["keycloak", "keycloakRuntime"])

    def test_keycloak_opentofu_root_runs_tx_deploy_and_runtime_contracts(self):
        self.assert_surfaces(
            ["infra/tofu/keycloak/realm.tf"],
            ["keycloak", "keycloakRuntime", "deploy"],
        )

    def test_rabbitmq_opentofu_root_selects_only_rabbitmq_deploy_smoke(self):
        plan = detect("infra/tofu/rabbitmq/rabbitmq.tf")
        self.assert_surfaces(["infra/tofu/rabbitmq/rabbitmq.tf"], ["deploy"])
        self.assertEqual(plan["buildServices"], [])
        self.assertEqual(plan["deployServices"], ["rabbitmq"])
        self.assertEqual(plan["targetServices"], {"tx": ["rabbitmq"]})

    def test_business_postgres_opentofu_root_never_rebuilds_application_images(self):
        for path in (
            "infra/tofu/postgres-business/business.tf",
            "infra/tofu/postgres-business/variables.tf",
            "infra/tofu/postgres-business/.terraform.lock.hcl",
            "infra/tofu/postgres-business/validate-plan.sh",
        ):
            plan = detect(path)
            self.assertEqual(plan["buildServices"], [], path)
            self.assertEqual(plan["imageServices"], [], path)
            self.assertEqual(plan["deployServices"], ["business-postgres"], path)
            self.assertEqual(plan["targetServices"], {"tx": ["business-postgres"]}, path)
        self.assert_surfaces(
            ["infra/tofu/postgres-business/business.tf"], ["deploy"]
        )

    def test_business_postgres_tofu_workflow_is_a_deploy_surface(self):
        plan = detect(".github/workflows/postgres-business-tofu.yml")
        self.assertTrue(plan["ciSurfaces"]["deploy"])
        self.assertEqual(plan["imageServices"], [])
        self.assertEqual(plan["deployServices"], [])

    def test_tx_compose_config_still_excludes_business_postgres(self):
        plan = detect("deploy/tx/docker-compose.yml")
        self.assertEqual(
            plan["deployServices"], ["keycloak-postgres", "keycloak", "wotb-frontend", "business-api"]
        )
        self.assertNotIn("business-postgres", plan["deployServices"])
        # A Compose-only TX change must rebuild the TX application images from
        # the frozen commit: their identity cannot be inferred from metadata.
        self.assertEqual(
            plan["images"],
            {"backend": True, "frontend": True, "keycloak": True, "minio": False, "parser-worker": False},
        )


if __name__ == "__main__":
    unittest.main()
