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
The JVM side of that contract lives in `java/wotb-broker-rabbitmq`
(`com.wotb.broker.rabbitmq`): `ParserTopology` holds the names, and it holds
*only* names — the module declares no exchange, queue or binding, no Spring
stereotype and no `@Configuration`, so an application container cannot become a
second topology owner by starting up.

## Canonical topology

The protocol is bidirectional. `Control API -> wotb.jobs / parser.request ->
wotb.parser -> Parser Worker` is the dispatch direction; `Parser Worker ->
wotb.jobs / parser.result | parser.failed -> wotb.parser.result -> Control API`
is the return direction, where the worker reports per-source outcomes and
whole-attempt failures:

```text
dispatch   control-api   -> wotb.jobs / parser.request -> wotb.parser -> parser-worker
consume    parser-worker <- wotb.parser
retry      parser-worker nack(requeue=false)
                        -> wotb.parser DLX: wotb.jobs / parser.retry   -> wotb.parser.retry
                           (TTL 30000 ms, no consumer)
                        -> retry DLX:     wotb.jobs / parser.request -> wotb.parser
terminal   parser-worker -> wotb.jobs / parser.dead  -> wotb.parser.dlq
                           (no TTL, operator-replayed)
result     parser-worker -> wotb.jobs / parser.result -> wotb.parser.result -> control-api
failed     parser-worker -> wotb.jobs / parser.failed -> wotb.parser.result -> control-api
                           (both bindings, one queue)
reject     control-api nack(requeue=false)
                        -> wotb.parser.result DLX: wotb.jobs / parser.dead -> wotb.parser.dlq
```

| Object | Kind | Durable | Auto-delete | Arguments |
|---|---|---|---|---|
| `wotb.jobs` | exchange, `topic` | yes | no | none |
| `wotb.parser` | queue | yes | no | `x-queue-type=classic`, `x-dead-letter-exchange=wotb.jobs`, `x-dead-letter-routing-key=parser.retry` |
| `wotb.parser.retry` | queue | yes | no | `x-queue-type=classic`, `x-message-ttl=30000`, `x-dead-letter-exchange=wotb.jobs`, `x-dead-letter-routing-key=parser.request` |
| `wotb.parser.dlq` | queue | yes | no | `x-queue-type=classic` |
| `wotb.parser.result` | queue | yes | no | `x-queue-type=classic`, `x-dead-letter-exchange=wotb.jobs`, `x-dead-letter-routing-key=parser.dead` |

| Exchange | Routing key | Destination |
|---|---|---|
| `wotb.jobs` | `parser.request` | `wotb.parser` |
| `wotb.jobs` | `parser.retry` | `wotb.parser.retry` |
| `wotb.jobs` | `parser.dead` | `wotb.parser.dlq` |
| `wotb.jobs` | `parser.result` | `wotb.parser.result` |
| `wotb.jobs` | `parser.failed` | `wotb.parser.result` |

Routing keys belong to `rabbitmq_binding`; they are not standalone resources and
they are not part of a RabbitMQ ACL.

### Why the result queue is `wotb.parser.result`

It is the queue the *worker's* reports are routed to, so it is named after the
protocol it carries, next to `wotb.parser`, `wotb.parser.retry` and
`wotb.parser.dlq`; a name such as `wotb.control.results` would describe the
consumer rather than the contract and would make the existing
`read = ^wotb\.parser$` style of ACL grouping impossible. It is deliberately
*not* called `wotb.parser` with a suffix the worker could consume: the worker
never reads it, and `^wotb\.parser$` keeps that true by construction.

There is deliberately no cancel routing key. Cancellation is a PostgreSQL state
change (`cancel_requested`) that the worker observes at a safe unit boundary; a
broker-side cancel message would either arrive after the work started or be
silently ignored, and it would put cancellation state in RabbitMQ.

### Why a topic exchange

`topic` is a deliberate forward-compatible choice, not a routing requirement.
A later version can add wildcard bindings (`parser.*`, `export.*`) without
replacing the exchange, and changing an exchange type is a destructive
replacement of a `prevent_destroy` resource. Version 1 binds and publishes only
exact routing keys, so the wildcard capability stays unused and the routing
table stays deterministic.

A `direct` exchange would route today's exact keys just as well — it carries
arbitrary exact routing keys such as `parser.request` and `export.request` — so
`direct` would not need one exchange per job family. It is rejected here only
because it would have to be replaced to ever gain wildcard routing.

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

**Retry policy is control-plane owned.** The `parser-worker` deliberately does
*not* use this loop: on an infrastructure failure it publishes a confirmed
`parser.failed` (`retryable=true`, same `jobId` and `attempt`) and only then
acknowledges the request, so retrying is a control-plane decision — the control
plane advances the authoritative attempt and dispatches a new `parser.request`
with `attempt + 1`. A delivery the worker never acknowledged is redelivered by
AMQP with the **same** attempt; that transport redelivery is not a logical retry.
The logical retry is dispatched immediately to `wotb.parser`; it is deliberately
**not** routed through `wotb.parser.retry`, because borrowing a broker queue as
the control plane's retry scheduler would make the broker a second owner of retry
timing. The queue, its TTL and its bindings therefore remain only as PR C
protocol surface, and removing them is a cleanup after PR E is live.
See `docs/operations/parser-worker.md`.

### Result and DLQ semantics

The return path is manual-ack on the control-plane side, with one rule: a report
the handler *applies*, and a report the handler classifies as *stale or
duplicate*, are both acknowledged. An idempotent no-op is a success, so it must
not be retried and must not reach the DLQ.

Only two things dead-letter a report, and both fail closed:

- the handler throws — the report cannot be applied right now (for example
  PostgreSQL is unavailable);
- the body does not decode — not JSON, not an envelope object, an unsupported
  `schemaVersion`, an undeclared property, or a violation of the message
  contract.

`wotb.parser.result` dead-letters to `wotb.jobs` with `parser.dead`, so those
land in `wotb.parser.dlq` next to worker-published terminal failures and an
operator inspects one place. Nothing is dropped and nothing is requeued in a
loop: `basicNack(requeue=false)` is the only rejection the listener issues, so a
poison message cannot spin. The queue has no TTL for the same reason the DLQ
has none — a report the control plane failed to apply must be replayed
deliberately, never discarded by the broker on its own.

#### Operator action for a non-empty DLQ

The TX cutover gate fails its `parser-worker` token while `wotb.parser.dlq` is
non-empty, because a non-empty DLQ means at least one replay permanently failed
or could not be decoded. A gate that goes green by purging evidence is worse than
a red gate, so the sequence is:

```text
1. read-only state:   docker compose -f /opt/wotb-tx/deploy/docker-compose.yml exec -T rabbitmq \
                        rabbitmqctl -q list_queues name messages consumers
                      and confirm PostgreSQL holds no non-terminal job projection for it
                      (the job authority is PostgreSQL, never the broker)
2. inspect:           TX loopback Management UI, http://127.0.0.1:15672/ -> queue wotb.parser.dlq
                      (loopback only; nothing is published publicly)
3. classify:          parser.dead  = terminal failure with an error code
                      raw bytes   = the body could not be decoded at all
4. re-drive:          after the underlying defect is fixed, re-create the processing job with the
                      same jobId through the control API, or re-publish the message to
                      wotb.jobs / parser.request; a transient infrastructure failure is re-driven
                      the same way
5. record:            a genuinely unprocessable legacy sample is recorded as a permanent failure
                      and needs an explicit operator decision — not a silent purge
6. verify:            the queue is empty again, then re-run the cutover gate
```

`rabbitmqctl purge_queue wotb.parser.dlq` (or the Management UI's purge) is only
allowed after every message has been classified and recorded in step 3/5.

## Permissions

| User | tags | configure | write | read |
|---|---|---|---|---|
| `control-api` | `[]` | `^$` | `^wotb\.jobs$` | `^wotb\.parser\.result$` |
| `parser-worker` | `[]` | `^$` | `^wotb\.jobs$` | `^wotb\.parser$` |

Neither identity carries any tag. RabbitMQ requires at least the `management`
tag before a user may call the Management HTTP API at all, so `control-api` and
`parser-worker` cannot reach the Management API, the Management UI, or its HTTP
publish/get helpers; they only speak AMQP. The empty tag set is enforced on the
saved plan, not just declared once: `validate-plan.sh` refuses any plan whose
resulting application user carries tags, is renamed, or gains unknown user
attributes, and the disposable smoke proves on a running broker that the
Management API refuses both identities.

- `control-api` dispatches jobs and consumes their outcomes. It may publish to
  `wotb.jobs`, and its read scope is exactly the result queue. The read regex is
  `^wotb\.parser\.result$`: it names `wotb.parser` and `wotb.parser.result`
  and rejects everything else, and `control-api` still cannot read
  `wotb.parser.retry` or `wotb.parser.dlq`. It may not declare topology. Routing
  keys are not part of a RabbitMQ ACL, so the write grant names the exchange
  rather than a routing key.
- `parser-worker` consumes only `wotb.parser`. It cannot consume the retry queue
  (that would defeat the broker-side delay), cannot read the DLQ, and cannot read
  the result queue — the worker must not consume its own reports back. Its write
  grant exists for exactly one reason: publishing a report to `wotb.jobs` with
  the `parser.result`, `parser.failed` or `parser.dead` routing key. Ack, nack
  and dead-lettering are not ACL-checked, so no further write surface is
  granted.

Neither identity may declare a queue or exchange: `configure = ^$` is the ACL
form of "the application is not a topology owner".

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
broker health, lockfile-derived provider mirror bootstrap, mirror-only
`init`/`validate`/saved plan, plan safety validation, apply, second clean plan,
then a root-only
`/opt/wotb-tx/rabbitmq.tofu-provisioned` marker. A provider
bootstrap/version/checksum failure, unhealthy broker, delete/replace
action, topology mutation, unknown address, or non-clean second plan fails
closed before readiness is reported.

The deployment derives the provider source, exact version and constraint from
`infra/tofu/rabbitmq/.terraform.lock.hcl`, which currently pins
`registry.opentofu.org/cyrilgdn/rabbitmq 1.10.1`. Bootstrap never downloads
into the production provider directory. It creates a temporary
`.rabbitmq-provider-staging.*` directory under the mirror root (same
filesystem, so promotion is a rename), runs
`tofu providers mirror -platform=linux_amd64` into it for that root, and only
promotes the staged provider directory to
`/opt/wotb-tx/tofu-provider-mirror/registry.opentofu.org/cyrilgdn/rabbitmq`
after the staging tree holds exactly the expected source/version/platform
archive plus a `${version}.json` metadata that names it, carries exactly one
`linux_amd64` `zh:` checksum, matches a `zh:` checksum committed in the
lockfile, and hashes to it. A download, version, metadata or checksum failure
leaves the canonical directory untouched, writes no marker, removes staging and
never reaches `tofu init`/`apply`.

An exact existing package is reused without another download only after that
same platform checksum is matched to the committed lockfile. If the canonical
directory holds the exact version with corrupt bytes, or is present without a
verifiable archive/metadata pair, the next run repairs it through one fresh
staged bootstrap and promotion, so an interrupted first bootstrap cannot poison
every later deployment; if the staged replacement itself fails to validate, the
previous canonical bytes are kept. Ambiguous states stay fail closed and are
never silently overwritten or deleted: a different Linux AMD64 version, or more
than one `linux_amd64` archive, aborts before any download. The actual init
still uses `deploy/tx/rabbitmq.tofurc`, whose `direct` block excludes RabbitMQ,
so it cannot fall back to the public registry.

The plan validator allows initial creates plus the two explicitly reviewed
in-place updates: rotating the application user passwords and changing the
vhost ACLs. It rejects every topology `update`, so a queue or exchange argument
change has to be an operator-reviewed replacement rather than a silent drift.

An allowed application-user update is effectively limited to credential
rotation, because the validator inspects the post-plan representation instead of
trusting the action name: the user must keep its exact expected name, must still
have an empty tag set, and must not carry any user attribute outside the known
`id`/`name`/`password`/`tags` set. Unknown values for those attributes are
rejected too, so an unprovable tag set fails closed. Sensitive passwords are
never inspected, so rotation keeps working.

The validator likewise holds each application ACL to the exact reviewed values
per resource address — `configure = ^$`, `write = ^wotb\.jobs$`, and
`read = ^wotb\.parser\.result$` for `control-api` or `read = ^wotb\.parser$`
for `parser-worker`. Any different post-plan value fails closed, so a widened
catch-all (`^wotb\..*$`, `^wotb.*$`, `^.+$`), a wrong-but-narrow regex, a removed
scope, `control-api` gaining read access to `wotb.parser.retry` or
`wotb.parser.dlq`, or any other move of the read boundary is refused. The second
plan must still be entirely no-op after those updates.

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

Before production use, an operator installs OpenTofu and Python. The deployment
owns installation of the exact locked RabbitMQ provider package into
`/opt/wotb-tx/tofu-provider-mirror`; no manual provider archive installation is
required. A bootstrap interrupted by a network or registry failure leaves only a
staging directory behind and never writes into the canonical provider directory,
so the operator recovery is to re-run the same deployment: it repairs a
damaged exact-version canonical package from staging instead of failing until
someone deletes the mirror by hand.
`deploy/tx/rabbitmq.tofurc` includes only that filesystem mirror for
the provider and explicitly excludes direct installation during init.

## Verification

RabbitMQ has exactly two test entry points. `infra/tofu/rabbitmq/test-validate-plan.sh`
pins the plan-safety policy against saved-plan fixtures: every topology
mutation, delete, replacement, unknown address, second-plan non-no-op, an
application user that gains `management`, `administrator` or `monitoring`, any
other non-empty or unprovable tag set, a renamed identity, extra identity
metadata, and — because the ACL contract is exact per resource address —
`^wotb\\..*$`, `^wotb.*$`, `^.+$`, a wrong-but-narrow regex, a removed scope, or
`control-api` reading anything other than `wotb.parser` and
`wotb.parser.result` (`wotb.parser.retry`, `wotb.parser.dlq`, and a widened
`^wotb\.parser.*$` are refused, and so is losing the result scope it now needs).
The result queue and both of its bindings have their own create, delete and
update fixtures, so the new topology is held to the same rules as the old one.

`deploy/test-rabbitmq-tofu.sh` owns everything else. It runs the native
`tofu fmt`/`tofu validate`, a small production-safety preflight for the shapes
native tooling accepts (TX-local state path, no out-of-band execution, Compose
must not declare topology, both TX deploy plan guards), proves the provider
source is mirror-only by failing closed with an emptied mirror, rejects a
corrupt mirrored package against the committed checksum, asserts the resolved
`cyrilgdn/rabbitmq 1.10.1` pin natively, and then applies against a temporary
RabbitMQ container. `deploy/test-tx-runtime-config.sh` separately covers fresh
staged bootstrap, exact-package reuse without a download, an interrupted
download that leaves no canonical partial provider, staged repair of a corrupt
exact-version package and of missing metadata, a failed repair that leaves the
canonical bytes unchanged, wrong-version and multiple-version fail-closed
behaviour without a silent replacement, the ordering of bootstrap before formal
mirror-only init, RabbitMQ-only secret isolation and the second-plan hard gate.
Against the real broker the smoke verifies the exchange,
queues, bindings and ACLs, requires a no-op second plan, and — because the
application identities carry no tags and therefore cannot reach the Management
API — exercises messaging over real AMQP with `pika`:

- both identities are refused by the Management API with
  `Not management user`, proving the empty tag set on the running broker;
- `control-api` publishes `parser.request` and `parser-worker` consumes it from
  `wotb.parser`;
- a job that `parser-worker` rejects with `nack(requeue=false)` travels through
  `wotb.parser.retry` and returns to `wotb.parser` with the matching `x-death`
  header;
- `parser-worker` parks a terminal failure on `wotb.parser.dlq` with the
  `parser.dead` routing key;
- the return path works end to end: `parser-worker` publishes `parser.result`
  and `parser.failed` and `control-api` consumes both from `wotb.parser.result`,
  with the right routing key preserved;
- a report the control plane rejects with `nack(requeue=false)` — through either
  binding — lands on `wotb.parser.dlq` with `parser.dead`, so the new queue's DLX
  is proven and not just declared;
- both application identities are refused when they declare a queue or
  exchange; `control-api` is refused when it reads `wotb.parser`,
  `wotb.parser.retry` or `wotb.parser.dlq`; `parser-worker` is refused when it
  reads the retry queue, the DLQ or the result queue; and either is refused when
  it publishes outside `wotb.jobs`.

The message contract itself has two more entry points, both inside
`java/wotb-broker-rabbitmq` and both part of `mvn -pl wotb-broker-rabbitmq test`:

- `ParserMessageContractTest` pins `contracts/mq/parser-messages.json` to the
  codec: the produced JSON property set must equal each envelope's schema
  `required` set, nested source items must stay inside their declared schema, and
  the schema `const` version must equal `ParserMessageCodec.SCHEMA_VERSION`.
  Without it the schema file would be a dead document.
- `ParserProtocolRabbitMQTest` drives the protocol on a real RabbitMQ
  Testcontainer at the production image tag. It declares the canonical topology
  *in the test fixture only* — production code must never declare it — and covers
  the envelope on the wire, manual ack waiting for the handler, duplicate and
  stale deliveries acknowledged without a DLQ visit, handler failure and
  undecodable bodies dead-lettered, the retry hop, and the `cancelQueued`
  contract. `@Testcontainers(disabledWithoutDocker = true)` keeps it a no-op
  where Docker is unavailable.
