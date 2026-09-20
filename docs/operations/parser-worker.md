# Yecao parser worker (execution plane)

The parser worker is the only component that runs replay parsing. It is an
execution plane, not a state authority:

```text
PostgreSQL (TX) = authoritative job state     -> owned by the TX control plane
RabbitMQ   (TX) = asynchronous delivery       -> worker consumes wotb.parser
MinIO    (Yecao) = temporary job workspace    -> worker reads input, writes artifacts
```

The worker holds no database credentials, exposes no HTTP endpoint and keeps no
job state. A restart loses nothing that matters: every key it writes derives from
`(jobId, sourceIndex)` and every write is an idempotent overwrite.

## What the worker owns

- **Transport semantics.** Manual ack on `wotb.parser`: `basicAck` only after the
  outcome reached a confirmed broker state, `basicNack(requeue=false)` for a
  retryable failure while the delivery budget lasts, and the terminal park
  described below otherwise.
- **Concurrency.** `PARSER_WORKER_CONCURRENCY` (default 2, aligned with
  `REPLAY_PARSE_MAX_CONCURRENT`) is the number of AMQP consumers, i.e. how many
  replays are parsed in parallel. `PARSER_WORKER_PREFETCH` (default 1) is only the
  per-consumer unacked backlog: raising it on a single consumer adds **no**
  parallelism, it only widens the redelivery window after a crash. Both bounds are
  set explicitly on the container (`concurrentConsumers` = `maxConcurrentConsumers`
  = concurrency), so the parallelism cannot drift with load.
- **Canonical parsing.** It reuses `DefaultReplayProcessingFacade` and the
  artifact writers through the storage-agnostic `ReplayProcessingSourceRunner`.
  There is no second parser and no second artifact generator: the local control
  plane and the worker differ only in the `ReplayArtifactSink` they are given
  (`ReplayArtifactFileSink` on a job directory, the MinIO sink on Yecao), which
  is what makes their artifacts byte-identical.
- **Its own terminal judgement, and nothing more.** The worker decides between
  "retryable" and "terminal" from the delivery it was handed (see *Retry
  authority*).

It does **not** own the RabbitMQ topology (`infra/tofu/rabbitmq` is the single
owner; the worker declares nothing at startup) and it does not own job state.

## Request lifecycle

```text
parser.request on wotb.parser
  -> ObjectStorageKeys.tempJobObject(jobId, "input/<i>/<name>")   MinIO GET
  -> DefaultReplayProcessingFacade.process(source, full)         canonical parse
  -> artifacts/<i>/{ai-facts,map-overview,battle-playback-v2}.json  MinIO PUT
  -> result/source-<i>.json                                      canonical dataset (PR F)
  -> parser.result (confirmed) | parser.failed (confirmed)
  -> basicAck
```

Object layout below `temp/jobs/<jobId>/` is owned by
`ObjectStorageKeys.tempJobObject(...)`; the worker never invents a prefix.

## Failure semantics

| Situation | Worker action | Wire report | Delivery |
|---|---|---|---|
| Canonical parser rejects the replay bytes | per-source `FAILED` with a stable error code | `parser.result` | `basicAck` — re-running the same bytes cannot change the result |
| Input read fails, **or an artifact write fails after a successful parse** | whole-attempt failure (the bytes were fine; object storage was not) | `parser.failed` with `retryable=true`, same `jobId` and same `attempt` | `basicAck` **after** the report is confirmed; the control plane decides whether to retry |
| **`parser.result` publish is uncertain** (confirm lost, timed out, NACKed, unroutable) | nothing is settled and **no second outcome is invented** — an uncertain confirm does not prove the result was not routed | none | **no ack and no nack**: the transport redelivers the same attempt, and the worker reproduces the same `parser.result` |
| The failure report cannot be delivered (lost confirm, broker down) | nothing is settled | none | **no ack and no nack**: the transport redelivers the *same* attempt |
| Body the codec refuses | park the delivery verbatim, then finish it | none (no `jobId`/`attempt` exists to report) | `basicAck` after the park is confirmed |
| The park itself cannot be delivered | nothing is settled | none | no ack and no nack; the transport redelivers |

The **artifact-write** row is the one worth spelling out, because the canonical
runner reports a sink `IOException` as a per-source failure
(`PROCESSING_JOB_STORAGE_UNAVAILABLE`) — the right shape for the local control
plane, whose sink is a job directory on the same host. In the worker the same
`IOException` means the infrastructure is unavailable: the replay was readable
and the parse succeeded. Turning that into a terminal per-source `FAILED` would
record a transient outage as an unparseable replay forever, so
`ParserRequestHandler` converts that one classification back into an
infrastructure failure and the delivery leaves through the retryable path
instead. Both failures keep the same wire code
(`PARSER_WORKER_STORAGE_UNAVAILABLE`) because they are the same fact.

Three further properties are deliberate and load-bearing:

- **An uncertain outcome is never converted into a second outcome.** A lost or
  timed-out confirm for `parser.result` does not prove the broker did not route
  it. Reporting `parser.failed` as well would give one `(jobId, attempt)` two
  contradictory outcomes, and a control plane that consumed the failure first
  would advance the attempt while the valid result became stale. So
  `PARSER_OUTCOME_NOT_DELIVERED` no longer exists as a wire code: the worker
  publishes nothing, acknowledges nothing and rejects nothing, and the redelivered
  attempt simply reproduces the same `parser.result`. The control plane is required
  to apply duplicate same-attempt results idempotently (PR E).
- **The report never contradicts the transport.** A failure the control plane may
  yet retry is reported `retryable=true`; the worker never claims an attempt is
  final on its own.
- **Nothing is acknowledged before its report is confirmed.** If the report did
  not reach the broker, the request stays unacknowledged, so AMQP redelivery
  brings the same attempt back instead of leaving a job that no outcome will ever
  reach.
- **The worker never creates a logical retry.** It does not reject a request into
  the retry loop: retrying is a control-plane decision (see below).

## Retry policy is control-plane owned

**RabbitMQ must not autonomously retry parser work.** The worker therefore never
rejects a request into the `wotb.parser` → `wotb.parser.retry` → TTL →
`parser.request` loop, and never routes a job through `wotb.parser.retry`
intentionally. The flow for an infrastructure failure is:

```text
worker receives parser.request (attempt = N)
  -> infrastructure failure
  -> publish parser.failed { jobId, attempt = N, retryable = true }   (confirmed)
  -> basicAck the original parser.request
  -> control plane (PR E) reads authoritative PostgreSQL state and decides:
       job still active? current attempt still N? cancelled/expired? budget left?
       yes -> atomically advance attempt to N + 1 and dispatch a NEW parser.request
       no  -> transition job/source to the appropriate terminal state
```

Two concepts that must never be conflated:

- **logical retry** = a new control-plane dispatch with `attempt + 1`. Only the
  control plane can create one, because only it holds the authoritative job state.
- **transport redelivery** = the *same* attempt arriving again, solely because the
  original delivery was never acknowledged (worker crash between publish and ack,
  connection loss, undeliverable report). The worker relies on it and preserves
  the attempt unchanged.

Consequences the worker is responsible for:

- It publishes the report for the **same** `jobId` and `attempt` it received, and
  acknowledges only once that report is confirmed.
- If the report cannot be delivered, it acknowledges nothing: ordinary AMQP
  connection/channel redelivery brings the same attempt back.
- It owns no retry counter, no retry budget and no job state — and no database
  credentials. Retry authority belongs to PostgreSQL through the control plane.

The `wotb.parser.retry` queue and its TTL/DLX bindings remain in the reviewed
topology for compatibility with the PR C protocol and for the control plane's own
use; the worker simply does not use them. Their removal is a separate cleanup
after PR E is live. PR E must also ACK and ignore duplicate or stale
`parser.failed` reports for attempts that are no longer current.

## Deployment (Yecao)

| Item | Value |
|---|---|
| Image | `ghcr.io/a158coke/wotbtools-parser-worker:sha-<12>` (`docker/Dockerfile.parser-worker`, `BUILD_COMMIT` injected) |
| Compose service | `parser-worker` in `deploy/docker-compose.prod.yml` |
| Public port | none |
| Dependencies | TX broker over WireGuard (`10.20.0.1:5672`, vhost `/wotbtools`) and Yecao MinIO (`10.20.0.2:9000`) |

The service is **selected explicitly** and is deliberately absent from the `all`
service set while the legacy Yecao application stack is still running, so an
existing whole-stack deploy neither starts it nor begins demanding its
credentials:

```bash
WOTB_DEPLOY_SERVICES=parser-worker WOTB_DEPLOY_IMAGE_SERVICES=parser-worker bash deploy/deploy.sh
```

`deploy/deploy.sh` fails closed on three secrets whenever `parser-worker` is
selected: `TX_RABBITMQ_PARSER_WORKER_PASSWORD`,
`YECAO_MINIO_WORKER_ACCESS_KEY`, `YECAO_MINIO_WORKER_SECRET_KEY`. They map to the
`parser-worker` RabbitMQ user (`infra/tofu/rabbitmq`) and the `worker` MinIO
identity (`infra/tofu/minio`); the runtime variable names inside the container
are `RABBITMQ_*` and `MINIO_*`. Non-secret tuning
(`PARSER_WORKER_CONCURRENCY`, `PARSER_WORKER_PREFETCH`,
`PARSER_WORKER_CONFIRM_TIMEOUT_SEC`, `PARSER_WORKER_SHUTDOWN_TIMEOUT_SEC`,
`PARSER_WORKER_MINIO_*`) is listed in `.env.example`; there is deliberately no
retry-budget setting, because retry policy belongs to the control plane.

Because the worker has no HTTP endpoint, its deployment gate is container
liveness: if it does not stay up (missing credential, unreachable broker), the
deployment fails and the service is stopped so a crash loop cannot run away.

## Operating it

Log events to look for (`docker compose logs -f parser-worker` on Yecao):

| Event | Meaning |
|---|---|
| `event=parser_worker_input_read` | an input object was read; `bytes=` is the size that was parsed |
| `event=parser_worker_source_failed` | canonical parser rejected one source (business failure, request still acked) |
| `event=parser_worker_dataset_written` | the canonical dataset object was stored |
| `event=parser_worker_artifact_storage_failed` | the parse succeeded but an artifact write failed (infrastructure, retryable) |
| `event=parser_worker_outcome_publish_uncertain` | `parser.result` could not be confirmed; nothing was reported or acknowledged and the attempt will be redelivered |
| `event=parser_worker_infrastructure_failure` | reported `parser.failed(retryable=true)` and acked; `retryDecision=control-plane` |
| `event=parser_worker_failure_report_undelivered` | the report could not be published; the request stays unacknowledged and will be redelivered with the same attempt |
| `event=parser_worker_undecodable_request` | the raw delivery was parked on `wotb.parser.dlq` |
| `event=parser_worker_terminal_park_undelivered` | the park could not be published; the delivery stays unacknowledged |

Diagnosis order:

1. `rabbitmqctl list_queues name messages messages_unacknowledged` (TX) — a
   growing `wotb.parser` means the worker is not consuming (check liveness and
   `RABBITMQ_*`); a growing `wotb.parser.retry` is a control-plane concern, since
   the worker never publishes there.
2. `wotb.parser.dlq` is operator territory: it holds undecodable deliveries and
   reports the control plane could not apply. Inspect a message with the
   Management API, fix the cause, then re-publish it to `wotb.jobs` with the
   routing key it originally carried (`parser.request` for a parked request).
   Nothing drains the DLQ automatically and nothing should.
3. MinIO: `temp/jobs/<jobId>/` objects expire after one day by lifecycle policy;
   a job whose objects are gone can only be re-uploaded, not re-parsed.

## Verification

- `ParserWorkerPipelineTest` (real RabbitMQ + real MinIO containers) pins the
  whole contract: byte-for-byte artifact parity between the local job-directory
  sink and the MinIO sink, the confirmed `parser.result`, the business-failure
  ack, an **artifact-write failure reported as a retryable infrastructure failure
  with no terminal per-source verdict and nothing in `wotb.parser.retry`**, an
  **uncertain `parser.result` publish settling nothing at all and keeping the same
  attempt**, a **duplicate same-attempt result being allowed through redelivery**,
  an **undeliverable report leaving the request unacknowledged with the transport
  redelivering the same attempt**, the undecodable delivery parked with its
  original bytes, and the real broker reporting `concurrency` consumers for the
  started container.
- `ParserWorkerContainerContractTest` pins the container wiring (work queue only,
  manual ack, the worker listener, reviewed defaults) without a broker.
- `scripts/ci/test-workflow-contract.sh` keeps `java/pom.xml` modules and the
  Dockerfile COPY lists in lockstep, including the `-pl wotb-parser-worker -am`
  dependency closure of the worker image.
- `deploy/test-deploy-contract.sh` pins the compose/deploy contract: no public
  port, no database credentials, the three required secrets, the liveness gate,
  and the fact that `all` does not start the service.
