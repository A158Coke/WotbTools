#!/usr/bin/env python3
"""Tests for the read-only production dependency probe.

The probe carries two secrets: the application PostgreSQL password and the
Keycloak admin client secret. Every fixture below therefore proves the logical
endpoint is validated *before* a credential can leave the host, not only that
the request eventually failed.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("dependency-readiness.py").resolve()
SCRIPT_PATH = Path(__file__).with_name("dependency-readiness.sh").resolve()
loader = importlib.machinery.SourceFileLoader("dependency_readiness", str(MODULE_PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
readiness = importlib.util.module_from_spec(spec)
loader.exec_module(readiness)

BASH = shutil.which("bash")


def usable_bash() -> str | None:
    """The bash that can actually run the entrypoint fixture on this host.

    Native Windows Python resolves `bash` to the WSL launcher, which cannot read
    a `D:\\...` script path; Git Bash and every POSIX shell can. CI is POSIX, so
    the fixture below always runs there.
    """
    if not BASH:
        return None
    probe = subprocess.run([BASH, "-c", 'test -f "$1"', "bash", str(SCRIPT_PATH)],
                           capture_output=True, check=False)
    return BASH if probe.returncode == 0 else None


USABLE_BASH = usable_bash()
DOCKER_STUB = """#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\\n' "$*" >> "${STUB_DOCKER_LOG:?}"
if [ "${1:-}" = run ]; then
  printf '1\\n'
fi
exit 0
"""


class FakeResponse(io.BytesIO):
    def __init__(self, payload: dict, status: int = 200) -> None:
        super().__init__(json.dumps(payload).encode("utf-8"))
        self.status = status

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class ModeTests(unittest.TestCase):
    def test_only_business_api_mode_is_supported(self) -> None:
        for argv in (["probe"], ["probe", "parser-worker"], ["probe", "business-api", "extra"]):
            with redirect_stderr(io.StringIO()):
                self.assertEqual(readiness.main(argv), 2)


class KeycloakProbeTests(unittest.TestCase):
    def test_checks_discovery_issuer_and_client_token(self) -> None:
        responses = [
            FakeResponse({"issuer": "https://auth.wotbtools.com/realms/wotbtools"}),
            FakeResponse({"access_token": "token"}),
        ]
        with mock.patch.dict(
                "os.environ",
                {
                    "KEYCLOAK_ADMIN_CLIENT_SECRET": "probe-secret",
                    "TX_KEYCLOAK_ADMIN_SERVER_URL": "http://10.20.0.1:8080",
                },
        ), mock.patch.object(readiness.urllib.request, "urlopen", side_effect=responses) as urlopen:
            readiness.check_keycloak()
        self.assertEqual(urlopen.call_count, 2)
        self.assertTrue(urlopen.call_args_list[0].args[0].startswith(
            "http://10.20.0.1:8080/realms/wotbtools/"
        ))

    def test_never_invents_an_endpoint_without_validation(self) -> None:
        # dependency-readiness.sh always hands over a validated value. If it is
        # absent, no validation ran, so the probe must not pick a default and
        # must not send the admin client secret anywhere.
        with mock.patch.dict("os.environ", {}, clear=True), \
                mock.patch.object(readiness.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(readiness.ReadinessError):
                readiness.check_keycloak()
        urlopen.assert_not_called()

    def test_fails_closed_on_wrong_issuer(self) -> None:
        with mock.patch.dict(
                "os.environ",
                {
                    "KEYCLOAK_ADMIN_CLIENT_SECRET": "probe-secret",
                    "TX_KEYCLOAK_ADMIN_SERVER_URL": "http://keycloak:8080",
                },
        ), mock.patch.object(readiness.urllib.request, "urlopen",
                             return_value=FakeResponse({"issuer": "https://evil.example/realms/x"})):
            with self.assertRaises(readiness.ReadinessError):
                readiness.check_keycloak()


@unittest.skipUnless(USABLE_BASH, "a POSIX bash is required to exercise the readiness entrypoint")
class EndpointValidationOrderTests(unittest.TestCase):
    """The entrypoint must reject an endpoint before it starts any container.

    `docker` is stubbed, so "before" is observable: the log the stub writes is
    the proof that a password-bearing psql run or a client-secret-bearing probe
    container was (or was not) started.
    """

    def setUp(self) -> None:
        self.work = Path(tempfile.mkdtemp(prefix="dependency-readiness-"))
        self.addCleanup(shutil.rmtree, self.work, ignore_errors=True)
        self.bin = self.work / "bin"
        self.bin.mkdir()
        stub = self.bin / "docker"
        stub.write_text(DOCKER_STUB, encoding="utf-8")
        stub.chmod(0o700)
        self.log = self.work / "docker.log"

    def run_probe(self, mode: str, **overrides: str) -> subprocess.CompletedProcess:
        environment = {
            "PATH": f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}",
            "HOME": str(self.work),
            "STUB_DOCKER_LOG": str(self.log),
            "TX_BUSINESS_DB_NAME": "wotb",
            "TX_BUSINESS_DB_USERNAME": "control_api",
            "TX_BUSINESS_DB_PASSWORD": "not-real",
            "KEYCLOAK_ADMIN_CLIENT_SECRET": "not-real",
        }
        environment.update(overrides)
        return subprocess.run(
            [USABLE_BASH, str(SCRIPT_PATH), mode],
            cwd=self.work, env=environment, text=True, capture_output=True, check=False,
        )

    def assert_refused_before_any_container(self, result: subprocess.CompletedProcess, expected: str) -> None:
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(expected, result.stderr)
        self.assertFalse(self.log.exists(), "a rejected endpoint must fail before any docker invocation")

    def test_docker_local_defaults_are_probed(self) -> None:
        result = self.run_probe("business-api")
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text(encoding="utf-8")
        self.assertIn("--host business-postgres --port 5432", log)
        self.assertIn("--env TX_KEYCLOAK_ADMIN_SERVER_URL", log)
        self.assertIn("logical-endpoints: PASS (business-api)", result.stdout)

    def test_reviewed_tx1_and_tx2_values_are_probed(self) -> None:
        for host, business_port, keycloak_port in (("10.20.0.1", "25432", "8080"), ("10.20.0.3", "25432", "8080")):
            with self.subTest(host=host):
                self.log.unlink(missing_ok=True)
                result = self.run_probe(
                    "business-api",
                    TX_BUSINESS_DB_HOST=host,
                    TX_BUSINESS_DB_PORT=business_port,
                    TX_KEYCLOAK_ADMIN_SERVER_URL=f"http://{host}:{keycloak_port}",
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                log = self.log.read_text(encoding="utf-8")
                self.assertIn(f"--host {host} --port {business_port}", log)

    def test_reviewed_tx_keycloak_database_values_are_accepted(self) -> None:
        for host, port in (("keycloak-postgres", "5432"), ("10.20.0.1", "15432"), ("10.20.0.3", "15432")):
            with self.subTest(host=host, port=port):
                self.log.unlink(missing_ok=True)
                result = self.run_probe("keycloak", TX_KEYCLOAK_DB_HOST=host, TX_KEYCLOAK_DB_PORT=port)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f"--host {host} --port {port}", self.log.read_text(encoding="utf-8"))

    def test_public_database_endpoint_never_receives_the_password(self) -> None:
        for host, port in (("db.example.com", "5432"), ("10.20.0.2", "25432"), ("203.0.113.9", "25432")):
            with self.subTest(host=host):
                self.assert_refused_before_any_container(
                    self.run_probe("business-api", TX_BUSINESS_DB_HOST=host, TX_BUSINESS_DB_PORT=port),
                    "TX_BUSINESS_DB must be business-postgres:5432",
                )

    def test_public_keycloak_admin_endpoint_never_receives_the_client_secret(self) -> None:
        for url in ("https://auth.wotbtools.com", "http://keycloak.example.com:8080", "http://10.20.0.2:8080"):
            with self.subTest(url=url):
                self.assert_refused_before_any_container(
                    self.run_probe("business-api", TX_KEYCLOAK_ADMIN_SERVER_URL=url),
                    "TX_KEYCLOAK_ADMIN_SERVER_URL must be http://keycloak:8080",
                )

    def test_wrong_wireguard_ports_are_refused(self) -> None:
        self.assert_refused_before_any_container(
            self.run_probe("business-api", TX_BUSINESS_DB_HOST="10.20.0.1", TX_BUSINESS_DB_PORT="5432"),
            "TX_BUSINESS_DB must be business-postgres:5432",
        )
        self.assert_refused_before_any_container(
            self.run_probe("business-api", TX_KEYCLOAK_ADMIN_SERVER_URL="http://10.20.0.1:9999"),
            "TX_KEYCLOAK_ADMIN_SERVER_URL must be http://keycloak:8080",
        )
        self.assert_refused_before_any_container(
            self.run_probe("keycloak", TX_KEYCLOAK_DB_HOST="10.20.0.1", TX_KEYCLOAK_DB_PORT="5432"),
            "TX_KEYCLOAK_DB must be keycloak-postgres:5432",
        )
        self.assert_refused_before_any_container(
            self.run_probe("keycloak", TX_KEYCLOAK_DB_HOST="10.20.0.2", TX_KEYCLOAK_DB_PORT="15432"),
            "TX_KEYCLOAK_DB must be keycloak-postgres:5432",
        )


if __name__ == "__main__":
    unittest.main()
