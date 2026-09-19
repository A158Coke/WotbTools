#!/usr/bin/env bash
# Static RabbitMQ topology and permission contract. Reads repository files only:
# it never contacts a broker, so it runs in the fast CI contract stage.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
tofu_root = root / "infra/tofu/rabbitmq"


def read(path):
    return (root / path).read_text(encoding="utf-8")


def block(text, kind, name):
    marker = f'resource "{kind}" "{name}"'
    assert marker in text, f"missing resource {kind}.{name}"
    return text.split(marker, 1)[1].split("\n}\n", 1)[0]


def flat(text):
    return re.sub(r"\s+", " ", text)


required_files = {
    ".terraform.lock.hcl",
    "providers.tf",
    "rabbitmq.tf",
    "test-validate-plan.sh",
    "validate-plan.sh",
    "variables.tf",
    "versions.tf",
}
assert {path.name for path in tofu_root.iterdir()} >= required_files

# ------------------------------------------------------- provider pin + lock
versions = read("infra/tofu/rabbitmq/versions.tf")
assert 'source  = "cyrilgdn/rabbitmq"' in versions
assert 'version = "1.10.1"' in versions
assert "~>" not in versions
assert 'path = "/opt/wotb-tx/rabbitmq-tofu-state/terraform.tfstate"' in versions

lock = read("infra/tofu/rabbitmq/.terraform.lock.hcl")
assert 'provider "registry.opentofu.org/cyrilgdn/rabbitmq"' in lock
assert 'version     = "1.10.1"' in lock
assert 'constraints = "1.10.1"' in lock
assert lock.count('"zh:') >= 10, "cross-platform provider hashes must stay pinned"

variables = read("infra/tofu/rabbitmq/variables.tf")
assert 'var.rabbitmq_management_endpoint == "http://127.0.0.1:15672"' in variables
for name in (
    "rabbitmq_admin_user",
    "rabbitmq_admin_password",
    "control_api_password",
    "parser_worker_password",
):
    assert f'variable "{name}"' in variables, name
assert variables.count("sensitive   = true") == 4

# ----------------------------------------------------- single topology owner
topology = read("infra/tofu/rabbitmq/rabbitmq.tf")
assert "Static RabbitMQ topology is OpenTofu-owned" in topology
assert "ONE topology owner" in topology
assert "application-owned" not in topology
for forbidden in ("remote-exec", "local-exec", "null_resource", "provisioner"):
    assert forbidden not in topology, forbidden

resource_count = topology.count('resource "')
assert resource_count == 12, resource_count
assert topology.count("prevent_destroy = true") == resource_count

# --------------------------------------------------------- canonical names
locals_text = flat(topology.split("locals {", 1)[1].split("}", 1)[0])
for binding in (
    'jobs_exchange = "wotb.jobs"',
    'parser_queue = "wotb.parser"',
    'parser_retry_queue = "wotb.parser.retry"',
    'parser_dlq = "wotb.parser.dlq"',
    'parser_request_routing_key = "parser.request"',
    'parser_retry_routing_key = "parser.retry"',
    'parser_dead_routing_key = "parser.dead"',
    'queue_type = "classic"',
    "parser_retry_ttl_ms = 30000",
):
    assert binding in locals_text, binding

# ----------------------------------------------------------------- exchange
exchange = flat(block(topology, "rabbitmq_exchange", "jobs"))
assert "name = local.jobs_exchange" in exchange
assert "vhost = rabbitmq_vhost.wotbtools.name" in exchange
assert 'type = "topic"' in exchange
assert "durable = true" in exchange
assert "auto_delete = false" in exchange

# ------------------------------------------------------------------- queues
parser_queue = flat(block(topology, "rabbitmq_queue", "parser"))
assert "name = local.parser_queue" in parser_queue
assert "durable = true" in parser_queue
assert "auto_delete = false" in parser_queue
assert '"x-queue-type" = local.queue_type' in parser_queue
assert '"x-dead-letter-exchange" = local.jobs_exchange' in parser_queue
assert '"x-dead-letter-routing-key" = local.parser_retry_routing_key' in parser_queue

retry_queue = flat(block(topology, "rabbitmq_queue", "parser_retry"))
assert "name = local.parser_retry_queue" in retry_queue
assert "durable = true" in retry_queue
assert "auto_delete = false" in retry_queue
assert '"x-queue-type" = local.queue_type' in retry_queue
assert '"x-message-ttl" = local.parser_retry_ttl_ms' in retry_queue
assert '"x-dead-letter-exchange" = local.jobs_exchange' in retry_queue
assert '"x-dead-letter-routing-key" = local.parser_request_routing_key' in retry_queue

dead_letter_queue = flat(block(topology, "rabbitmq_queue", "parser_dlq"))
assert "name = local.parser_dlq" in dead_letter_queue
assert "durable = true" in dead_letter_queue
assert "auto_delete = false" in dead_letter_queue
assert '"x-queue-type" = local.queue_type' in dead_letter_queue
assert "x-message-ttl" not in dead_letter_queue
assert "x-dead-letter" not in dead_letter_queue

# ----------------------------------------------------------------- bindings
for name, routing_key in (
    ("parser_request", "local.parser_request_routing_key"),
    ("parser_retry", "local.parser_retry_routing_key"),
    ("parser_dead", "local.parser_dead_routing_key"),
):
    binding = flat(block(topology, "rabbitmq_binding", name))
    assert "source = rabbitmq_exchange.jobs.name" in binding, name
    assert "vhost = rabbitmq_vhost.wotbtools.name" in binding, name
    assert 'destination_type = "queue"' in binding, name
    assert f"routing_key = {routing_key}" in binding, name

assert (
    "destination = rabbitmq_queue.parser.name"
    in flat(block(topology, "rabbitmq_binding", "parser_request"))
)
assert (
    "destination = rabbitmq_queue.parser_retry.name"
    in flat(block(topology, "rabbitmq_binding", "parser_retry"))
)
assert (
    "destination = rabbitmq_queue.parser_dlq.name"
    in flat(block(topology, "rabbitmq_binding", "parser_dead"))
)

# ------------------------------------------------------- permission regexes
control_acl = flat(block(topology, "rabbitmq_permissions", "control_api_publisher"))
assert 'configure = "^$"' in control_acl
assert r'write = "^wotb\\.jobs$"' in control_acl
assert 'read = "^$"' in control_acl

parser_acl = flat(block(topology, "rabbitmq_permissions", "parser_worker_consumer"))
assert 'configure = "^$"' in parser_acl
assert r'write = "^wotb\\.jobs$"' in parser_acl
assert r'read = "^wotb\\.parser$"' in parser_acl

for acl in (control_acl, parser_acl):
    assert '".*"' not in acl, "application identities must never hold a vhost-wide ACL"

# ------------------------------------------------------------- mirror + TX
tofurc = flat(read("deploy/tx/rabbitmq.tofurc"))
assert 'path = "/opt/wotb-tx/tofu-provider-mirror"' in tofurc
assert 'include = ["registry.opentofu.org/cyrilgdn/rabbitmq"]' in tofurc
assert 'exclude = ["registry.opentofu.org/cyrilgdn/rabbitmq"]' in tofurc

deploy = read("deploy/tx/deploy.sh")
assert "TF_VAR_control_api_password" in deploy
assert "TF_VAR_parser_worker_password" in deploy
assert "bash ./validate-plan.sh plan.tfplan" in deploy
assert "bash ./validate-plan.sh second-plan.tfplan --require-no-changes" in deploy

# Compose still owns only the runtime and declares no topology.
compose = read("deploy/tx/docker-compose.yml")
assert "image: rabbitmq:4.3.6-management-alpine" in compose
assert '"10.20.0.1:5672:5672"' in compose
assert '"127.0.0.1:15672:15672"' in compose
assert "rabbitmq_data:/var/lib/rabbitmq" in compose
assert "rabbitmq-diagnostics" in compose
for forbidden in ("x-dead-letter-exchange", "x-message-ttl", "wotb.jobs", "wotb.parser"):
    assert forbidden not in compose, forbidden

# ------------------------------------------------------------- smoke + docs
smoke = read("deploy/test-rabbitmq-tofu.sh")
for token in (
    "fmt -check -recursive",
    "lockfile=readonly",
    "x-queue-type",
    "x-message-ttl",
    "parser.request",
    "parser.retry",
    "parser.dead",
    "x-death",
    "expect_denied",
):
    assert token in smoke, token

ops = read("docs/operations/rabbitmq.md")
assert "Static RabbitMQ topology is OpenTofu-owned" in ops
assert "application-owned" not in ops
for token in ("wotb.jobs", "wotb.parser.retry", "wotb.parser.dlq", "x-message-ttl", "parser.dead"):
    assert token in ops, token

for path in ("docs/DEVELOPER_GUIDE.md", "deploy/AGENTS.md", "docs/CHANGELOG.md"):
    assert "application-owned" not in read(path), path

ci = read(".github/workflows/ci.yml")
assert "scripts/ci/test-rabbitmq-tofu-contract.sh" in ci
assert "deploy/test-rabbitmq-tofu.sh" in ci

print("RabbitMQ static topology and permission contract OK")
PY
