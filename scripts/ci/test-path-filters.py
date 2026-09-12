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

    def test_provider_source_does_not_run_runtime_smoke(self):
        self.assertTrue(changed("keycloak-wargaming-provider/src/main/java/Provider.java", "keycloak_provider"))
        self.assertFalse(changed("keycloak-wargaming-provider/src/main/java/Provider.java", "keycloak_runtime"))


if __name__ == "__main__":
    unittest.main()
