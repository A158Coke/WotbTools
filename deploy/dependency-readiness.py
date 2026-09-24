#!/usr/bin/env python3
"""Read-only, consumer-network checks for the production API and parser worker."""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import http.client
import json
import os
import socket
import struct
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


class ReadinessError(RuntimeError):
    pass


AMQP_FRAME_METHOD = 1
AMQP_FRAME_HEARTBEAT = 8
AMQP_FRAME_END = 0xCE
AMQP_HEADER = b"AMQP\x00\x00\x09\x01"


def required(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise ReadinessError(f"required readiness input is missing: {name}")
    return value


def u16(value: int) -> bytes:
    return struct.pack(">H", value)


def u32(value: int) -> bytes:
    return struct.pack(">I", value)


def shortstr(value: str) -> bytes:
    encoded = value.encode("utf-8")
    if len(encoded) > 255:
        raise ReadinessError("AMQP short string is too long")
    return bytes((len(encoded),)) + encoded


def longstr(value: bytes) -> bytes:
    return u32(len(value)) + value


def recv_exact(sock: socket.socket, size: int) -> bytes:
    output = bytearray()
    while len(output) < size:
        chunk = sock.recv(size - len(output))
        if not chunk:
            raise ReadinessError("AMQP peer closed the readiness connection")
        output.extend(chunk)
    return bytes(output)


def recv_frame(sock: socket.socket) -> tuple[int, int, bytes]:
    frame_type, channel, size = struct.unpack(">BHI", recv_exact(sock, 7))
    payload = recv_exact(sock, size)
    if recv_exact(sock, 1) != bytes((AMQP_FRAME_END,)):
        raise ReadinessError("AMQP peer sent an invalid frame terminator")
    return frame_type, channel, payload


def send_method(sock: socket.socket, channel: int, class_id: int, method_id: int, args: bytes = b"") -> None:
    payload = u16(class_id) + u16(method_id) + args
    sock.sendall(struct.pack(">BHI", AMQP_FRAME_METHOD, channel, len(payload)) + payload + bytes((AMQP_FRAME_END,)))


def recv_method(sock: socket.socket) -> tuple[int, int, int, bytes]:
    while True:
        frame_type, channel, payload = recv_frame(sock)
        if frame_type == AMQP_FRAME_HEARTBEAT:
            continue
        if frame_type != AMQP_FRAME_METHOD or len(payload) < 4:
            raise ReadinessError("AMQP peer sent an unexpected readiness frame")
        class_id, method_id = struct.unpack(">HH", payload[:4])
        return channel, class_id, method_id, payload[4:]


def expect_method(sock: socket.socket, channel: int, class_id: int, method_id: int) -> bytes:
    actual_channel, actual_class, actual_method, args = recv_method(sock)
    if (actual_channel, actual_class, actual_method) != (channel, class_id, method_id):
        raise ReadinessError("AMQP authentication, vhost, or queue readiness was rejected")
    return args


def check_amqp(host: str, port: int, vhost: str, username: str, password: str, queue: str) -> None:
    with socket.create_connection((host, port), timeout=8) as sock:
        sock.settimeout(12)
        sock.sendall(AMQP_HEADER)
        start = expect_method(sock, 0, 10, 10)
        if len(start) < 8:
            raise ReadinessError("RabbitMQ sent an invalid connection.start method")

        # Connection.Start-Ok: empty client properties, PLAIN SASL, and the
        # supplied consumer identity. Credentials stay in the probe process env.
        response = b"\x00" + username.encode("utf-8") + b"\x00" + password.encode("utf-8")
        start_ok = u32(0) + shortstr("PLAIN") + longstr(response) + shortstr("en_US")
        send_method(sock, 0, 10, 11, start_ok)

        tune = expect_method(sock, 0, 10, 30)
        if len(tune) != 8:
            raise ReadinessError("RabbitMQ sent an invalid connection.tune method")
        channel_max, frame_max, heartbeat = struct.unpack(">HIH", tune)
        send_method(sock, 0, 10, 31, u16(channel_max) + u32(frame_max) + u16(heartbeat))
        send_method(sock, 0, 10, 40, shortstr(vhost) + shortstr("") + b"\x00")
        expect_method(sock, 0, 10, 41)

        send_method(sock, 1, 20, 10, shortstr(""))
        expect_method(sock, 1, 20, 11)

        # Passive queue declaration is read-only. It proves the authenticated
        # identity can access its real queue without consuming or publishing a
        # message. Write permission is verified by the owning OpenTofu ACL.
        declare_args = u16(0) + shortstr(queue) + bytes((0x01,)) + u32(0)
        send_method(sock, 1, 50, 10, declare_args)
        expect_method(sock, 1, 50, 11)

        send_method(sock, 1, 20, 40, u16(200) + shortstr("readiness complete") + u16(0) + u16(0))
        expect_method(sock, 1, 20, 41)
        send_method(sock, 0, 10, 50, u16(200) + shortstr("readiness complete") + u16(0) + u16(0))
        expect_method(sock, 0, 10, 51)


def hmac_sha256(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def check_minio(endpoint: str, bucket: str, access_key: str, secret_key: str) -> None:
    parsed = urllib.parse.urlsplit("http://" + endpoint)
    if parsed.scheme != "http" or not parsed.hostname or parsed.path or parsed.query or parsed.fragment:
        raise ReadinessError("MinIO endpoint must be a host[:port] HTTP endpoint")
    host = parsed.netloc
    prefix = "temp/jobs/__codex_readiness__/"
    path = "/" + urllib.parse.quote(bucket, safe="-_.~")
    query_values = {"list-type": "2", "max-keys": "1", "prefix": prefix}
    query = "&".join(
        f"{urllib.parse.quote(key, safe='-_.~')}={urllib.parse.quote(value, safe='-_.~')}"
        for key, value in sorted(query_values.items())
    )
    request_path = f"{path}?{query}"

    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(b"").hexdigest()
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    canonical_request = "\n".join(("GET", path, query, canonical_headers, signed_headers, payload_hash))
    scope = f"{date_stamp}/us-east-1/s3/aws4_request"
    string_to_sign = "\n".join(
        ("AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest())
    )
    date_key = hmac_sha256(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    region_key = hmac.new(date_key, b"us-east-1", hashlib.sha256).digest()
    service_key = hmac.new(region_key, b"s3", hashlib.sha256).digest()
    signing_key = hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    connection = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=8)
    try:
        connection.request(
            "GET",
            request_path,
            headers={
                "Host": host,
                "x-amz-content-sha256": payload_hash,
                "x-amz-date": amz_date,
                "Authorization": authorization,
            },
        )
        response = connection.getresponse()
        body = response.read(65536)
    finally:
        connection.close()
    if response.status != 200:
        raise ReadinessError(f"MinIO authenticated prefix listing returned HTTP {response.status}")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as error:
        raise ReadinessError("MinIO prefix listing returned invalid XML") from error
    if root.tag.split("}")[-1] != "ListBucketResult":
        raise ReadinessError("MinIO prefix listing returned an unexpected response")
    response_bucket = root.findtext("{*}Name")
    response_prefix = root.findtext("{*}Prefix")
    if response_bucket != bucket or response_prefix != prefix:
        raise ReadinessError("MinIO did not confirm the expected temp/jobs prefix")


def check_keycloak() -> None:
    base = "http://keycloak:8080/realms/wotbtools"
    with urllib.request.urlopen(base + "/.well-known/openid-configuration", timeout=8) as response:
        if response.status != 200:
            raise ReadinessError("Keycloak realm discovery did not return HTTP 200")
        discovery = json.load(response)
    if discovery.get("issuer") != "https://auth.wotbtools.com/realms/wotbtools":
        raise ReadinessError("Keycloak discovery issuer does not match the production realm")

    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": "wotbtools-admin-api",
            "client_secret": required("KEYCLOAK_ADMIN_CLIENT_SECRET"),
        }
    ).encode("utf-8")
    request = urllib.request.Request(base + "/protocol/openid-connect/token", data=body, method="POST")
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status != 200:
            raise ReadinessError("Keycloak admin client authentication did not return HTTP 200")
        token = json.load(response).get("access_token")
    if not isinstance(token, str) or not token:
        raise ReadinessError("Keycloak did not issue an admin API client token")


def retry(label: str, check, attempts: int = 3) -> None:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            check()
            print(f"{label}: PASS", flush=True)
            return
        except Exception as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2)
    raise ReadinessError(f"{label}: FAIL ({type(last_error).__name__})")


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"business-api", "parser-worker"}:
        print("usage: dependency-readiness.py business-api|parser-worker", file=sys.stderr)
        return 2
    try:
        if argv[1] == "business-api":
            retry("keycloak-oidc-and-client", check_keycloak)
            retry(
                "rabbitmq-control-api-auth-vhost-result-queue",
                lambda: check_amqp(
                    os.environ.get("TX_RABBITMQ_HOST", "rabbitmq"),
                    int(os.environ.get("TX_RABBITMQ_PORT", "5672")),
                    os.environ.get("TX_RABBITMQ_VHOST", "/wotbtools"),
                    os.environ.get("TX_RABBITMQ_CONTROL_API_USER", "control-api"),
                    required("TX_RABBITMQ_CONTROL_API_PASSWORD"),
                    "wotb.parser.result",
                ),
            )
            retry(
                "minio-control-api-temp-jobs-list",
                lambda: check_minio(
                    os.environ.get("YECAO_MINIO_ENDPOINT", "10.20.0.2:9000"),
                    os.environ.get("YECAO_MINIO_BUCKET", "wotbtools-temp"),
                    required("YECAO_MINIO_CONTROL_API_ACCESS_KEY"),
                    required("YECAO_MINIO_CONTROL_API_SECRET_KEY"),
                ),
            )
        else:
            retry(
                "rabbitmq-parser-worker-auth-vhost-parser-queue",
                lambda: check_amqp(
                    os.environ.get("PARSER_WORKER_RABBITMQ_HOST", "10.20.0.1"),
                    int(os.environ.get("PARSER_WORKER_RABBITMQ_PORT", "5672")),
                    os.environ.get("PARSER_WORKER_RABBITMQ_VHOST", "/wotbtools"),
                    os.environ.get("PARSER_WORKER_RABBITMQ_USERNAME", "parser-worker"),
                    required("TX_RABBITMQ_PARSER_WORKER_PASSWORD"),
                    "wotb.parser",
                ),
            )
            retry(
                "minio-worker-temp-jobs-list",
                lambda: check_minio(
                    os.environ.get("PARSER_WORKER_MINIO_ENDPOINT", "minio:9000"),
                    os.environ.get("PARSER_WORKER_MINIO_BUCKET", "wotbtools-temp"),
                    required("YECAO_MINIO_WORKER_ACCESS_KEY"),
                    required("YECAO_MINIO_WORKER_SECRET_KEY"),
                ),
            )
    except Exception as error:
        print(f"dependency readiness failed: {type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
