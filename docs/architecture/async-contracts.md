# Async contracts boundary

`java/wotb-contracts` is the future async-domain boundary for the Dual-Cloud plan. It is a JDK-only Maven artifact and currently has no caller in `wotb-web`; adding it does not switch the existing replay processing path.

## Contract rules

- `JobRequestedEvent` carries only `eventId`, `jobId`, `batchId`, `jobType`, `objectKey`, `createdAt` and `attempt`.
- `JobSucceeded` carries a result artifact key; `JobFailed` carries a stable error code and retryability. Neither callback embeds replay bytes, parsed JSON, prompt data or provider responses.
- `JobDispatcher` and `ObjectStorage` are ports. RabbitMQ/COS implementations belong to later adapter modules in the approved Dual-Cloud plan.
- `JobStatus` is future-domain vocabulary only: `QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Current Web/Android DTOs keep their existing status vocabularies, implemented by `ReplayProcessingJob.Status` (`QUEUED/PROCESSING/READY/FAILED/CANCELLED`) and `ReplayProcessingJob.SourceStatus` (`PENDING/PROCESSING/READY/FAILED`). The explicit `CurrentProcessingStatusAdapter` lives in `wotb-web` and binds directly to those real enums; it never merges job `QUEUED` with source `PENDING`, and rejects future `CANCELLED` when the target source contract cannot represent it. No current public DTO imports `JobStatus`.

- `WorkerCallback` is a sealed JVM type distinction only. A future transport/routing adapter owns any JSON discriminator or message-type header; this foundation does not introduce RabbitMQ/COS or freeze a broker envelope.
- The nested JSON representation of current identifier records (`EventId`, `JobId`, `BatchId`, `ObjectKey`) is not a formal wire contract in this phase. Serialization tests assert semantic round-trip of each concrete record, not nested property paths, field ordering, or a transport envelope; a future routing/serialization adapter must explicitly define those details.

## Verification

The module's production dependency tree is JDK-only; Jackson is test-scoped solely for concrete callback/event serialization round-trips. Contract tests cover identifier validation, metadata-only events and callback serialization; the Web module tests the exhaustive mappings against the real current enums.
