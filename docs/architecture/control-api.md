# Independent Control API

`java/wotb-control` is a separate Spring Boot artifact for future control-plane work. It is not a profile or replacement for `wotb-web`, and it does not import `wotb-core`, Spring AI, JPA/Hibernate, POI/export code, or worker implementations.

## Current POC surface

- `GET /actuator/health` is the public liveness/readiness surface.
- `GET /api/control/db` is protected by the `wotbtools-admin` role and runs a minimal `SELECT 1` through `JdbcClient`.
- The probe returns only `UP` or `DOWN`; JDBC exception text, connection details and credentials are not returned or logged.
- No `poc_job` table, Flyway migration, job CRUD or production compose wiring is introduced.
- `spring.threads.virtual.enabled` defaults to `true` and remains overrideable for the JVM/native comparison. Spring Boot 4.1 on Java 25 supports this property.

The acceptance test starts the real Spring Boot application against a PostgreSQL Testcontainers instance, verifies `JdbcClient` with `SELECT 1`, and exercises the actual HTTP security boundary. It allocates an independent management port, keeps health public, and requires the admin role for metrics and the control probe; it does not use a fake health controller or a mocked database as the final acceptance path.

## Production control plane: single TX backend runtime

The production replay control plane (`POST/GET/DELETE/GET .../result` on
`/api/replay/processing-jobs`) is **not** served by this artifact. It runs inside the
existing `wotb-web` deployment, gated by `wotb.replay.execution.mode=distributed`
(`ReplayDistributedConfig`). That is a deliberate reuse decision: the control plane
needs the replay domain, the PostgreSQL job authority, MinIO object storage and the
AMQP parser protocol — all of which `wotb-web` already owns — while this POC artifact
deliberately has none of them, so hosting the control plane here would mean growing a
second backend rather than sharing one.

`java/wotb-control` therefore stays a **non-production** artifact. Its POC surface,
its independent management port, its security boundary and its Native/JVM benchmark
results (see `control-api-native-benchmark.md`) remain valid evidence, but it is not a
second control-plane implementation to keep in sync with `wotb-web`. The distributed
execution plane, including the control-plane-owned retry policy, is documented in
`docs/DEVELOPER_GUIDE.md` and `docs/operations/parser-worker.md`.

## Dependency and deployment boundary

The runtime artifact contains the contracts jar, Spring Web/Security resource-server, JDBC/PostgreSQL, Actuator, Micrometer and structured logging. It has no replay parser, AI, JPA or export dependency. The Native/JVM POC comparison and disposition are recorded in `control-api-native-benchmark.md`; production container wiring and deployment remain intentionally deferred outside the POC.
