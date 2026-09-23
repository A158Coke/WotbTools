"""Behavior tests for the Git-range release planner."""

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("release_plan", ROOT / "deploy/release_plan.py")
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)
BASE = "a" * 40
HEAD = "b" * 40


def selected(*paths, compose_change=None):
    def read(sha, path):
        file = ROOT / path
        text = file.read_text(encoding="utf-8") if file.exists() else None
        if compose_change and path == compose_change[0] and sha == HEAD:
            return text.replace(compose_change[1], compose_change[2])
        return text

    with patch.object(planner, "validate_revisions"), patch.object(planner, "changed_paths", return_value=list(paths)), patch.object(planner, "blob", side_effect=read):
        return planner.plan(BASE, HEAD)


class PlannerSelectionTest(unittest.TestCase):
    def test_noop_and_workflow_only(self):
        self.assertEqual(selected("docs/README.md")["release"], {"buildComponents": [], "deployServices": [], "tofuRoots": []})
        workflow = selected(".github/workflows/ci.yml")
        self.assertTrue(workflow["validation"]["surfaces"]["full"])
        self.assertEqual(workflow["release"]["buildComponents"], [])

    def test_real_reactor_graph(self):
        modules, graph = planner.pom_graph(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip())
        self.assertIn("wotb-web", modules)
        self.assertIn("wotb-contracts", planner.walk_closure("wotb-web", graph))
        self.assertIn("wotb-contracts", planner.walk_closure("wotb-parser-worker", graph))
        self.assertNotIn("wotb-ai", planner.walk_closure("wotb-parser-worker", graph))

    def test_java_module_closure_and_tests(self):
        shared = selected("java/wotb-contracts/src/main/java/Foo.java")
        self.assertEqual(shared["release"]["buildComponents"], ["business-api", "parser-worker"])
        self.assertEqual(shared["validation"]["javaModules"], ["wotb-contracts"])
        web = selected("java/wotb-web/pom.xml")
        self.assertEqual(web["release"]["buildComponents"], ["business-api"])
        self.assertFalse(web["validation"]["javaFull"])
        self.assertEqual(web["validation"]["javaModules"], ["wotb-web"])
        worker = selected("java/wotb-parser-worker/src/main/java/Foo.java")
        self.assertEqual(worker["release"]["buildComponents"], ["parser-worker"])
        self.assertEqual(selected("java/wotb-web/src/test/java/FooTest.java")["release"]["buildComponents"], [])

    def test_parent_and_docker_settings(self):
        parent = selected("java/pom.xml")
        self.assertTrue(parent["validation"]["javaFull"])
        self.assertEqual(parent["release"]["buildComponents"], ["business-api", "parser-worker"])
        settings = selected("java/settings-docker.xml")
        self.assertEqual(settings["release"]["buildComponents"], ["business-api", "keycloak", "parser-worker"])
        self.assertEqual(selected("java/settings.xml")["release"]["buildComponents"], [])

    def test_frontend_data_and_browser(self):
        front = selected("frontend/src/components/ReplayPage.vue")
        self.assertEqual(front["release"]["buildComponents"], ["frontend"])
        self.assertEqual(front["validation"]["frontendBrowserSuites"], ["playback-layout", "workspace-interaction"])
        self.assertEqual(selected("frontend/src/components/ReplayPage.test.js")["release"]["buildComponents"], [])
        for path in ("HISTORY.md", "docs/architecture/TECHNICAL_EVOLUTION.md", "docs/WotBTools_League_Rating_V6.md", "common/map_names.json"):
            self.assertIn("frontend", selected(path)["release"]["buildComponents"], path)
        self.assertEqual(selected("common/unrelated-fixture.json")["release"]["buildComponents"], [])

    def test_embedded_markdown_documents_are_frontend_build_inputs(self):
        # docker/Dockerfile.frontend COPYs them and the SPA inlines them with `?raw`,
        # so editing one republishes wotb-frontend instead of being a docs-only no-op.
        for document in ("HISTORY.md", "docs/architecture/TECHNICAL_EVOLUTION.md"):
            plan = selected(document)
            self.assertEqual(plan["release"]["buildComponents"], ["frontend"], document)
            self.assertEqual(plan["release"]["deployServices"], ["frontend"], document)
            self.assertTrue(plan["validation"]["surfaces"]["frontend"], document)
            self.assertFalse(plan["validation"]["surfaces"]["full"], document)
        # Any other document stays an inert docs-only change.
        self.assertEqual(selected("docs/architecture/opentofu-production-baseline.md")["release"]["buildComponents"], [])
    def test_global_frontend_plumbing_runs_both_browser_suites(self):
        # Mounting, routing and global shell sizing can break the playback layout and the
        # workspace interaction flows at once, so both suites run for these paths.
        for path in (
            "frontend/index.html",
            "frontend/src/main.js",
            "frontend/src/App.vue",
            "frontend/src/app/router.js",
            "frontend/src/app/AppShell.vue",
            "frontend/src/app/ViewHost.vue",
            "frontend/src/app/navigation.js",
            "frontend/src/styles/app-shell.css",
            "frontend/src/styles/tokens.css",
        ):
            result = selected(path)
            self.assertEqual(result["validation"]["frontendBrowserSuites"], ["playback-layout", "workspace-interaction"], path)
            self.assertIn("frontend", result["release"]["buildComponents"], path)

    def test_playback_surface_runs_the_playback_suite(self):
        for path in ("frontend/src/components/BattlePlayback.vue", "frontend/src/styles/playback-pc.css"):
            self.assertIn("playback-layout", selected(path)["validation"]["frontendBrowserSuites"], path)

    def test_unrelated_frontend_component_skips_browser_suites(self):
        for path in ("frontend/src/components/AdminUsersPage.vue", "frontend/src/components/AiReviewPanel.vue"):
            result = selected(path)
            self.assertEqual(result["validation"]["frontendBrowserSuites"], [], path)
            self.assertEqual(result["release"]["buildComponents"], ["frontend"], path)

    def test_contract_sources_validate_without_uncopied_image_inputs(self):
        http = selected("contracts/http/openapi.yaml")
        self.assertTrue(http["validation"]["surfaces"]["httpContract"])
        self.assertEqual(http["release"]["buildComponents"], [])
        mq = selected("contracts/mq/parser-messages.json")
        self.assertEqual(mq["validation"]["javaModules"], ["wotb-broker-rabbitmq", "wotb-parser-worker"])
        self.assertEqual(mq["release"]["buildComponents"], [])

    def test_docker_and_provider_packaging(self):
        for suffix, name in (("business-api", "business-api"), ("frontend", "frontend"), ("keycloak", "keycloak"), ("parser-worker", "parser-worker"), ("minio", "minio")):
            result = selected(f"docker/Dockerfile.{suffix}")
            self.assertEqual(result["release"]["buildComponents"], [name])
            self.assertEqual(result["validation"]["packagingComponents"], [name])
        all_images = selected(".dockerignore")
        self.assertEqual(all_images["release"]["buildComponents"], list(planner.COMPONENTS))
        self.assertEqual(all_images["validation"]["packagingComponents"], list(planner.COMPONENTS))
        provider = selected("keycloak-qq-provider/src/main/java/Provider.java")
        self.assertEqual(provider["validation"]["packagingComponents"], ["keycloak"])
        self.assertEqual(selected("keycloak-qq-provider/src/test/java/ProviderTest.java")["release"]["buildComponents"], [])

    def test_config_only(self):
        self.assertEqual(selected("deploy/tx/Caddyfile")["release"]["deployServices"], ["caddy"])
        self.assertEqual(selected("deploy/tx/nginx/frontend.conf.template")["release"]["deployServices"], ["frontend"])
        self.assertEqual(selected("deploy/observability/loki/loki-config.yml")["release"]["deployServices"], ["loki"])
        self.assertEqual(selected("deploy/observability/grafana/dashboards/home.json")["release"]["tofuRoots"], ["grafana"])
        self.assertEqual(selected("deploy/tx/runtime-check.sh")["release"]["deployServices"], [])

    def test_all_seven_tofu_roots_are_isolated(self):
        for root, prefix in planner.TOFU_ROOTS.items():
            result = selected(prefix + "variables.tf")
            self.assertEqual(result["validation"]["tofuRoots"], [root])
            self.assertEqual(result["release"]["tofuRoots"], [root])
            self.assertEqual(result["release"]["deployServices"], [])

    def test_compose_only_selects_changed_service_and_shared_config_fans_out(self):
        path = "deploy/tx/docker-compose.yml"
        result = selected(path, compose_change=(path, "rabbitmq:4.3.6-management-alpine", "rabbitmq:4.3.7-management-alpine"))
        self.assertEqual(result["release"]["deployServices"], ["rabbitmq"])
        result = selected(path, compose_change=(path, "x-logging:", "x-logging-changed:"))
        self.assertEqual(set(result["release"]["deployServices"]), set(planner.TX_SERVICES))
        self.assertIn(path, result["reasons"])
        probe = selected(path, compose_change=(path, "curlimages/curl:8.12.1", "curlimages/curl:8.12.2"))
        self.assertEqual(set(probe["release"]["deployServices"]), set(planner.TX_SERVICES))
        self.assertIn("probe", probe["reasons"][path])

    def test_invalid_inputs_fail_closed(self):
        for path in ("java/unknown/src/main/java/Foo.java", "docker/Dockerfile.unknown", "infra/tofu/unknown/main.tf", "deploy/tx/new-production.yml"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                selected(path)
        with self.assertRaises(ValueError):
            planner.validate_revisions("short", HEAD)

    def test_invalid_pom_fails_closed(self):
        def malformed(_sha, path):
            if path == "java/wotb-core/pom.xml":
                return "<project>broken"
            file = ROOT / path
            return file.read_text(encoding="utf-8") if file.exists() else None

        with patch.object(planner, "blob", side_effect=malformed), self.assertRaisesRegex(ValueError, "invalid Maven POM"):
            planner.pom_graph(HEAD)


class GitRangeTest(unittest.TestCase):
    def test_deleted_and_renamed_paths_and_real_sha_validation(self):
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
                return subprocess.check_output(["git", *args], cwd=repo, text=True, stderr=subprocess.DEVNULL).strip()

            command("init", "-q")
            command("config", "user.email", "planner@example.test")
            command("config", "user.name", "Planner Test")
            command("add", "java", "docs", "common")
            command("commit", "-qm", "base")
            base = command("rev-parse", "HEAD")
            command("mv", "docs/old.md", "docs/new.md")
            command("mv", "common/map_names.json", "common/renamed-map-names.json")
            command("rm", "common/tank_tactical_profiles.json")
            (repo / "java/wotb-core/src/main/java/Foo.java").parent.mkdir(parents=True, exist_ok=True)
            (repo / "java/wotb-core/src/main/java/Foo.java").write_text("class Foo {}\n", encoding="utf-8")
            command("add", "java")
            command("commit", "-qm", "head")
            head = command("rev-parse", "HEAD")
            with patch.object(planner, "ROOT", repo):
                changed = planner.changed_paths(base, head)
                self.assertIn("docs/old.md", changed)
                self.assertIn("docs/new.md", changed)
                self.assertIn("common/map_names.json", changed)
                self.assertIn("common/renamed-map-names.json", changed)
                self.assertIn("common/tank_tactical_profiles.json", changed)
                result = planner.plan(base, head)
                self.assertEqual(result["release"]["buildComponents"], ["business-api", "frontend", "parser-worker"])
                with self.assertRaises(ValueError):
                    planner.plan("0" * 40, head)


if __name__ == "__main__":
    unittest.main()
