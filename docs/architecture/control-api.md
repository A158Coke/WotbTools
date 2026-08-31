# Independent Control API

`java/wotb-control` is a separate Spring Boot artifact for future control-plane work. It is not a profile or replacement for `wotb-web`, and it does not import `wotb-core`, Spring AI, JPA/Hibernate, POI/export code, or worker implementations.

## Current POC surface

- `GET /actuator/health` is the public liveness/readiness surface.
- `GET /api/control/db` is protected by the `wotbtools-admin` role and runs a minimal `SELECT 1` through `JdbcClient`.
- The probe returns only `UP` or `DOWN`; JDBC exception text, connection details and credentials are not returned or logged.
- No `poc_job` table, Flyway migration, job CRUD or production compose wiring is introduced.
- `spring.threads.virtual.enabled` defaults to `true` and remains overrideable for the JVM/native comparison. Spring Boot 4.1 on Java 21 supports this property.

## Dependency and deployment boundary

The runtime artifact contains the contracts jar, Spring Web/Security resource-server, JDBC/PostgreSQL, Actuator, Micrometer and structured logging. It has no replay parser, AI, JPA or export dependency. A future container and deployment entry are intentionally deferred until the Native/JVM POC establishes the runtime decision.
