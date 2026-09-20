#!/usr/bin/env bash
# RabbitMQ static ownership and production-safety contract. Reads repository
# files only, so it runs in the fast CI contract stage.
#
# Responsibility split (do not duplicate the other two layers here):
#   tofu fmt / tofu validate / plan      -> syntax, schema and provider-legal fields
#   infra/tofu/rabbitmq/validate-plan.sh -> plan destructive/privilege policy
#   deploy/test-rabbitmq-tofu.sh         -> real broker runtime behaviour
# This file only pins what native tooling considers valid but would still break
# the project's ownership boundary or production safety.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])

# A RabbitMQ ACL is a regex over resource names; any of these grants the whole
# vhost and is never acceptable for an application identity.
CATCH_ALL = {".*", ".+", "^.*$", "^.+$"}


def read(path):
    return (root / path).read_text(encoding="utf-8")


def block(text, kind, name):
    marker = f'resource "{kind}" "{name}"'
    assert marker in text, f"missing resource {kind}.{name}"
    return re.sub(r"\s+", " ", text.split(marker, 1)[1].split("\n}\n", 1)[0])


def variable(text, name):
    assert f'variable "{name}"' in text, name
    return re.sub(r"\s+", " ", text.split(f'variable "{name}"', 1)[1].split("\n}", 1)[0])


versions = read("infra/tofu/rabbitmq/versions.tf")
lock = read("infra/tofu/rabbitmq/.terraform.lock.hcl")
variables = read("infra/tofu/rabbitmq/variables.tf")
topology = read("infra/tofu/rabbitmq/rabbitmq.tf")

# --- reproducibility: exact provider pin and TX-local root-only state path ---
assert 'version = "1.10.1"' in versions
assert "~>" not in versions
assert 'provider "registry.opentofu.org/cyrilgdn/rabbitmq"' in lock
assert 'constraints = "1.10.1"' in lock
assert 'path = "/opt/wotb-tx/rabbitmq-tofu-state/terraform.tfstate"' in versions

# --- production safety: loopback-only provider, credentials never printed ----
assert 'var.rabbitmq_management_endpoint == "http://127.0.0.1:15672"' in variables
for name in (
    "rabbitmq_admin_user",
    "rabbitmq_admin_password",
    "control_api_password",
    "parser_worker_password",
):
    assert "sensitive = true" in variable(variables, name), name

# --- the production provider source cannot fall back to a direct download ----
tofurc = re.sub(r"\s+", " ", read("deploy/tx/rabbitmq.tofurc"))
assert 'path = "/opt/wotb-tx/tofu-provider-mirror"' in tofurc
assert 'include = ["registry.opentofu.org/cyrilgdn/rabbitmq"]' in tofurc
assert 'exclude = ["registry.opentofu.org/cyrilgdn/rabbitmq"]' in tofurc

# --- no out-of-band execution path around the provider -----------------------
for forbidden in ("remote-exec", "local-exec", "null_resource", "provisioner"):
    assert forbidden not in topology, forbidden

# --- exactly one topology owner: OpenTofu declares it, Compose does not ------
for kind in ("rabbitmq_exchange", "rabbitmq_queue", "rabbitmq_binding"):
    assert f'resource "{kind}"' in topology, kind
compose = read("deploy/tx/docker-compose.yml")
assert "image: rabbitmq:4.3.6-management-alpine" in compose
for forbidden in ("x-dead-letter", "x-message-ttl", "x-queue-type", "wotb.jobs", "wotb.parser"):
    assert forbidden not in compose, forbidden

# --- application identities stay AMQP-only: no tag, no dangerous ACL ---------
# The exact ACL values and the resulting broker state are asserted by the real
# smoke; here only the shapes that must never exist are pinned.
for resource_name in ("control_api", "parser_worker"):
    user = block(topology, "rabbitmq_user", resource_name)
    assert 'tags = []' in user, resource_name

for resource_name in ("control_api_publisher", "parser_worker_consumer"):
    acl = block(topology, "rabbitmq_permissions", resource_name)
    assert 'configure = "^$"' in acl, resource_name
    for scope in ("write", "read"):
        match = re.search(rf'{scope} = "([^"]*)"', acl)
        assert match, f"{resource_name}: missing {scope}"
        assert match.group(1) not in CATCH_ALL, f"{resource_name} {scope} must not be vhost-wide"

# --- the TX deploy path keeps both plan gates --------------------------------
deploy = read("deploy/tx/deploy.sh")
assert "bash ./validate-plan.sh plan.tfplan" in deploy
assert "bash ./validate-plan.sh second-plan.tfplan --require-no-changes" in deploy

print("RabbitMQ ownership and production-safety contract OK")
PY
