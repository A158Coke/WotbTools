#!/usr/bin/env python3
"""Protocol-level tests for the read-only production dependency probe."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import socket
import struct
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("dependency-readiness.py")
loader = importlib.machinery.SourceFileLoader("dependency_readiness", str(MODULE_PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
readiness = importlib.util.module_from_spec(spec)
loader.exec_module(readiness)


def shortstr(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return bytes((len(encoded),)) + encoded


def frame(channel: int, payload: bytes) -> bytes:
    return struct.pack(">BHI", readiness.AMQP_FRAME_METHOD, channel, len(payload)) + payload + bytes((readiness.AMQP_FRAME_END,))


def method(class_id: int, method_id: int, args: bytes = b"") -> bytes:
    return struct.pack(">HH", class_id, method_id) + args


def read_client_method(connection: socket.socket) -> tuple[int, int, int, bytes]:
    header = b""
    while len(header) < 7:
        header += connection.recv(7 - len(header))
    frame_type, channel, size = struct.unpack(">BHI", header)
    payload = b""
    while len(payload) < size:
        payload += connection.recv(size - len(payload))
    end = connection.recv(1)
    if frame_type != readiness.AMQP_FRAME_METHOD or end != bytes((readiness.AMQP_FRAME_END,)):
        raise AssertionError("client sent a malformed AMQP method frame")
    class_id, method_id = struct.unpack(">HH", payload[:4])
    return channel, class_id, method_id, payload[4:]


class AmqpProbeTests(unittest.TestCase):
    def run_broker(self, reject_auth: bool = False) -> tuple[str, int, threading.Thread, list[Exception]]:
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        host, port = listener.getsockname()
        errors: list[Exception] = []

        def serve() -> None:
            try:
                connection, _ = listener.accept()
                with connection:
                    connection.settimeout(3)
                    self.assertEqual(connection.recv(len(readiness.AMQP_HEADER)), readiness.AMQP_HEADER)
                    start_args = bytes((0, 9)) + struct.pack(">I", 0) + shortstr("PLAIN") + shortstr("en_US")
                    connection.sendall(frame(0, method(10, 10, start_args)))
                    channel, class_id, method_id, args = read_client_method(connection)
                    self.assertEqual((channel, class_id, method_id), (0, 10, 11))
                    self.assertIn(b"\x00probe-user\x00probe-password", args)
                    if reject_auth:
                        connection.sendall(
                            frame(0, method(10, 50, struct.pack(">H", 403) + shortstr("access refused") + struct.pack(">HH", 0, 0)))
                        )
                        return
                    connection.sendall(frame(0, method(10, 30, struct.pack(">HIH", 0, 131072, 0))))
                    channel, class_id, method_id, _ = read_client_method(connection)
                    self.assertEqual((channel, class_id, method_id), (0, 10, 31))
                    channel, class_id, method_id, args = read_client_method(connection)
                    self.assertEqual((channel, class_id, method_id), (0, 10, 40))
                    self.assertTrue(args.startswith(shortstr("/wotbtools")))
                    connection.sendall(frame(0, method(10, 41, shortstr("probe"))))
                    channel, class_id, method_id, _ = read_client_method(connection)
                    self.assertEqual((channel, class_id, method_id), (1, 20, 10))
                    connection.sendall(frame(1, method(20, 11, shortstr(""))))
                    channel, class_id, method_id, args = read_client_method(connection)
                    self.assertEqual((channel, class_id, method_id), (1, 50, 10))
                    self.assertEqual(args[2:2 + len(shortstr("wotb.parser"))], shortstr("wotb.parser"))
                    self.assertEqual(args[2 + len(shortstr("wotb.parser"))], 0x01)
                    self.assertEqual(struct.unpack(">I", args[-4:])[0], 0)
                    connection.sendall(frame(1, method(50, 11, shortstr("wotb.parser") + struct.pack(">II", 0, 0))))
                    channel, class_id, method_id, _ = read_client_method(connection)
                    self.assertEqual((channel, class_id, method_id), (1, 20, 40))
                    connection.sendall(frame(1, method(20, 41)))
                    channel, class_id, method_id, _ = read_client_method(connection)
                    self.assertEqual((channel, class_id, method_id), (0, 10, 50))
                    connection.sendall(frame(0, method(10, 51)))
            except Exception as error:  # surfaced in the test thread
                errors.append(error)
            finally:
                listener.close()

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        return host, port, thread, errors

    def test_authenticates_opens_vhost_and_passively_checks_queue(self) -> None:
        host, port, thread, errors = self.run_broker()
        readiness.check_amqp(host, port, "/wotbtools", "probe-user", "probe-password", "wotb.parser")
        thread.join(timeout=3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])

    def test_fails_closed_when_broker_rejects_authentication(self) -> None:
        host, port, thread, errors = self.run_broker(reject_auth=True)
        with self.assertRaises(readiness.ReadinessError):
            readiness.check_amqp(host, port, "/wotbtools", "probe-user", "probe-password", "wotb.parser")
        thread.join(timeout=3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])


class MinioProbeTests(unittest.TestCase):
    def test_signs_only_read_only_prefix_listing(self) -> None:
        seen: dict[str, str] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - http.server API
                seen["path"] = self.path
                seen["authorization"] = self.headers.get("Authorization", "")
                seen["key"] = self.headers.get("x-amz-content-sha256", "")
                body = b"<ListBucketResult><Name>wotbtools-temp</Name><Prefix>temp/jobs/__codex_readiness__/</Prefix></ListBucketResult>"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            readiness.check_minio(
                f"127.0.0.1:{server.server_port}",
                "wotbtools-temp",
                "probe-access-key",
                "probe-secret-key",
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
        self.assertIn("prefix=temp%2Fjobs%2F__codex_readiness__%2F", seen["path"])
        self.assertIn("max-keys=1", seen["path"])
        self.assertTrue(seen["authorization"].startswith("AWS4-HMAC-SHA256 Credential=probe-access-key/"))
        self.assertNotIn("probe-secret-key", seen["authorization"])
        self.assertEqual(seen["key"], readiness.hashlib.sha256(b"").hexdigest())


if __name__ == "__main__":
    unittest.main()
