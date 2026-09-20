#!/usr/bin/env bash
# Disposable RabbitMQ OpenTofu policy, ownership and runtime smoke. It never
# contacts TX.
#
# This is the only RabbitMQ entry point besides
# `infra/tofu/rabbitmq/test-validate-plan.sh`: the plan policy test owns
# destructive/privilege policy, and this file owns the production-safety
# invariants that native tooling accepts plus every real broker behaviour.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOFU_ROOT="$ROOT/infra/tofu/rabbitmq"
TOFU="${TOFU_BIN:-tofu}"
NAME="wotb-rabbitmq-tofu-$RANDOM-$$"
WORK="$(mktemp -d)"
ADMIN_USER="ci-rabbitmq-admin"
ADMIN_PASSWORD="ci-rabbitmq-admin-password"
CONTROL_PASSWORD="ci-control-api-password"
PARSER_PASSWORD="ci-parser-worker-password"

fail() {
  echo "RABBITMQ OPENTOFU FAIL: $*" >&2
  docker logs --tail 160 "$NAME" >&2 || true
  exit 1
}

cleanup() {
  rm -rf -- "$WORK"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for command_name in docker curl python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done
command -v "$TOFU" >/dev/null 2>&1 || fail "$TOFU is required"
[ -d "$TOFU_ROOT" ] || fail "RabbitMQ OpenTofu root is missing"

"$TOFU" -chdir="$TOFU_ROOT" fmt -check -recursive >/dev/null \
  || fail "RabbitMQ OpenTofu root is not tofu-fmt clean"

# Production-safety preflight: shapes that `tofu validate` accepts but that would
# still break the ownership boundary or production safety. Everything the broker
# can prove is verified against the real broker further down instead.
grep -Fq 'path = "/opt/wotb-tx/rabbitmq-tofu-state/terraform.tfstate"' "$TOFU_ROOT/versions.tf" \
  || fail "OpenTofu state must stay at the TX-local root-only path"
if grep -Eq 'remote-exec|local-exec|null_resource|provisioner' "$TOFU_ROOT"/*.tf; then
  fail "the OpenTofu root must not use an out-of-band execution path"
fi
COMPOSE="$ROOT/deploy/tx/docker-compose.yml"
grep -Fq 'image: rabbitmq:4.3.6-management-alpine' "$COMPOSE" \
  || fail "Compose must keep owning the pinned RabbitMQ runtime image"
if grep -Eq 'x-dead-letter|x-message-ttl|x-queue-type|wotb\.jobs|wotb\.parser' "$COMPOSE"; then
  fail "Compose must not declare RabbitMQ topology; OpenTofu is the only topology owner"
fi
TX_DEPLOY="$ROOT/deploy/tx/deploy.sh"
grep -Fq 'bash ./validate-plan.sh plan.tfplan' "$TX_DEPLOY" \
  || fail "the TX deploy path must validate the first plan"
grep -Fq 'bash ./validate-plan.sh second-plan.tfplan --require-no-changes' "$TX_DEPLOY" \
  || fail "the TX deploy path must require a no-op second plan"

docker run -d --name "$NAME" \
  -e RABBITMQ_DEFAULT_USER="$ADMIN_USER" \
  -e RABBITMQ_DEFAULT_PASS="$ADMIN_PASSWORD" \
  -p 127.0.0.1:15672:15672 \
  -p 127.0.0.1:5672:5672 \
  rabbitmq:4.3.6-management-alpine >/dev/null

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error --user "$ADMIN_USER:$ADMIN_PASSWORD" \
      http://127.0.0.1:15672/api/healthchecks/node >/dev/null; then
    echo "PASS: RabbitMQ Management API ready"
    break
  fi
  [ "$attempt" -lt 60 ] && sleep 1
  [ "$attempt" -eq 60 ] && fail "RabbitMQ Management API did not become ready"
done

export TF_VAR_rabbitmq_management_endpoint=http://127.0.0.1:15672
export TF_VAR_rabbitmq_admin_user="$ADMIN_USER"
export TF_VAR_rabbitmq_admin_password="$ADMIN_PASSWORD"
export TF_VAR_control_api_password="$CONTROL_PASSWORD"
export TF_VAR_parser_worker_password="$PARSER_PASSWORD"

MIRROR="$WORK/provider-mirror"
mkdir -p "$MIRROR"
"$TOFU" -chdir="$TOFU_ROOT" providers mirror "$MIRROR" >/dev/null
sed "s|/opt/wotb-tx/tofu-provider-mirror|$MIRROR|" "$ROOT/deploy/tx/rabbitmq.tofurc" \
  > "$WORK/tofurc"

# The production provider source is mirror-only. With the mirror emptied, init
# has to fail closed instead of silently downloading the provider directly.
mkdir -p "$WORK/empty-mirror"
sed "s|$MIRROR|$WORK/empty-mirror|" "$WORK/tofurc" > "$WORK/no-mirror.tfrc"
if TF_CLI_CONFIG_FILE="$WORK/no-mirror.tfrc" TF_DATA_DIR="$WORK/no-mirror-data" \
    "$TOFU" -chdir="$TOFU_ROOT" init -reconfigure -input=false -lockfile=readonly \
    -backend-config="path=$WORK/no-mirror.tfstate" >/dev/null 2>&1; then
  fail "provider installation fell back to a direct download instead of failing closed"
fi
echo "PASS: provider installation is mirror-only and fails closed"

export TF_CLI_CONFIG_FILE="$WORK/tofurc"
export TF_DATA_DIR="$WORK/tofu-data"
"$TOFU" -chdir="$TOFU_ROOT" init -reconfigure -input=false -lockfile=readonly \
  -backend-config="path=$WORK/terraform.tfstate" >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" providers | grep -Fq 'cyrilgdn/rabbitmq] 1.10.1' \
  || fail "the provider version must stay pinned to cyrilgdn/rabbitmq 1.10.1"
"$TOFU" -chdir="$TOFU_ROOT" validate >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" plan -input=false -no-color -out="$WORK/plan.tfplan" >/dev/null
(
  cd "$TOFU_ROOT"
  "$TOFU" show -json "$WORK/plan.tfplan" >/dev/null
  bash ./validate-plan.sh "$WORK/plan.tfplan"
)
"$TOFU" -chdir="$TOFU_ROOT" apply -input=false -auto-approve "$WORK/plan.tfplan" >/dev/null
"$TOFU" -chdir="$TOFU_ROOT" plan -input=false -no-color -out="$WORK/second-plan.tfplan" >/dev/null
(
  cd "$TOFU_ROOT"
  bash ./validate-plan.sh "$WORK/second-plan.tfplan" --require-no-changes
)

# The application identities carry no tags, so they cannot reach the Management
# API at all. Messaging behaviour is therefore exercised over real AMQP, which
# is the only surface those identities ever get.
python3 -m venv "$WORK/venv" >/dev/null 2>&1 || fail "python3 venv creation failed"
if [ -x "$WORK/venv/bin/python" ]; then
  PYTHON="$WORK/venv/bin/python"
else
  PYTHON="$WORK/venv/Scripts/python.exe"
fi
"$PYTHON" -m pip install --quiet --disable-pip-version-check "pika==1.3.2" >/dev/null 2>&1 \
  || fail "installing the AMQP client failed"

"$PYTHON" - "$ADMIN_USER" "$ADMIN_PASSWORD" "$CONTROL_PASSWORD" "$PARSER_PASSWORD" <<'PY'
import base64
import json
import sys
import time
import urllib.error
from urllib.request import Request, urlopen

import pika

admin_user, admin_password, control_password, parser_password = sys.argv[1:]
CONTROL = ("control-api", control_password)
PARSER = ("parser-worker", parser_password)

VHOST = "/wotbtools"
VHOST_API = "%2Fwotbtools"
MGMT = "http://127.0.0.1:15672"
EXCHANGE = "wotb.jobs"
MAIN_QUEUE = "wotb.parser"
RETRY_QUEUE = "wotb.parser.retry"
DLQ = "wotb.parser.dlq"


def mgmt(method, path, body=None):
    """Call the Management API as the bootstrap administrator."""
    data = None if body is None else json.dumps(body).encode()
    authorization = base64.b64encode(f"{admin_user}:{admin_password}".encode()).decode()
    request = Request(
        MGMT + path,
        data=data,
        method=method,
        headers={"Authorization": "Basic " + authorization, "Content-Type": "application/json"},
    )
    with urlopen(request, timeout=10) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def expect_no_management_access(credentials):
    """A RabbitMQ tag is what grants Management API access. These identities
    carry none, so the API must refuse them even though the credentials are
    valid for AMQP on the same vhost."""
    user, password = credentials
    authorization = base64.b64encode(f"{user}:{password}".encode()).decode()
    request = Request(MGMT + "/api/overview", headers={"Authorization": "Basic " + authorization})
    try:
        with urlopen(request, timeout=10):
            pass
    except urllib.error.HTTPError as error:
        body = json.loads(error.read())
        assert error.code == 401, (user, error.code, body)
        assert body.get("reason") == "Not management user", (user, body)
        return
    raise AssertionError(f"{user} must not reach the Management API without a tag")


def connect(credentials):
    user, password = credentials
    return pika.BlockingConnection(
        pika.ConnectionParameters(
            host="127.0.0.1",
            port=5672,
            virtual_host=VHOST,
            credentials=pika.PlainCredentials(user, password),
            heartbeat=0,
            socket_timeout=10,
            blocked_connection_timeout=10,
            connection_attempts=1,
        )
    )


def consume(credentials, queue, marker, timeout=60):
    """Return the first message of `queue` whose body carries `marker`, leaving it
    unacknowledged so the caller can decide between ack and nack."""
    deadline = time.monotonic() + timeout
    while True:
        connection = connect(credentials)
        channel = connection.channel()
        method, properties, body = channel.basic_get(queue=queue, auto_ack=False)
        if method is not None and marker.encode() in (body or b""):
            return connection, channel, method, properties, body
        connection.close()
        assert time.monotonic() < deadline, f"{marker} never reached {queue}"
        time.sleep(1)


def publish(credentials, routing_key, marker, expiration=None):
    connection = connect(credentials)
    try:
        channel = connection.channel()
        properties = pika.BasicProperties(
            content_type="application/json", expiration=expiration
        )
        channel.basic_publish(
            exchange=EXCHANGE,
            routing_key=routing_key,
            body=json.dumps({"marker": marker}).encode(),
            properties=properties,
        )
    finally:
        connection.close()


def expect_denied(credentials, what, call):
    """Assert that the broker refuses `call` with an access-refused channel error."""
    connection = connect(credentials)
    try:
        channel = connection.channel()
        try:
            call(channel)
            # Force a synchronous round trip so a channel-level error surfaces.
            channel.basic_qos(prefetch_count=1)
        except pika.exceptions.ChannelClosedByBroker as error:
            assert error.reply_code == 403, f"{what}: {error.reply_code} {error.reply_text}"
            return
        raise AssertionError(f"{what} must be denied for {credentials[0]}")
    finally:
        try:
            connection.close()
        except pika.exceptions.AMQPError:
            pass


# ---------------------------------------------------------------- vhost/users
assert VHOST in {item["name"] for item in mgmt("GET", "/api/vhosts")}
users = {item["name"]: item for item in mgmt("GET", "/api/users")}
for name in ("control-api", "parser-worker"):
    assert name in users, users.keys()
    assert users[name].get("tags", []) == [], users[name]
for credentials in (CONTROL, PARSER):
    expect_no_management_access(credentials)

# ------------------------------------------------------------- ACL contract
expected_acls = {
    "control-api": {"configure": "^$", "write": "^wotb\\.jobs$", "read": "^$"},
    "parser-worker": {"configure": "^$", "write": "^wotb\\.jobs$", "read": "^wotb\\.parser$"},
}
for name, permissions in expected_acls.items():
    actual = mgmt("GET", f"/api/permissions/{VHOST_API}/{name}")
    assert actual["vhost"] == VHOST, actual
    assert actual["user"] == name, actual
    for scope, expected in permissions.items():
        assert actual[scope] == expected, (name, scope, actual)

# ---------------------------------------------------------------- exchange
exchange = mgmt("GET", f"/api/exchanges/{VHOST_API}/{EXCHANGE}")
assert exchange["type"] == "topic", exchange
assert exchange["durable"] is True, exchange
assert exchange["auto_delete"] is False, exchange
assert not exchange.get("arguments"), exchange

# ------------------------------------------------------------------ queues
expected_queues = {
    MAIN_QUEUE: {
        "x-queue-type": "classic",
        "x-dead-letter-exchange": EXCHANGE,
        "x-dead-letter-routing-key": "parser.retry",
    },
    RETRY_QUEUE: {
        "x-queue-type": "classic",
        "x-message-ttl": 30000,
        "x-dead-letter-exchange": EXCHANGE,
        "x-dead-letter-routing-key": "parser.request",
    },
    DLQ: {"x-queue-type": "classic"},
}
for name, arguments in expected_queues.items():
    queue = mgmt("GET", f"/api/queues/{VHOST_API}/{name}")
    assert queue["durable"] is True, queue
    assert queue["auto_delete"] is False, queue
    assert queue.get("exclusive") is not True, queue
    assert queue.get("arguments", {}) == arguments, (name, queue.get("arguments"))

# ---------------------------------------------------------------- bindings
bindings = {
    (item["source"], item["destination"], item["destination_type"], item["routing_key"])
    for item in mgmt("GET", f"/api/bindings/{VHOST_API}")
}
for source, destination, routing_key in (
    (EXCHANGE, MAIN_QUEUE, "parser.request"),
    (EXCHANGE, RETRY_QUEUE, "parser.retry"),
    (EXCHANGE, DLQ, "parser.dead"),
):
    assert (source, destination, "queue", routing_key) in bindings, (routing_key, bindings)

# ------------------------------------------------------------ dispatch path
# Control API -> wotb.jobs / parser.request -> wotb.parser -> parser-worker.
publish(CONTROL, "parser.request", "dispatch-1")
connection, channel, method, _, body = consume(PARSER, MAIN_QUEUE, "dispatch-1")
assert method.routing_key == "parser.request", method.routing_key
assert method.exchange == EXCHANGE, method.exchange
channel.basic_ack(method.delivery_tag)
connection.close()

# --------------------------------------------------------------- retry path
# A rejected job is dead-lettered into the retry queue; the retry TTL then
# returns it to the main routing key. The per-message expiration overrides the
# declared 30s queue TTL so the assertion stays fast.
publish(CONTROL, "parser.request", "retry-1", expiration="3000")
connection, channel, method, _, _ = consume(PARSER, MAIN_QUEUE, "retry-1")
channel.basic_nack(method.delivery_tag, requeue=False)
connection.close()

connection, channel, method, properties, _ = consume(PARSER, MAIN_QUEUE, "retry-1", timeout=90)
assert method.routing_key == "parser.request", method.routing_key
deaths = properties.headers.get("x-death", [])
assert any(death.get("queue") == RETRY_QUEUE for death in deaths), deaths
assert any(death.get("reason") == "rejected" for death in deaths), deaths
channel.basic_ack(method.delivery_tag)
connection.close()

# ------------------------------------------------------- terminal DLQ path
publish(PARSER, "parser.dead", "dead-1")
dead_letters = mgmt(
    "POST",
    f"/api/queues/{VHOST_API}/{DLQ}/get",
    {"count": 10, "ackmode": "ack_requeue_true", "encoding": "auto"},
)
matching = [item for item in dead_letters if "dead-1" in item.get("payload", "")]
assert matching, dead_letters
assert matching[0]["routing_key"] == "parser.dead", matching[0]

# ------------------------------------------------- application ACL boundaries
# No application identity may declare topology.
expect_denied(
    CONTROL,
    "control-api queue declaration",
    lambda channel: channel.queue_declare(queue="wotb.control-api-probe"),
)
expect_denied(
    CONTROL,
    "control-api exchange declaration",
    lambda channel: channel.exchange_declare(exchange="wotb.control-api-probe", exchange_type="topic"),
)
expect_denied(
    PARSER,
    "parser-worker queue declaration",
    lambda channel: channel.queue_declare(queue="wotb.parser-worker-probe"),
)
expect_denied(
    PARSER,
    "parser-worker exchange declaration",
    lambda channel: channel.exchange_declare(exchange="wotb.parser-worker-probe", exchange_type="topic"),
)
# control-api may not read any queue.
expect_denied(
    CONTROL,
    "control-api queue read",
    lambda channel: channel.basic_get(queue=MAIN_QUEUE, auto_ack=True),
)
# parser-worker may only read the main parser queue.
for queue in (RETRY_QUEUE, DLQ):
    expect_denied(
        PARSER,
        f"parser-worker queue read ({queue})",
        lambda channel, queue=queue: channel.basic_get(queue=queue, auto_ack=True),
    )


# No application identity may publish outside the job exchange.
def publish_elsewhere(channel):
    channel.confirm_delivery()
    channel.basic_publish(exchange="amq.topic", routing_key="parser.request", body=b"probe")


expect_denied(CONTROL, "control-api publish outside wotb.jobs", publish_elsewhere)
expect_denied(PARSER, "parser-worker publish outside wotb.jobs", publish_elsewhere)

print("PASS: static topology, retry/DLX paths, least-privilege ACLs, and clean second plan")
PY

echo "RABBITMQ_OPENTOFU_SMOKE_PASS"
