# TX RabbitMQ infrastructure boundary

RabbitMQ is a delivery layer, not an authoritative job-state store:

```text
PostgreSQL = authoritative job state
RabbitMQ  = asynchronous delivery
MinIO     = temporary job workspace
```

## Resource ownership

`deploy/tx/docker-compose.yml` owns the RabbitMQ `4.3.6-management-alpine`
runtime, the `rabbitmq_data` volume, health check, restart/memory policy, and
network bindings:

- AMQP: `10.20.0.1:5672`, reachable only through the TX/Yecao WireGuard link;
- Management API: `127.0.0.1:15672`, reachable only on TX loopback.

`infra/tofu/rabbitmq` owns exactly the `/wotbtools` vhost, `control-api` and
`parser-worker` users, and their vhost permissions. It does not manage queues,
exchanges, or bindings. There is currently no application RabbitMQ adapter;
when one is introduced, the application is the single owner of its topology.

The vhost ACLs grant `control-api` write-only access and `parser-worker`
read-only access. Neither user can configure topology or has an administrator
tag. The dedicated vhost prevents either application identity from accessing
the default vhost.

## Credentials and state

The Compose bootstrap administrator and application identities are separate:

```text
TX_RABBITMQ_ADMIN_USER                 GitHub Actions Variable
TX_RABBITMQ_ADMIN_PASSWORD             GitHub Actions Secret
TX_RABBITMQ_CONTROL_API_PASSWORD       GitHub Actions Secret
TX_RABBITMQ_PARSER_WORKER_PASSWORD     GitHub Actions Secret
```

Passwords are forwarded only to the TX process environment and then to
OpenTofu `TF_VAR_*` inputs. They must never be committed in tfvars, logs, or a
server env file. The provider records application passwords as sensitive local
state, so state lives at
`/opt/wotb-tx/rabbitmq-tofu-state/terraform.tfstate` under a root-only parent.

## TX provisioning

GitHub Actions never calls the management API. It transfers the root by SSH;
the TX deploy script performs all provider calls to
`http://127.0.0.1:15672`.

For a `rabbitmq` target the TX sequence is input validation, Compose reconcile,
broker health, `init`/`validate`/saved plan, plan safety validation, apply,
second clean plan, then a root-only
`/opt/wotb-tx/rabbitmq.tofu-provisioned` marker. A missing provider mirror,
unhealthy broker, delete/replace action, vhost or permission update, unknown
address, or non-clean second plan fails closed before readiness is reported.
The two known application users may perform an in-place password update; the
second plan must still be entirely no-op after that update.

## Administrator credential rotation

`RABBITMQ_DEFAULT_USER` and `RABBITMQ_DEFAULT_PASS` bootstrap only a fresh
RabbitMQ data directory. They do not alter credentials already stored in an
existing `rabbitmq_data` volume. Therefore, changing
`TX_RABBITMQ_ADMIN_PASSWORD` alone does not rotate an existing broker
administrator password; it merely changes the credential supplied to the
TX-local provider.

Administrator rotation requires an explicit operator procedure: change the
broker account and the GitHub Actions secret together during a controlled
maintenance operation, then run the RabbitMQ-only provisioning path to verify
the new credential and a clean second plan. Do not use a data-volume reset as
credential rotation.

Before production use, an operator installs OpenTofu, Python, and the exact
locked `cyrilgdn/rabbitmq 1.10.1` archive beneath
`/opt/wotb-tx/tofu-provider-mirror`. `deploy/tx/rabbitmq.tofurc` includes only
that filesystem mirror for this provider and explicitly excludes direct
installation; production cannot download it.

The CI `deploy/test-rabbitmq-tofu.sh` smoke uses disposable credentials and a
temporary RabbitMQ container. It mirrors the provider, applies the root,
checks the vhost/users/ACLs, and requires a no-op second plan.
