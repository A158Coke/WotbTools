#!/usr/bin/env python3
"""Tests for the read-only production dependency probe."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import io
import json
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("dependency-readiness.py")
loader = importlib.machinery.SourceFileLoader("dependency_readiness", str(MODULE_PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
readiness = importlib.util.module_from_spec(spec)
loader.exec_module(readiness)


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

    def test_fails_closed_on_wrong_issuer(self) -> None:
        with mock.patch.dict("os.environ", {"KEYCLOAK_ADMIN_CLIENT_SECRET": "probe-secret"}), \
                mock.patch.object(readiness.urllib.request, "urlopen",
                                  return_value=FakeResponse({"issuer": "https://evil.example/realms/x"})):
            with self.assertRaises(readiness.ReadinessError):
                readiness.check_keycloak()


if __name__ == "__main__":
    unittest.main()
