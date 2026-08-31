# Independent Control API

`java/wotb-control` is a separate Spring Boot artifact for future control-plane work. It is not a profile or replacement for `wotb-web`, and it does not import `wotb-core`, Spring AI, JPA/Hibernate, POI/export code, or worker implementations.

## Current POC surface

- `GET /actuator/health` is the public liveness/readiness surface.
- `GET /api/control/db` is protected by the `wotbtools-admin` role and runs a minimal `SELECT 1` through `JdbcClient`.
- The probe returns only `UP` or `DOWN`; JDBC exception text, connection details and credentials are not returned or logged.
- No `poc_job` table, Flyway migration, job CRUD or production compose wiring is introduced.
- `spring.threads.virtual.enabled` defaults to `true` and remains overrideable for the JVM/native comparison. Spring Boot 4.1 on Java 21 supports this property.

The acceptance test starts the real Spring Boot application against a PostgreSQL Testcontainers instance, verifies `JdbcClient` with `SELECT 1`, and exercises the actual HTTP security boundary. It allocates an independent management port, keeps health public, and requires the admin role for metrics and the control probe; it does not use a fake health controller or a mocked database as the final acceptance path.

## Dependency and deployment boundary

The runtime artifact contains the contracts jar, Spring Web/Security resource-server, JDBC/PostgreSQL, Actuator, Micrometer and structured logging. It has no replay parser, AI, JPA or export dependency. The Native/JVM POC comparison and disposition are recorded in `control-api-native-benchmark.md`; production container wiring and deployment remain intentionally deferred outside the POC.
