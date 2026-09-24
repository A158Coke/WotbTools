#!/usr/bin/env bash
# Yecao production identity, single-service, and failure-gate smoke.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
SHA_C=cccccccccccccccccccccccccccccccccccccccc
TAG_A=ghcr.io/a158coke/wotbtools-parser-worker:sha-aaaaaaaaaaaa
TAG_B=ghcr.io/a158coke/wotbtools-parser-worker:sha-bbbbbbbbbbbb
MINIO_TAG=ghcr.io/a158coke/wotbtools-minio:sha-aaaaaaaaaaaa

mkdir -p "$WORK/incoming/deploy/observability/alloy" "$WORK/bin" "$WORK/minio/deploy"
cp "$ROOT/deploy/deploy.sh" "$ROOT/deploy/release-metadata.py" "$ROOT/deploy/docker-compose.prod.yml" \
  "$ROOT/deploy/validate-alloy-config.sh" "$ROOT/deploy/worker-readiness.py" "$WORK/incoming/deploy/"
cp "$ROOT/deploy/observability/alloy/config.alloy" "$WORK/incoming/deploy/observability/alloy/"
cp "$ROOT/deploy/minio-deploy.sh" "$ROOT/deploy/release-metadata.py" \
  "$ROOT/deploy/docker-compose.minio.yml" "$WORK/minio/deploy/"
sed -i 's/\r$//' "$WORK/incoming/deploy/"*.sh "$WORK/minio/deploy/"*.sh
sed -i 's/\r$//' "$WORK/incoming/deploy/docker-compose.prod.yml"
cat > "$WORK/production-release.json" <<JSON
{"schemaVersion":2,"services":{"parser-worker":{"configSha":"$SHA_A","image":{"tag":"$TAG_A","commitSha":"$SHA_A"},"deployedAt":"2026-01-01T00:00:00Z"},"minio":{"configSha":"$SHA_A","image":{"tag":"$MINIO_TAG","commitSha":"$SHA_A"},"deployedAt":"2026-01-01T00:00:00Z"}}}
JSON
chmod 600 "$WORK/production-release.json"
cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = compose ] || exit 0
shift
while [ "${1:-}" = -f ]; do shift 2; done
verb="${1:-}"; shift || true
printf '%s %s\n' "$verb" "$*" >> "${FAKE_DOCKER_LOG:?}"
case "$verb" in
  config)
    if [ "${1:-}" = --format ] && [ "${2:-}" = json ]; then
      python3 - <<'PY'
import json
import os

print(json.dumps({
    "services": {
        "parser-worker": {
            "environment": {
                "RABBITMQ_HOST": "127.0.0.1",
                "RABBITMQ_PORT": os.environ["FAKE_RABBIT_PORT"],
                "RABBITMQ_VHOST": "/wotbtools",
                "RABBITMQ_USERNAME": "parser-worker",
                "RABBITMQ_PASSWORD": "test",
                "MINIO_ENDPOINT": os.environ["FAKE_MINIO_ENDPOINT"],
                "MINIO_BUCKET": "wotbtools-temp",
                "MINIO_ACCESS_KEY": "test",
                "MINIO_SECRET_KEY": "test",
            },
        },
    },
}))
PY
    fi
    ;;
  up) [ "${FAKE_UP_FAILURE:-0}" != 1 ] ;;
  ps) if [ "${FAKE_WORKER_DOWN:-0}" = 1 ]; then echo 'parser-worker Exited'; else echo 'parser-worker Up'; fi ;;
  *) : ;;
esac
DOCKER
chmod 700 "$WORK/bin/docker"

# Deterministic local protocol fixtures exercise the actual worker AMQP handshake and signed
# MinIO prefix read without accessing a production service.
cat > "$WORK/readiness-fixture.py" <<'PY'
import http.server
import json
import os
import socketserver
import struct
import sys
import threading
import urllib.parse

work = sys.argv[1]
END = 0xCE

def exact(conn, size):
    result = bytearray()
    while len(result) < size:
        part = conn.recv(size - len(result))
        if not part:
            raise OSError("closed")
        result.extend(part)
    return bytes(result)

def read_frame(conn):
    frame_type, channel, size = struct.unpack(">BHI", exact(conn, 7))
    payload = exact(conn, size)
    if exact(conn, 1)[0] != END:
        raise OSError("bad frame")
    return frame_type, channel, payload

def write_frame(conn, frame_type, channel, payload):
    conn.sendall(struct.pack(">BHI", frame_type, channel, len(payload)) + payload + bytes([END]))

def method(class_id, method_id, args=b""):
    return struct.pack(">HH", class_id, method_id) + args

def shortstr(value):
    value = value.encode()
    return bytes([len(value)]) + value

def longstr(value):
    return struct.pack(">I", len(value)) + value

def reject(conn):
    args = struct.pack(">H", 403) + longstr(b"ACCESS_REFUSED") + struct.pack(">HH", 0, 0)
    write_frame(conn, 1, 0, method(10, 50, args))

def rabbit_client(conn, _client_address, _server):
    with conn:
        try:
            header = exact(conn, 8)
            if header != b"AMQP\x00\x00\x09\x01":
                return
            start = method(10, 10, b"\x00\x09" + struct.pack(">I", 0) + longstr(b"PLAIN") + longstr(b"en_US"))
            write_frame(conn, 1, 0, start)
            _, _, payload = read_frame(conn)
            pos = 8 + struct.unpack(">I", payload[4:8])[0]
            pos += 1 + payload[pos]
            response_size = struct.unpack(">I", payload[pos:pos + 4])[0]
            auth = payload[pos + 4:pos + 4 + response_size].split(b"\x00")
            if (os.path.exists(os.path.join(work, "rabbit.fail")) or len(auth) != 3
                    or auth[1:] != [b"parser-worker", b"test"]):
                reject(conn)
                return
            write_frame(conn, 1, 0, method(10, 30, struct.pack(">HIH", 0, 131072, 0)))
            _, _, tune_ok = read_frame(conn)
            if struct.unpack(">HH", tune_ok[:4]) != (10, 31):
                return
            _, _, opened = read_frame(conn)
            size = opened[4]
            if opened[5:5 + size] != b"/wotbtools":
                reject(conn)
                return
            write_frame(conn, 1, 0, method(10, 41, shortstr("fixture")))
            frame_type, channel, opened_channel = read_frame(conn)
            if (frame_type, channel, struct.unpack(">HH", opened_channel[:4])) != (1, 1, (20, 10)):
                return
            write_frame(conn, 1, 1, method(20, 11))
            frame_type, channel, closing = read_frame(conn)
            if (frame_type, channel, struct.unpack(">HH", closing[:4])) == (1, 0, (10, 50)):
                write_frame(conn, 1, 0, method(10, 51))
        except (OSError, IndexError, struct.error):
            return

class RabbitServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

rabbit = RabbitServer(("127.0.0.1", 0), rabbit_client)

class MinioHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query, keep_blank_values=True)
        signed = (
            not os.path.exists(os.path.join(work, "minio.fail"))
            and self.headers.get("Authorization", "").startswith("AWS4-HMAC-SHA256 Credential=test/")
            and self.headers.get("x-amz-content-sha256")
            and self.headers.get("x-amz-date")
            and urllib.parse.urlsplit(self.path).path == "/wotbtools-temp"
        )
        if signed and query == {"location": [""]}:
            body = b"<LocationConstraint></LocationConstraint>"
            self.send_response(200)
        elif signed and query.get("list-type") == ["2"] and query.get("max-keys") == ["0"] and query.get("prefix") == ["temp/jobs/"]:
            body = b"<ListBucketResult><Prefix>temp/jobs/</Prefix><KeyCount>0</KeyCount></ListBucketResult>"
            self.send_response(200)
        else:
            body = b"<Error><Code>AccessDenied</Code></Error>"
            self.send_response(403)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass

class MinioServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

minio = MinioServer(("127.0.0.1", 0), MinioHandler)
with open(os.path.join(work, "ports.json"), "w", encoding="utf-8") as handle:
    json.dump({"rabbit": rabbit.server_address[1], "minio": minio.server_address[1]}, handle)
threading.Thread(target=rabbit.serve_forever, daemon=True).start()
minio.serve_forever()
PY
python3 "$WORK/readiness-fixture.py" "$WORK" >/dev/null 2>&1 &
READINESS_FIXTURE_PID=$!
for _ in $(seq 1 50); do
  [ -s "$WORK/ports.json" ] && break
  sleep 0.1
done
[ -s "$WORK/ports.json" ] || { echo 'readiness fixture failed to start' >&2; exit 1; }
FAKE_RABBIT_PORT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["rabbit"])' "$WORK/ports.json")"
FAKE_MINIO_PORT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["minio"])' "$WORK/ports.json")"
trap 'kill "$READINESS_FIXTURE_PID" 2>/dev/null || true; rm -rf "$WORK"' EXIT

run() {
  local service="$1" config="$2" tag="$3" image_sha="$4" log="$5"
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" \
    WOTB_DIR="$WORK" WOTB_INCOMING_DIR="$WORK/incoming" \
    WOTB_DEPLOY_SERVICE="$service" WOTB_DEPLOY_CONFIG_SHA="$config" \
    WOTB_DEPLOY_IMAGE_TAG="$tag" WOTB_DEPLOY_IMAGE_COMMIT_SHA="$image_sha" \
    WOTB_HEALTH_ATTEMPTS=1 WOTB_HEALTH_INTERVAL_SEC=1 WOTB_PULL_ATTEMPTS=1 \
    GRAFANA_ADMIN_USER=test GRAFANA_ADMIN_PASSWORD=test \
    TX_RABBITMQ_PARSER_WORKER_PASSWORD=test YECAO_MINIO_WORKER_ACCESS_KEY=test \
    YECAO_MINIO_WORKER_SECRET_KEY=test FAKE_DOCKER_LOG="$log" \
    FAKE_RABBIT_PORT="$FAKE_RABBIT_PORT" FAKE_MINIO_PORT="$FAKE_MINIO_PORT" \
    FAKE_MINIO_ENDPOINT="${FAKE_MINIO_ENDPOINT:-127.0.0.1:$FAKE_MINIO_PORT}" \
    WOTB_WORKER_READINESS_ATTEMPTS=1 WOTB_WORKER_READINESS_INTERVAL_SEC=1 \
    WOTB_WORKER_READINESS_TIMEOUT_SEC=2 \
    FAKE_UP_FAILURE="${FAKE_UP_FAILURE:-0}" FAKE_WORKER_DOWN="${FAKE_WORKER_DOWN:-0}" \
    bash "$WORK/incoming/deploy/deploy.sh"
}
metadata() { python3 "$ROOT/deploy/release-metadata.py" get --host yecao \
  --file "$WORK/production-release.json" --service "$1" --field "$2"; }

# The execution plane may not acquire a local PostgreSQL job authority.
cp "$WORK/incoming/deploy/docker-compose.prod.yml" "$WORK/worker-compose.saved"
sed -i '/^  parser-worker:$/a\    POSTGRES_HOST: postgres' "$WORK/incoming/deploy/docker-compose.prod.yml"
if run parser-worker "$SHA_B" '' '' "$WORK/stateless.log" >/dev/null 2>&1; then exit 1; fi
[ ! -s "$WORK/stateless.log" ]
cp "$WORK/worker-compose.saved" "$WORK/incoming/deploy/docker-compose.prod.yml"

# Consumer-identity dependency failures stop before image pull, file promotion, restart, or metadata.
before="$(sha256sum "$WORK/production-release.json")"
: > "$WORK/rabbit-not-ready.log"
touch "$WORK/rabbit.fail"
if run parser-worker "$SHA_B" '' '' "$WORK/rabbit-not-ready.log" >/dev/null 2>&1; then exit 1; fi
[ "$before" = "$(sha256sum "$WORK/production-release.json")" ]
[ ! -e "$WORK/docker-compose.yml" ]
! grep -Eq '^(pull|up) ' "$WORK/rabbit-not-ready.log"
rm "$WORK/rabbit.fail"

: > "$WORK/minio-not-ready.log"
touch "$WORK/minio.fail"
if run parser-worker "$SHA_B" '' '' "$WORK/minio-not-ready.log" >/dev/null 2>&1; then exit 1; fi
[ "$before" = "$(sha256sum "$WORK/production-release.json")" ]
[ ! -e "$WORK/docker-compose.yml" ]
! grep -Eq '^(pull|up) ' "$WORK/minio-not-ready.log"
rm "$WORK/minio.fail"

# The host probes the internal MinIO service by container IP, so HTTPS must fail closed
# instead of validating a certificate against that IP rather than the service alias.
: > "$WORK/minio-https.log"
if FAKE_MINIO_ENDPOINT=https://minio:9000 run parser-worker "$SHA_B" '' '' "$WORK/minio-https.log" > "$WORK/minio-https-output" 2>&1; then exit 1; fi
grep -Fq 'internal MinIO service readiness requires HTTP' "$WORK/minio-https-output"
[ "$before" = "$(sha256sum "$WORK/production-release.json")" ]
[ ! -e "$WORK/docker-compose.yml" ]
! grep -Eq '^(pull|up) ' "$WORK/minio-https.log"

# Config-only pins the deployed image, updates only config SHA, and starts one service.
run parser-worker "$SHA_B" '' '' "$WORK/config.log" >/dev/null
[ "$(metadata parser-worker tag)" = "$TAG_A" ]
[ "$(metadata parser-worker configSha)" = "$SHA_B" ]
grep -q '^pull parser-worker$' "$WORK/config.log"
grep -q '^up -d --no-deps --force-recreate parser-worker$' "$WORK/config.log"
! grep -Eq '^up .*grafana|^up .*minio' "$WORK/config.log"
grep -Fq "$TAG_A" "$WORK/docker-compose.yml"

# Build image advances image identity only after liveness succeeds.
run parser-worker "$SHA_C" "$TAG_B" "$SHA_B" "$WORK/image.log" >/dev/null
[ "$(metadata parser-worker tag)" = "$TAG_B" ]
[ "$(metadata parser-worker commitSha)" = "$SHA_B" ]
[ "$(metadata parser-worker configSha)" = "$SHA_C" ]
[ "$(stat -c %a "$WORK/production-release.json")" = 600 ]

# Fixed upstream service never alters either self-built image entry.
before="$(sha256sum "$WORK/production-release.json")"
run node-exporter "$SHA_C" '' '' "$WORK/fixed.log" >/dev/null
[ "$before" = "$(sha256sum "$WORK/production-release.json")" ]
grep -q '^up -d --no-deps --force-recreate node-exporter$' "$WORK/fixed.log"
! grep -Eq '^up .*parser-worker|^up .*grafana' "$WORK/fixed.log"

# Invalid ownership, missing metadata, wrong registry and retired selectors fail before Docker.
for service in all wotb-backend keycloak; do
  if run "$service" "$SHA_C" '' '' "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
done
if run parser-worker "$SHA_C" 'ccr.ccs.tencentyun.com/x/wotbtools-parser-worker:sha-bbbbbbbbbbbb' "$SHA_B" "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
cp "$WORK/production-release.json" "$WORK/metadata.saved"
printf '{broken' > "$WORK/production-release.json"; chmod 600 "$WORK/production-release.json"
if run parser-worker "$SHA_C" '' '' "$WORK/reject.log" >/dev/null 2>&1; then exit 1; fi
cp "$WORK/metadata.saved" "$WORK/production-release.json"; chmod 600 "$WORK/production-release.json"

# Failed runtime does not advance metadata and stops the affected worker.
before="$(sha256sum "$WORK/production-release.json")"
if FAKE_UP_FAILURE=1 run parser-worker "$SHA_A" "$TAG_A" "$SHA_A" "$WORK/fail.log" >/dev/null 2>&1; then exit 1; fi
[ "$before" = "$(sha256sum "$WORK/production-release.json")" ]
grep -q '^stop parser-worker$' "$WORK/fail.log"

# MinIO runtime is separate from Tofu and shares the same metadata file and host lock.
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" WOTB_DIR="$WORK" \
  WOTB_DEPLOY_SERVICE=minio WOTB_DEPLOY_CONFIG_SHA="$SHA_B" \
  YECAO_MINIO_ROOT_USER=test YECAO_MINIO_ROOT_PASSWORD=test FAKE_DOCKER_LOG="$WORK/minio.log" \
  bash "$WORK/minio/deploy/minio-deploy.sh" "$WORK/minio" >/dev/null
[ "$(metadata minio tag)" = "$MINIO_TAG" ]
[ "$(metadata minio configSha)" = "$SHA_B" ]
grep -q '^up -d --wait --no-deps minio$' "$WORK/minio.log"

echo 'Yecao metadata v2, single-service deploy, and failure gates: PASS'
