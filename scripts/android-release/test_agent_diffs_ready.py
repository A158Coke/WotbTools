#!/usr/bin/env python3
"""Regression tests for check_agent_diffs_ready.py (local HTTP fixtures, no network)."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_agent_diffs_ready.py")
PAIR_PATH = "11.21.0__11.22.0/release-pair"
FROM_RELEASE = "11.21.0-20261125-ui1"
TO_RELEASE = "11.22.0-20261126-mechanics1"


def index_doc(frm: dict, to: dict) -> dict:
    return {
        "schema": 1,
        "pairs": [{
            "id": "11.21.0__11.22.0",
            "path": PAIR_PATH,
            "from": frm,
            "to": to,
            "counts": {},
        }],
    }


class FixtureHandler(BaseHTTPRequestHandler):
    routes: dict[str, tuple[int, dict]] = {}

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        status, payload = self.routes.get(self.path, (404, {}))
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


class AgentDiffsReadyTest(unittest.TestCase):
    def serve(self, routes: dict[str, tuple[int, dict]]) -> str:
        handler = type("Fixture", (FixtureHandler,), {"routes": routes})
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop() -> None:
            server.shutdown()
            server.server_close()

        self.addCleanup(stop)
        return f"http://127.0.0.1:{server.server_port}"

    def check(self, routes: dict[str, tuple[int, dict]], version: str = "5.8.0") -> subprocess.CompletedProcess:
        origin = self.serve(routes)
        return subprocess.run(
            [sys.executable, str(SCRIPT), origin, version],
            capture_output=True,
            text=True,
            check=False,
        )

    def routes(
        self,
        frm: dict | None = None,
        to: dict | None = None,
        from_release: str = FROM_RELEASE,
        to_release: str = TO_RELEASE,
    ) -> dict[str, tuple[int, dict]]:
        return {
            "/diffs/index.json": (200, index_doc(
                frm if frm is not None else {"dataset": "11.21.0", "release": FROM_RELEASE},
                to if to is not None else {"dataset": "11.22.0", "release": TO_RELEASE},
            )),
            f"/diffs/{PAIR_PATH}/summary.json": (200, {"schema": 1}),
            "/v/11.21.0/version.json": (200, {"release": from_release}),
            "/v/11.22.0/version.json": (200, {"release": to_release}),
        }

    def test_valid_channel_passes(self) -> None:
        result = self.check(self.routes())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("channel readiness: OK", result.stdout)

    def test_missing_release_field_fails(self) -> None:
        result = self.check(self.routes(frm={"dataset": "11.21.0"}))
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing a non-empty from release", result.stderr)

    def test_empty_release_fails(self) -> None:
        result = self.check(self.routes(frm={"dataset": "11.21.0", "release": ""}))
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing a non-empty from release", result.stderr)

    def test_wrong_release_type_fails(self) -> None:
        result = self.check(self.routes(frm={"dataset": "11.21.0", "release": 123}))
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing a non-empty from release", result.stderr)

    def test_mismatched_release_fails(self) -> None:
        result = self.check(self.routes(from_release="11.21.0-20261124-older"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("stale diff", result.stderr)

    def test_missing_index_fails(self) -> None:
        routes = self.routes()
        routes.pop("/diffs/index.json")
        result = self.check(routes)
        self.assertEqual(result.returncode, 1)
        self.assertIn("HTTP 404", result.stderr)

    def test_pre_5_8_version_skips_without_network(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "http://127.0.0.1:9", "5.7.5"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("predates the version-diff page", result.stdout)


if __name__ == "__main__":
    unittest.main()