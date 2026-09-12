import fnmatch
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/ci.yml"


def load_filters():
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    step = next(
        step
        for step in workflow["jobs"]["changes"]["steps"]
        if step.get("id") == "path_filter"
    )
    return yaml.safe_load(step["with"]["filters"])


FILTERS = load_filters()


def matches(path, pattern):
    if pattern.endswith("/**"):
        prefix = pattern[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    return fnmatch.fnmatchcase(path, pattern)


def changed(path, name):
    included = False
    for pattern in FILTERS[name]:
        excluded = pattern.startswith("!")
        pattern = pattern[1:] if excluded else pattern
        if matches(path, pattern):
            if excluded:
                return False
            included = True
    return included


class CiPathFilterTest(unittest.TestCase):
    def assert_domains(self, paths, expected):
        actual = {name for name in FILTERS if any(changed(path, name) for path in paths)}
        self.assertEqual(actual, set(expected))

    def test_docs_only(self):
        self.assert_domains(["docs/foo.md"], [])

    def test_java_only(self):
        self.assert_domains(["java/wotb-web/src/main/java/FooService.java"], ["backend", "http_contract"])

    def test_frontend_only(self):
        self.assert_domains(["frontend/src/components/Foo.vue"], ["frontend"])

    def test_frontend_embedded_doc(self):
        self.assert_domains(["docs/WotBTools_League_Rating_V6.md"], ["frontend"])

    def test_openapi(self):
        self.assert_domains(["contracts/http/openapi.yaml"], ["backend", "frontend", "http_contract"])

    def test_android_bridge(self):
        self.assert_domains(
            ["contracts/android-native-bridge.json"], ["android", "frontend"]
        )

    def test_backend_dockerfile(self):
        self.assert_domains(["docker/Dockerfile.backend"], ["backend", "deploy"])

    def test_grafana_dashboard(self):
        self.assert_domains(
            ["deploy/observability/grafana/dashboards/home.json"],
            ["observability"],
        )

    def test_ci_workflow_is_full(self):
        self.assert_domains([".github/workflows/ci.yml"], ["full"])
        self.assertTrue(changed(".github/workflows/build.yml", "full"))

    def test_provider_source_runs_provider_and_runtime_smoke(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-juhe-qq-provider"):
            source = f"{provider}/src/main/java/Provider.java"
            self.assertTrue(changed(source, "keycloak_provider"))
            self.assertTrue(changed(source, "keycloak_runtime"))

    def test_provider_tests_only_run_provider_tests(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-juhe-qq-provider"):
            test = f"{provider}/src/test/java/ProviderTest.java"
            self.assertTrue(changed(test, "keycloak_provider"))
            self.assertFalse(changed(test, "keycloak_runtime"))

    def test_provider_build_inputs_run_provider_and_runtime(self):
        for provider in ("keycloak-wargaming-provider", "keycloak-juhe-qq-provider"):
            pom = f"{provider}/pom.xml"
            resources = f"{provider}/src/main/resources/META-INF/services/provider"
            self.assertTrue(changed(pom, "keycloak_provider"))
            self.assertTrue(changed(pom, "keycloak_runtime"))
            self.assertFalse(changed(resources, "keycloak_provider"))
            self.assertTrue(changed(resources, "keycloak_runtime"))


if __name__ == "__main__":
    unittest.main()
