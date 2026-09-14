import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PLANNER = ROOT / "deploy" / "release_plan.py"


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
        self.assertEqual(plan["buildServices"], ["wotb-backend", "wotb-frontend"])

    def test_android_bridge(self):
        self.assert_surfaces(["contracts/android-native-bridge.json"], ["android"])
        self.assertEqual(detect("contracts/android-native-bridge.json")["imageServices"], [])

    def test_backend_dockerfile(self):
        self.assert_surfaces(["docker/Dockerfile.backend"], ["backend", "deploy"])

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

    def test_runtime_compose_is_deploy_all(self):
        plan = detect("deploy/docker-compose.prod.yml")
        self.assertEqual(plan["deployServices"], ["all"])
        self.assert_surfaces(["deploy/docker-compose.prod.yml"], ["deploy"])

    def test_provider_source_runs_provider_and_runtime_smoke(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-juhe-qq-provider"):
            source = f"{provider}/src/main/java/Provider.java"
            self.assert_surfaces([source], ["keycloak", "keycloakProvider", "keycloakRuntime"])

    def test_provider_tests_only_run_provider_tests(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-juhe-qq-provider"):
            test = f"{provider}/src/test/java/ProviderTest.java"
            self.assert_surfaces([test], ["keycloak", "keycloakProvider"])

    def test_provider_build_inputs_run_provider_and_runtime(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-juhe-qq-provider"):
            pom = f"{provider}/pom.xml"
            resources = f"{provider}/src/main/resources/META-INF/services/provider"
            self.assert_surfaces([pom], ["keycloak", "keycloakProvider", "keycloakRuntime"])
            self.assert_surfaces([resources], ["keycloak", "keycloakRuntime"])


if __name__ == "__main__":
    unittest.main()
