# Control API JVM / Native POC

Date: 2026-08-31

## Scope and environment

The comparison covers the independent `wotb-control` artifact, Spring Web/Security resource server, JdbcClient/PostgreSQL, Actuator and structured logging. RabbitMQ, COS, AI and Replay are not part of this POC and remain `DEFER`.

- Host: Windows 11, Docker 29.7.2, 16 vCPU container limit, 15.25 GiB memory host.
- JVM build: Maven package with the repository's Java 21 toolchain (`C:\Users\yu.chen\.jdks\jdk-21.0.1`).
- Native build: `ghcr.io/graalvm/native-image-community:25`, GraalVM CE 25.0.2, Java 25.0.2, x86-64-v3, Serial GC.
- Native build used Spring Boot `process-aot` and a one-time reflection reachability input for generated AOT initializer classes. That input was deleted after the build and is not part of the module.

## Results

| Check | JVM | Native |
|---|---|---|
| Maven/package | PASS | n/a (native-image command) |
| Artifact size | `wotb-control.jar` produced; exact fat-jar size not used as a decision metric | 96,799,816 bytes |
| Startup | PASS, independent fat jar started in 9.54 s inside the GraalVM 21 container; direct host launch was additionally blocked by this environment's loopback restriction | PASS, AOT app started in 2.27 s inside GraalVM 25 container |
| HTTP management surface | covered by application configuration and endpoint implementation | PASS, `/actuator/health` returned HTTP 503 with sanitized `{"groups":["liveness","readiness"],"status":"DOWN"}` without PostgreSQL |
| DB `UP` path | PASS in JdbcClient unit contract; no external PostgreSQL was attached | Not run; same code path is compiled but no database was attached |

## Decision

For this foundation POC, keep the independent Control API source and contracts as `KEEP`. Keep Native as a reproducible feasibility result, but do not select it for production yet: the current module is built against Java 21 while Spring Boot 4.1 Native runtime requires Java 25, and the POC did not include a PostgreSQL-backed load test or cold/steady-state RSS/P50/P95/P99 comparison. The next decision gate must use a Java 25 build/runtime line or record an intentional platform upgrade.

The current Dual-Cloud implementation should therefore continue with the JVM + virtual-threads path unless a later Java 25 Native benchmark meets the production SLOs. RabbitMQ publisher-confirm/reconnect, COS presigned PUT/GET/HEAD and cross-cloud AI streaming are `DEFER`; no SDK, dummy controller, test credential, benchmark config or temporary RuntimeHints remain in the production module.
