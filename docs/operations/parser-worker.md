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
  retryable failure, and the terminal park described below for an undecodable
  delivery. `prefetch` (`PARSER_WORKER_PREFETCH`, default 2, aligned with
  `REPLAY_PARSE_MAX_CONCURRENT`) is the whole concurrency budget.
- **Canonical parsing.** It reuses `DefaultReplayProcessingFacade` and the
  artifact writers through the storage-agnostic `ReplayProcessingSourceRunner`.
  There is no second parser and no second artifact generator: the local control
  plane and the worker differ only in the `ReplayArtifactSink` they are given
  (`ReplayArtifactFileSink` on a job directory, the MinIO sink on Yecao), which
  is what makes their artifacts byte-identical.
- **Its own terminal judgement, and nothing more.** The worker decides between
  "retryable" and "terminal" from the delivery it was handed. Retry counters,
  attempt limits and the job lifecycle stay in PostgreSQL and belong to the
  control plane (see `docs/operations/rabbitmq.md`).

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
| Object storage read fails, or the outcome publish is not confirmed | whole-attempt failure | `parser.failed` with `retryable=true` | `basicNack(requeue=false)`; the request re-enters the broker-side retry loop through `wotb.parser.retry` (TTL 30000 ms) |
| Body the codec refuses | park the delivery **verbatim** on the DLQ, then finish it | none (no `jobId`/`attempt` exists to report) | `basicAck` |
| The park itself failed | nothing is acknowledged | none | `basicNack(requeue=false)`, so the delivery waits in the retry queue instead of disappearing |

Two properties are deliberate and load-bearing:

- **The report never contradicts the transport.** A failure that is being retried
  is reported `retryable=true`; a report claiming the attempt is final while the
  broker keeps re-delivering it would make the control plane mark a live attempt
  as terminal.
- **A poison message cannot spin.** Re-delivering undecodable bytes can never
  succeed, so that delivery is parked on `wotb.parser.dlq` with the `parser.dead`
  routing key — the terminal path `docs/operations/rabbitmq.md` reserves for the
  worker — instead of cycling through the retry queue forever.

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
are `RABBITMQ_*` and `MINIO_*`. Non-secret tuning (`PARSER_WORKER_*`) is listed
in `.env.example`.

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
| `event=parser_worker_infrastructure_failure` | retryable failure; the request returns through `wotb.parser.retry` |
| `event=parser_worker_undecodable_request` | terminal: the raw delivery was parked on `wotb.parser.dlq` |
| `event=parser_worker_terminal_park_failed` | the park itself failed; the delivery stays on the retry path |

Diagnosis order:

1. `rabbitmqctl list_queues name messages messages_unacknowledged` (TX) — a
   growing `wotb.parser` means the worker is not consuming (check liveness and
   `RABBITMQ_*`); a growing `wotb.parser.retry` means repeated infrastructure
   failures (check MinIO reachability and credentials).
2. `wotb.parser.dlq` is operator territory: it holds both undecodable deliveries
   parked by the worker and reports the control plane could not apply. Inspect a
   message with the Management API, fix the cause, then re-publish it to
   `wotb.jobs` with the routing key it originally carried (`parser.request` for a
   parked request). Nothing drains the DLQ automatically and nothing should.
3. MinIO: `temp/jobs/<jobId>/` objects expire after one day by lifecycle policy;
   a job whose objects are gone can only be re-uploaded, not re-parsed.

## Verification

- `ParserWorkerPipelineTest` (real RabbitMQ + real MinIO containers) pins the
  whole contract: byte-for-byte artifact parity between the local job-directory
  sink and the MinIO sink, the confirmed `parser.result`, the business-failure
  ack, the retryable failure landing in `wotb.parser.retry` with
  `retryable=true`, and the undecodable delivery parked on the DLQ with its
  original bytes and no retry copy.
- `scripts/ci/test-workflow-contract.sh` keeps `java/pom.xml` modules and the
  Dockerfile COPY lists in lockstep, including the `-pl wotb-parser-worker -am`
  dependency closure of the worker image.
- `deploy/test-deploy-contract.sh` pins the compose/deploy contract: no public
  port, no database credentials, the three required secrets, the liveness gate,
  and the fact that `all` does not start the service.
