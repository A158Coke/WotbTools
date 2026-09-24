#!/usr/bin/env python3
"""Read-only, consumer-identity readiness checks for the Yecao parser worker."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import http.client
import json
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any


AMQP_FRAME_END = 0xCE
AMQP_PROTOCOL_HEADER = b"AMQP\x00\x00\x09\x01"
TEMP_JOB_PREFIX = "temp/jobs/"
MINIO_COMPOSE_PROJECT = "wotb-yecao-minio"


class ReadinessError(Exception):
    """A safe-to-display readiness failure with no credential material."""


@dataclass(frozen=True)
class WorkerSettings:
    rabbit_host: str
    rabbit_port: int
    rabbit_vhost: str
    rabbit_username: str
    rabbit_password: str
    minio_endpoint: urllib.parse.SplitResult
    minio_bucket: str
    minio_access_key: str
    minio_secret_key: str
    minio_addresses: tuple[str, ...]


def _required(environment: dict[str, Any], name: str) -> str:
    value = environment.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ReadinessError(f"effective parser-worker setting {name} is empty")
    return value


def _split_minio_endpoint(value: str) -> urllib.parse.SplitResult:
    candidate = value if "://" in value else f"http://{value}"
    parsed = urllib.parse.urlsplit(candidate)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment):
        raise ReadinessError("effective parser-worker MinIO endpoint is invalid")
    try:
        parsed.port
    except ValueError as exc:
        raise ReadinessError("effective parser-worker MinIO endpoint has an invalid port") from exc
    return parsed


def _docker_json(*args: str, timeout: float = 15.0) -> Any:
    try:
        result = subprocess.run(
            ["docker", *args], check=False, capture_output=True, text=True, timeout=timeout
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ReadinessError("Docker topology lookup failed") from exc
    if result.returncode != 0:
        raise ReadinessError("Docker topology lookup failed")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ReadinessError("Docker returned invalid topology data") from exc


def _minio_service_addresses(worker_service: dict[str, Any], compose: dict[str, Any]) -> tuple[str, ...]:
    networks = compose.get("networks", {})
    declared = worker_service.get("networks", {})
    if isinstance(declared, list):
        network_names = {str(name) for name in declared}
    elif isinstance(declared, dict):
        network_names = set(declared)
    else:
        network_names = set()
    actual_networks: set[str] = set()
    for key in network_names:
        definition = networks.get(key, {}) if isinstance(networks, dict) else {}
        actual_networks.add(str(definition.get("name", key)) if isinstance(definition, dict) else key)
    if not actual_networks:
        raise ReadinessError("effective parser-worker Docker network is missing")

    try:
        ids_result = subprocess.run(
            ["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={MINIO_COMPOSE_PROJECT}",
             "--filter", "label=com.docker.compose.service=minio"],
            check=False, capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ReadinessError("MinIO container lookup failed") from exc
    if ids_result.returncode != 0:
        raise ReadinessError("MinIO container lookup failed")
    container_ids = [line.strip() for line in ids_result.stdout.splitlines() if line.strip()]
    if not container_ids:
        raise ReadinessError("the parser-worker MinIO service alias is unavailable")
    inspected = _docker_json("inspect", *container_ids)
    addresses: list[str] = []
    for container in inspected if isinstance(inspected, list) else []:
        if not isinstance(container, dict):
            continue
        state = container.get("State", {})
        if not isinstance(state, dict) or not state.get("Running"):
            continue
        container_networks = container.get("NetworkSettings", {}).get("Networks", {})
        if not isinstance(container_networks, dict):
            continue
        for network_name in actual_networks.intersection(container_networks):
            network = container_networks[network_name]
            if not isinstance(network, dict) or "minio" not in network.get("Aliases", []):
                continue
            address = network.get("IPAddress")
            if isinstance(address, str) and address:
                addresses.append(address)
    if not addresses:
        raise ReadinessError("the parser-worker MinIO service alias is not attached to its network")
    return tuple(dict.fromkeys(addresses))


def load_worker_settings(compose_json: str) -> WorkerSettings:
    try:
        compose = json.loads(compose_json)
    except json.JSONDecodeError as exc:
        raise ReadinessError("effective Compose settings are invalid") from exc
    services = compose.get("services", {}) if isinstance(compose, dict) else {}
    worker = services.get("parser-worker", {}) if isinstance(services, dict) else {}
    environment = worker.get("environment", {}) if isinstance(worker, dict) else {}
    if not isinstance(environment, dict):
        raise ReadinessError("effective parser-worker environment is invalid")

    rabbit_port_raw = _required(environment, "RABBITMQ_PORT")
    if not re.fullmatch(r"[0-9]{1,5}", rabbit_port_raw) or not 1 <= int(rabbit_port_raw) <= 65535:
        raise ReadinessError("effective parser-worker RabbitMQ port is invalid")
    minio_endpoint = _split_minio_endpoint(_required(environment, "MINIO_ENDPOINT"))
    minio_addresses: tuple[str, ...] = ()
    if minio_endpoint.hostname == "minio":
        if minio_endpoint.scheme != "http":
            raise ReadinessError("internal MinIO service readiness requires HTTP")
        minio_addresses = _minio_service_addresses(worker, compose)

    return WorkerSettings(
        rabbit_host=_required(environment, "RABBITMQ_HOST"),
        rabbit_port=int(rabbit_port_raw),
        rabbit_vhost=_required(environment, "RABBITMQ_VHOST"),
        rabbit_username=_required(environment, "RABBITMQ_USERNAME"),
        rabbit_password=_required(environment, "RABBITMQ_PASSWORD"),
        minio_endpoint=minio_endpoint,
        minio_bucket=_required(environment, "MINIO_BUCKET"),
        minio_access_key=_required(environment, "MINIO_ACCESS_KEY"),
        minio_secret_key=_required(environment, "MINIO_SECRET_KEY"),
        minio_addresses=minio_addresses,
    )


def _read_exact(sock: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = sock.recv(remaining)
        if not chunk:
            raise ReadinessError("RabbitMQ closed the readiness connection")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_frame(sock: socket.socket) -> tuple[int, int, bytes]:
    header = _read_exact(sock, 7)
    frame_type, channel, size = struct.unpack(">BHI", header)
    if size > 1_048_576:
        raise ReadinessError("RabbitMQ readiness frame exceeded the safe limit")
    payload = _read_exact(sock, size)
    if _read_exact(sock, 1)[0] != AMQP_FRAME_END:
        raise ReadinessError("RabbitMQ returned an invalid readiness frame")
    return frame_type, channel, payload


def _write_frame(sock: socket.socket, frame_type: int, channel: int, payload: bytes) -> None:
    sock.sendall(struct.pack(">BHI", frame_type, channel, len(payload)) + payload + bytes([AMQP_FRAME_END]))


def _method(class_id: int, method_id: int, arguments: bytes = b"") -> bytes:
    return struct.pack(">HH", class_id, method_id) + arguments


def _shortstr(value: str) -> bytes:
    raw = value.encode("utf-8")
    if len(raw) > 255:
        raise ReadinessError("AMQP readiness setting exceeded the protocol limit")
    return bytes([len(raw)]) + raw


def _longstr(value: bytes) -> bytes:
    return struct.pack(">I", len(value)) + value


def _method_id(payload: bytes) -> tuple[int, int]:
    if len(payload) < 4:
        raise ReadinessError("RabbitMQ returned an incomplete method frame")
    return struct.unpack(">HH", payload[:4])


def check_rabbitmq_consumer_connection(settings: WorkerSettings, timeout: float) -> None:
    """Authenticate as the actual worker identity and open its configured vhost."""
    try:
        with socket.create_connection((settings.rabbit_host, settings.rabbit_port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(AMQP_PROTOCOL_HEADER)
            frame_type, channel, payload = _read_frame(sock)
            if frame_type != 1 or channel != 0 or _method_id(payload) != (10, 10):
                raise ReadinessError("RabbitMQ did not begin an AMQP 0-9-1 handshake")

            # Connection.Start-Ok: empty client properties, PLAIN, and the worker credentials.
            response = b"\x00" + settings.rabbit_username.encode() + b"\x00" + settings.rabbit_password.encode()
            arguments = struct.pack(">I", 0) + _shortstr("PLAIN") + _longstr(response) + _shortstr("en_US")
            _write_frame(sock, 1, 0, _method(10, 11, arguments))

            frame_type, channel, payload = _read_frame(sock)
            if frame_type != 1 or channel != 0:
                raise ReadinessError("RabbitMQ returned an invalid authentication response")
            response_method = _method_id(payload)
            if response_method == (10, 50):
                raise ReadinessError("RabbitMQ rejected the parser-worker credentials or vhost")
            if response_method != (10, 30) or len(payload) < 12:
                raise ReadinessError("RabbitMQ did not offer connection readiness")

            # Echo the broker's negotiated limits, then request the exact vhost from Compose.
            tune = payload[4:12]
            _write_frame(sock, 1, 0, _method(10, 31, tune))
            open_args = _shortstr(settings.rabbit_vhost) + _shortstr("") + b"\x00"
            _write_frame(sock, 1, 0, _method(10, 40, open_args))
            frame_type, channel, payload = _read_frame(sock)
            if frame_type != 1 or channel != 0 or _method_id(payload) != (10, 41):
                raise ReadinessError("RabbitMQ rejected the parser-worker vhost connection")

            # A real worker uses a channel for its listener and publisher. Opening a channel
            # exercises the same authenticated connection path without declaring or consuming
            # broker-owned topology.
            _write_frame(sock, 1, 1, _method(20, 10, _shortstr("")))
            frame_type, channel, payload = _read_frame(sock)
            if frame_type != 1 or channel != 1 or _method_id(payload) != (20, 11):
                raise ReadinessError("RabbitMQ rejected the parser-worker channel")
            close_args = struct.pack(">H", 200) + _longstr(b"readiness check complete") + struct.pack(">HH", 0, 0)
            _write_frame(sock, 1, 0, _method(10, 50, close_args))
            frame_type, channel, payload = _read_frame(sock)
            if frame_type != 1 or channel != 0 or _method_id(payload) != (10, 51):
                raise ReadinessError("RabbitMQ did not close the readiness connection cleanly")
    except ReadinessError:
        raise
    except (OSError, TimeoutError, struct.error, UnicodeError) as exc:
        raise ReadinessError(
            f"RabbitMQ connection check failed at {settings.rabbit_host}:{settings.rabbit_port} "
            f"({type(exc).__name__})"
        ) from exc


def _aws_encode(value: str, safe: str = "-_.~") -> str:
    return urllib.parse.quote(value, safe=safe)


def _signature_key(secret: str, date_stamp: str, region: str) -> bytes:
    key_date = hmac.new(("AWS4" + secret).encode(), date_stamp.encode(), hashlib.sha256).digest()
    key_region = hmac.new(key_date, region.encode(), hashlib.sha256).digest()
    key_service = hmac.new(key_region, b"s3", hashlib.sha256).digest()
    return hmac.new(key_service, b"aws4_request", hashlib.sha256).digest()


def _minio_request_parts(
    settings: WorkerSettings, query_values: list[tuple[str, str]]
) -> tuple[str, str, int, bool, str]:
    endpoint = settings.minio_endpoint
    host = endpoint.hostname or ""
    port = endpoint.port or (443 if endpoint.scheme == "https" else 80)
    use_tls = endpoint.scheme == "https"
    address = settings.minio_addresses[0] if settings.minio_addresses else host
    netloc = host if endpoint.port is None else f"{host}:{port}"
    if ":" in host and not host.startswith("["):
        netloc = f"[{host}]" if endpoint.port is None else f"[{host}]:{port}"
    base_path = endpoint.path.rstrip("/")
    bucket_path = _aws_encode(settings.minio_bucket, safe="-_.~")
    path = f"{base_path}/{bucket_path}" if base_path else f"/{bucket_path}"
    canonical_query = "&".join(
        f"{_aws_encode(key)}={_aws_encode(value)}" for key, value in sorted(query_values)
    )
    target = path if not query_values else f"{path}?{canonical_query}"
    return address, netloc, port, use_tls, target


def _signed_minio_get(
    settings: WorkerSettings, query_values: list[tuple[str, str]], timeout: float
) -> ET.Element:
    address, host_header, port, use_tls, request_target = _minio_request_parts(settings, query_values)
    path, _, query = request_target.partition("?")
    payload_hash = hashlib.sha256(b"").hexdigest()
    now = dt.datetime.now(dt.timezone.utc)
    date_stamp = now.strftime("%Y%m%d")
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    region = "us-east-1"
    canonical_headers = (
        f"host:{host_header}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(("GET", path, query, canonical_headers, signed_headers, payload_hash))
    scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join((
        "AWS4-HMAC-SHA256", amz_date, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ))
    signature = hmac.new(
        _signature_key(settings.minio_secret_key, date_stamp, region),
        string_to_sign.encode(), hashlib.sha256,
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={settings.minio_access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    headers = {
        "Host": host_header,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": authorization,
        "User-Agent": "wotb-parser-worker-readiness/1",
        "Connection": "close",
    }
    connection: http.client.HTTPConnection
    if use_tls:
        connection = http.client.HTTPSConnection(address, port, timeout=timeout)
    else:
        connection = http.client.HTTPConnection(address, port, timeout=timeout)
    try:
        connection.request("GET", request_target, headers=headers)
        response = connection.getresponse()
        body = response.read(65_536)
        if response.status != 200:
            raise ReadinessError(f"MinIO worker access failed (HTTP {response.status})")
        try:
            root = ET.fromstring(body)
        except ET.ParseError as exc:
            raise ReadinessError("MinIO returned an invalid worker-prefix response") from exc
        return root
    except ReadinessError:
        raise
    except (OSError, TimeoutError, http.client.HTTPException) as exc:
        raise ReadinessError("MinIO worker-prefix access check failed") from exc
    finally:
        connection.close()


def check_minio_worker_access(settings: WorkerSettings, timeout: float) -> None:
    """Exercise the same bucket-location and worker-prefix reads used by the MinIO adapter."""
    location = _signed_minio_get(settings, [("location", "")], timeout)
    if not location.tag.endswith("LocationConstraint"):
        raise ReadinessError("MinIO did not return bucket-location readiness")
    listing = _signed_minio_get(settings, [
        ("list-type", "2"),
        ("max-keys", "0"),
        ("prefix", TEMP_JOB_PREFIX),
    ], timeout)
    if not listing.tag.endswith("ListBucketResult"):
        raise ReadinessError("MinIO did not return a worker-prefix listing")
    prefix = listing.findtext("{*}Prefix") or listing.findtext("Prefix")
    if prefix != TEMP_JOB_PREFIX:
        raise ReadinessError("MinIO returned a listing for the wrong worker prefix")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-json", default="-", help="effective Compose JSON from stdin")
    parser.add_argument("--attempts", type=int, default=5)
    parser.add_argument("--interval", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=5)
    args = parser.parse_args()
    if args.attempts < 1 or args.interval < 1 or args.timeout <= 0:
        parser.error("attempts, interval, and timeout must be positive")

    try:
        if args.compose_json != "-":
            with open(args.compose_json, encoding="utf-8") as source:
                compose_json = source.read()
        else:
            compose_json = sys.stdin.read()
        settings = load_worker_settings(compose_json)
    except ReadinessError as exc:
        print(f"parser-worker readiness: FAIL ({exc})", file=sys.stderr)
        return 1

    last_error: ReadinessError | None = None
    for attempt in range(1, args.attempts + 1):
        try:
            check_rabbitmq_consumer_connection(settings, args.timeout)
            check_minio_worker_access(settings, args.timeout)
            print("parser-worker dependencies: RabbitMQ consumer connection and MinIO worker-prefix access PASS")
            return 0
        except ReadinessError as exc:
            last_error = exc
            if attempt < args.attempts:
                time.sleep(args.interval)
    print(f"parser-worker readiness: FAIL ({last_error})", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
