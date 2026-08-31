# Async contracts boundary

`java/wotb-contracts` is the future async-domain boundary for the Dual-Cloud plan. It is a JDK-only Maven artifact and currently has no caller in `wotb-web`; adding it does not switch the existing replay processing path.

## Contract rules

- `JobRequestedEvent` carries only `eventId`, `jobId`, `batchId`, `jobType`, `objectKey`, `createdAt` and `attempt`.
- `JobSucceeded` carries a result artifact key; `JobFailed` carries a stable error code and retryability. Neither callback embeds replay bytes, parsed JSON, prompt data or provider responses.
- `JobDispatcher` and `ObjectStorage` are ports. RabbitMQ/COS implementations belong to later adapter modules in the approved Dual-Cloud plan.
- `JobStatus` is future-domain vocabulary only: `QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Current Web/Android DTOs keep their existing status vocabulary, including `READY`. `CurrentProcessingStatusAdapter` is the only mapping boundary (`READY → SUCCEEDED`, `PENDING → QUEUED`). No current public DTO imports `JobStatus`.

## Verification

The module's dependency tree contains only JUnit in test scope; production classes use JDK types only. Contract tests cover identifier validation, metadata-only events and the explicit current/future status mapping.
