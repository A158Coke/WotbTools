"""Behavior tests for the CI-only Git-range impact selector."""

import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ci_impact", ROOT / "scripts/ci/ci-impact.py")
impact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(impact)
BASE = "a" * 40
HEAD = "b" * 40


def selected(*paths):
    def read(_sha, path):
        file = ROOT / path
        return file.read_text(encoding="utf-8") if file.exists() else None

    with (
        patch.object(impact, "validate_revisions"),
        patch.object(impact, "changed_paths", return_value=list(paths)),
        patch.object(impact, "blob", side_effect=read),
    ):
        return impact.select(BASE, HEAD)


class CiImpactSelectionTest(unittest.TestCase):
    def test_selector_exposes_validation_only_outputs(self):
        result = selected("docs/README.md")
        self.assertEqual(
            set(result),
            {"surfaces", "javaModules", "javaFull", "frontendBrowserSuites", "tofuRoots"},
        )
        self.assertFalse(any(result["surfaces"].values()))
        self.assertEqual(result["javaModules"], [])
        self.assertEqual(result["tofuRoots"], [])

    def test_ci_and_selector_changes_run_full_validation(self):
        for path in (".github/workflows/ci.yml", "scripts/ci/ci-impact.py"):
            with self.subTest(path=path):
                result = selected(path)
                self.assertTrue(result["surfaces"]["full"])
                self.assertTrue(result["javaFull"])

    def test_java_modules_and_global_build_inputs(self):
        web = selected("java/wotb-web/pom.xml")
        self.assertTrue(web["surfaces"]["backend"])
        self.assertTrue(web["surfaces"]["httpContract"])
        self.assertEqual(web["javaModules"], ["wotb-web"])
        self.assertFalse(web["javaFull"])

        worker = selected("java/wotb-parser-worker/src/main/java/Foo.java")
        self.assertEqual(worker["javaModules"], ["wotb-parser-worker"])
        self.assertFalse(worker["javaFull"])

        for path in ("java/pom.xml", "java/settings.xml", "java/settings-docker.xml"):
            with self.subTest(path=path):
                result = selected(path)
                self.assertTrue(result["surfaces"]["full"])
                self.assertTrue(result["javaFull"])
                self.assertEqual(result["javaModules"], [])
        docker_settings = selected("java/settings-docker.xml")
        self.assertTrue(docker_settings["surfaces"]["keycloakProvider"])
        self.assertTrue(docker_settings["surfaces"]["keycloakRuntime"])

    def test_unknown_java_module_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "unknown changed Java module"):
            selected("java/not-a-module/src/main/java/Foo.java")

    def test_removed_java_module_selects_full_backend_validation(self):
        base_modules = ["wotb-core"]
        head_modules = []
        with (
            patch.object(impact, "validate_revisions"),
            patch.object(impact, "changed_paths", return_value=["java/wotb-core/pom.xml"]),
            patch.object(impact, "reactor_modules", side_effect=[head_modules, base_modules]),
        ):
            result = impact.select(BASE, HEAD)
        self.assertTrue(result["surfaces"]["backend"])
        self.assertTrue(result["surfaces"]["full"])
        self.assertTrue(result["javaFull"])
        self.assertEqual(result["javaModules"], [])

    def test_frontend_browser_suite_selection(self):
        replay = selected("frontend/src/components/ReplayPage.vue")
        self.assertTrue(replay["surfaces"]["frontend"])
        self.assertEqual(
            replay["frontendBrowserSuites"], ["playback-layout", "workspace-interaction"],
        )

        component_test = selected("frontend/src/components/AdminUsersPage.test.js")
        self.assertTrue(component_test["surfaces"]["frontend"])
        self.assertEqual(component_test["frontendBrowserSuites"], [])

        for path in (
            "frontend/index.html", "frontend/src/main.js", "frontend/src/App.vue",
            "frontend/src/app/router.js", "frontend/src/styles/app-shell.css",
        ):
            with self.subTest(path=path):
                self.assertEqual(selected(path)["frontendBrowserSuites"], [
                    "playback-layout", "workspace-interaction",
                ])

    def test_http_mq_android_and_data_contracts(self):
        http = selected("contracts/http/openapi.yaml")
        for surface in ("httpContract", "backend", "frontend"):
            self.assertTrue(http["surfaces"][surface])

        mq = selected("contracts/mq/parser-messages.json")
        self.assertEqual(mq["javaModules"], ["wotb-broker-rabbitmq", "wotb-parser-worker"])
        self.assertTrue(mq["surfaces"]["backend"])

        android = selected("contracts/android-native-bridge.json")
        self.assertTrue(android["surfaces"]["android"])
        self.assertTrue(selected("android/app/src/main/AndroidManifest.xml")["surfaces"]["android"])

        tankopedia = selected("common/tankopedia-tier8.json")
        self.assertTrue(tankopedia["surfaces"]["data"])
        self.assertTrue(tankopedia["surfaces"]["liveData"])
        self.assertTrue(tankopedia["surfaces"]["backend"])

        crew = selected("common/crew-skills.json")
        self.assertTrue(crew["surfaces"]["data"])
        self.assertTrue(crew["surfaces"]["liveData"])

    def test_all_tofu_roots_and_safety_fixture_helpers_are_selected(self):
        for root_name, prefix in impact.TOFU_ROOTS.items():
            with self.subTest(root=root_name):
                result = selected(prefix + "variables.tf")
                self.assertEqual(result["tofuRoots"], [root_name])
                self.assertTrue(result["surfaces"]["deploy"])

        self.assertEqual(selected("deploy/tx/keycloak-tofu.sh")["tofuRoots"], ["keycloak"])
        self.assertEqual(selected("deploy/tx/rabbitmq.tofurc")["tofuRoots"], ["rabbitmq"])
        self.assertEqual(selected("deploy/tx/business-postgres.tofurc")["tofuRoots"], ["business-postgres"])
        self.assertEqual(selected("deploy/minio/tofurc")["tofuRoots"], ["minio"])
        self.assertEqual(
            selected("deploy/observability/grafana/dashboards/home.json")["tofuRoots"],
            ["grafana"],
        )

    def test_deploy_and_observability_changes_select_validation_only(self):
        deleted_planner = selected("deploy/release_plan.py")
        self.assertTrue(deleted_planner["surfaces"]["deploy"])
        self.assertFalse(deleted_planner["surfaces"]["full"])
        caddy = selected("deploy/tx/Caddyfile")
        self.assertTrue(caddy["surfaces"]["deploy"])
        self.assertEqual(caddy["tofuRoots"], [])

        dashboard = selected("deploy/observability/grafana/dashboards/home.json")
        self.assertTrue(dashboard["surfaces"]["observability"])
        self.assertEqual(dashboard["tofuRoots"], ["grafana"])

        dockerfile = selected("docker/Dockerfile.frontend")
        self.assertTrue(dockerfile["surfaces"]["deploy"])
        self.assertEqual(dockerfile["tofuRoots"], [])

    def test_dependency_readiness_and_deployment_entrypoints_select_deploy_contracts(self):
        for path in (
            "deploy/dependency-readiness.py",
            "deploy/dependency-readiness.sh",
            "deploy/test_dependency_readiness.py",
            "deploy/deploy.sh",
            "deploy/tx/deploy.sh",
        ):
            with self.subTest(path=path):
                result = selected(path)
                self.assertTrue(result["surfaces"]["deploy"])
                self.assertEqual(result["tofuRoots"], [])

    def test_unknown_docker_and_tofu_inputs_fail_closed(self):
        for path, message in (
            ("docker/Dockerfile.unknown", "unknown production Dockerfile"),
            ("docker/new-production.yml", "unmapped production Docker input"),
            ("infra/tofu/unknown/main.tf", "unknown OpenTofu validation root"),
        ):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, message):
                selected(path)

    def test_invalid_revision_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "full lowercase commit SHA"):
            impact.validate_revisions("short", HEAD)

    def test_invalid_maven_module_pom_fails_closed(self):
        def malformed(_sha, path):
            if path == "java/wotb-core/pom.xml":
                return "<project>broken"
            file = ROOT / path
            return file.read_text(encoding="utf-8") if file.exists() else None

        with patch.object(impact, "blob", side_effect=malformed), self.assertRaisesRegex(
            ValueError, "invalid Maven POM",
        ):
            impact.reactor_modules(HEAD)


class GitRangeTest(unittest.TestCase):
    def test_deleted_and_renamed_paths_are_included(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            (repo / "java").mkdir()
            shutil.copyfile(ROOT / "java/pom.xml", repo / "java/pom.xml")
            for source in (ROOT / "java").glob("*/pom.xml"):
                destination = repo / "java" / source.parent.name / "pom.xml"
                destination.parent.mkdir()
                shutil.copyfile(source, destination)
            (repo / "docs").mkdir()
            (repo / "docs/old.md").write_text("old\n", encoding="utf-8")
            (repo / "common").mkdir()
            shutil.copyfile(ROOT / "common/map_names.json", repo / "common/map_names.json")
            shutil.copyfile(ROOT / "common/tank_tactical_profiles.json", repo / "common/tank_tactical_profiles.json")

            def command(*args):
                return subprocess.check_output(
                    ["git", *args], cwd=repo, text=True, stderr=subprocess.DEVNULL,
                ).strip()

            command("init", "-q")
            command("config", "user.email", "ci-impact@example.test")
            command("config", "user.name", "CI impact tests")
            command("add", "java", "docs", "common")
            command("commit", "-qm", "base")
            base = command("rev-parse", "HEAD")
            command("mv", "docs/old.md", "docs/new.md")
            command("mv", "common/map_names.json", "common/renamed-map-names.json")
            command("rm", "common/tank_tactical_profiles.json")
            java_source = repo / "java/wotb-core/src/main/java/Foo.java"
            java_source.parent.mkdir(parents=True, exist_ok=True)
            java_source.write_text("class Foo {}\n", encoding="utf-8")
            command("add", "java")
            command("commit", "-qm", "head")
            head = command("rev-parse", "HEAD")

            with patch.object(impact, "ROOT", repo):
                changed = impact.changed_paths(base, head)
                for path in (
                    "docs/old.md", "docs/new.md", "common/map_names.json",
                    "common/renamed-map-names.json", "common/tank_tactical_profiles.json",
                ):
                    self.assertIn(path, changed)
                result = impact.select(base, head)
                self.assertEqual(result["javaModules"], ["wotb-core"])
                self.assertTrue(result["surfaces"]["backend"])
                self.assertTrue(result["surfaces"]["data"])


if __name__ == "__main__":
    unittest.main()
