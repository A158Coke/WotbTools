# TX RabbitMQ infrastructure boundary

RabbitMQ is a delivery layer, not an authoritative job-state store:

```text
PostgreSQL = authoritative job state
RabbitMQ  = asynchronous delivery
MinIO     = temporary job workspace
```

## Resource ownership

**Static RabbitMQ topology is OpenTofu-owned. Applications only publish/consume
and implement runtime messaging semantics.**

`deploy/tx/docker-compose.yml` owns the RabbitMQ `4.3.6-management-alpine`
runtime, the `rabbitmq_data` volume, health check, restart/memory policy, and
network bindings:

- AMQP: `10.20.0.1:5672`, reachable only through the TX/Yecao WireGuard link;
- Management API: `127.0.0.1:15672`, reachable only on TX loopback.

`infra/tofu/rabbitmq` owns the `/wotbtools` vhost, the `control-api` and
`parser-worker` users, their vhost permissions, and every static exchange,
queue and binding. There is exactly one topology owner. Never let Spring AMQP,
or any other application startup path, declare the same objects: a second owner
makes the broker fail with `PRECONDITION_FAILED` as soon as the declared
arguments differ, and it turns a reviewed OpenTofu diff into an invisible
runtime side effect.

Everything that is not a broker object remains the application's
responsibility: publish and consume, ack/nack, retry decisions, idempotency,
the job state machine, the business workflow, and the message payload schema.

## Canonical topology

`Control API -> wotb.jobs / parser.request -> wotb.parser -> Parser Worker`:

```text
dispatch   control-api   -> wotb.jobs / parser.request -> wotb.parser -> parser-worker
consume    parser-worker <- wotb.parser
retry      parser-worker nack(requeue=false)
                        -> wotb.parser DLX: wotb.jobs / parser.retry   -> wotb.parser.retry
                           (TTL 30000 ms, no consumer)
                        -> retry DLX:     wotb.jobs / parser.request -> wotb.parser
terminal   parser-worker -> wotb.jobs / parser.dead  -> wotb.parser.dlq
                           (no TTL, operator-replayed)
```

| Object | Kind | Durable | Auto-delete | Arguments |
|---|---|---|---|---|
| `wotb.jobs` | exchange, `topic` | yes | no | none |
| `wotb.parser` | queue | yes | no | `x-queue-type=classic`, `x-dead-letter-exchange=wotb.jobs`, `x-dead-letter-routing-key=parser.retry` |
| `wotb.parser.retry` | queue | yes | no | `x-queue-type=classic`, `x-message-ttl=30000`, `x-dead-letter-exchange=wotb.jobs`, `x-dead-letter-routing-key=parser.request` |
| `wotb.parser.dlq` | queue | yes | no | `x-queue-type=classic` |

| Exchange | Routing key | Destination |
|---|---|---|
| `wotb.jobs` | `parser.request` | `wotb.parser` |
| `wotb.jobs` | `parser.retry` | `wotb.parser.retry` |
| `wotb.jobs` | `parser.dead` | `wotb.parser.dlq` |

Routing keys belong to `rabbitmq_binding`; they are not standalone resources and
they are not part of a RabbitMQ ACL.

### Why a topic exchange

One job exchange has to serve several routing keys (`parser.request`,
`parser.retry`, `parser.dead`) and future job families such as `export.*`
without adding an exchange per type. Version 1 binds and publishes only exact
routing keys, so the wildcard capability stays unused and the routing table
stays deterministic. A `direct` exchange would need the same number of bindings
today while forcing a new exchange for every future job family.

### Why `x-queue-type` is declared explicitly

RabbitMQ resolves every queue to a concrete queue type and always reports it
back as the `x-queue-type` argument, even when the declaration omitted it.
Declaring `classic` keeps the declared arguments identical to the observed ones,
which is what stops the provider from planning a replacement on every run.
Queues declared here are non-exclusive by construction: `exclusive` queues are
connection-scoped and cannot exist as static broker objects.

### Retry design

`wotb.parser` dead-letters a rejected message to `wotb.jobs` with the
`parser.retry` routing key. `wotb.parser.retry` has no consumer, holds the
message for its TTL and then dead-letters it back to `wotb.jobs` with the
`parser.request` routing key, returning it to `wotb.parser`.

- Retry queue TTL: `x-message-ttl = 30000` ms, a broker-side delay only.
- Retry queue DLX: `wotb.jobs`, dead-letter routing key `parser.request`.
- Main queue DLX: `wotb.jobs`, dead-letter routing key `parser.retry`.
- Terminal path: `parser-worker` publishes to `wotb.jobs` with routing key
  `parser.dead`, bound to `wotb.parser.dlq`. The DLQ intentionally has no TTL:
  an operator inspects and replays those messages deliberately.

The broker never owns a retry counter, an attempt limit or a job state. The
application decides from PostgreSQL whether a failure is retryable (nack without
requeue, which re-enters the retry loop) or terminal (publish `parser.dead`).

## Permissions

| User | configure | write | read |
|---|---|---|---|
| `control-api` | `^$` | `^wotb\.jobs$` | `^$` |
| `parser-worker` | `^$` | `^wotb\.jobs$` | `^wotb\.parser$` |

Neither identity carries an administrator tag. RabbitMQ requires at least the
`management` tag before a user may call the Management HTTP API at all, so
`control-api` and `parser-worker` cannot reach the Management API, the
Management UI, or its HTTP publish/get helpers; they only speak AMQP.

- `control-api` dispatches jobs. It may publish to `wotb.jobs`, and it may
  neither declare topology nor read any queue. Routing keys are not part of a
  RabbitMQ ACL, so the write grant names the exchange rather than a routing key.
- `parser-worker` consumes only `wotb.parser`. It cannot consume the retry queue
  (that would defeat the broker-side delay) and cannot read the DLQ. Its write
  grant exists for exactly one reason: publishing a terminal failure to
  `wotb.jobs` with the `parser.dead` routing key. Ack, nack and dead-lettering
  are not ACL-checked, so no further write surface is granted.

The dedicated vhost prevents either application identity from accessing the
default vhost.

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
unhealthy broker, delete/replace action, topology mutation, unknown address, or
non-clean second plan fails closed before readiness is reported.

The plan validator allows initial creates plus the two explicitly reviewed
in-place updates: rotating the application user passwords and changing the
vhost ACLs. It rejects every topology `update`, so a queue or exchange argument
change has to be an operator-reviewed replacement rather than a silent drift.
It also rejects any ACL that would let an application identity configure
topology or hold a vhost-wide `write`/`read` grant, whatever an approved diff
contains. The second plan must still be entirely no-op after those updates.

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

## Verification

`scripts/ci/test-rabbitmq-tofu-contract.sh` pins the reviewed contract without a
broker: the exact exchange/queue/binding names and arguments, the exact ACL
regexes, the `cyrilgdn/rabbitmq 1.10.1` provider pin and lockfile, the
mirror-only `.tofurc`, and the Compose runtime boundary.

The CI `deploy/test-rabbitmq-tofu.sh` smoke uses disposable credentials and a
temporary RabbitMQ container. It checks `tofu fmt`, mirrors the provider,
applies the root, requires a no-op second plan, and then verifies against the
running broker that the exchange, queues, bindings and ACLs match the declared
topology. Because the application identities carry no tags and therefore cannot
reach the Management API, messaging is exercised over real AMQP with `pika`:

- `control-api` publishes `parser.request` and `parser-worker` consumes it from
  `wotb.parser`;
- a job that `parser-worker` rejects with `nack(requeue=false)` travels through
  `wotb.parser.retry` and returns to `wotb.parser` with the matching `x-death`
  header;
- `parser-worker` parks a terminal failure on `wotb.parser.dlq` with the
  `parser.dead` routing key;
- both application identities are refused when they declare a queue or
  exchange, when `control-api` reads any queue, when `parser-worker` reads the
  retry queue or the DLQ, and when either publishes outside `wotb.jobs`.
