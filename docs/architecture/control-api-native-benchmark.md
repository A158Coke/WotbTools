# Control API JVM / Native POC benchmark

Generated: 2026-08-31T14:05:01Z

## Reproduction

From a clean checkout with Docker available:

```bash
CONTROL_POC_REQUESTS=100 CONTROL_POC_WORKLOAD_PAUSE_SEC=0.02 bash tools/control-native-benchmark.sh
```

The script builds both images with `--no-cache`, starts the same Control API against a real PostgreSQL 18 container, waits for the independent management health endpoint, then sends the health workload. The health workload exercises Spring Boot Actuator and the JDBC-backed health indicator; the PR E integration test separately covers the protected `JdbcClient SELECT 1` endpoint and security roles.

The POC build images use JDK 25 because this Spring Boot Native Build Tools path requires it; Maven still compiles the Control API with the repository's Java 21 release target. This isolated POC build choice does not change the project's Java 21 baseline or production runtime.

The default 0.02-second inter-request pause keeps the workload long enough for in-flight Docker stats sampling; per-request latency excludes this pause. Override it with CONTROL_POC_WORKLOAD_PAUSE_SEC when reproducing the benchmark.

PostgreSQL uses Docker-network-local trust authentication only. No production credentials or configuration are used.

## Results

| Variant | Build duration (ms) | Image size (bytes) | Cold start from docker run (ms) | Latency | Idle CPU / RSS | Load CPU / RSS (sampled during requests) | Ports |
|---|---:|---:|---:|---|---|---|---|
| jvm build | 321116 | 367920983 | — | — | — | — |
| native build | 267147 | 181326339 | — | — | — | — |
| JVM runtime | — | — | 6647 | P50=4.802ms P95=6.912ms P99=8.516ms | CPU(max)=4.27% RSS(max)=320.4MiB samples=1 | CPU(max)=40.12% RSS(max)=323.4MiB samples=2 | 18090 / 18091 |
| Native runtime | — | — | 715 | P50=1.622ms P95=2.044ms P99=2.345ms | CPU(max)=0.26% RSS(max)=73.0MiB samples=1 | CPU(max)=5.24% RSS(max)=73.0MiB samples=2 | 18092 / 18093 |

## Decision

Both JVM and Native Image clean builds and DB-backed workloads completed. Native Image is the preferred runtime foundation for the next comparison step based on the measured cold-start, latency and resource results above; production deployment adoption remains DEFERRED outside this POC.

## Disposition

| Artifact | Disposition | Reason |
|---|---|---|
| `java/wotb-control/pom.xml` native profile | KEEP | Reproducible AOT/native build configuration for the isolated POC path |
| `docker/Dockerfile.control-jvm` | KEEP | Reproducible JVM comparison build for the same Control API |
| `docker/Dockerfile.control-native` | KEEP | Reproducible Native Image build foundation for a future Control API deployment |
| `tools/control-native-benchmark.sh` | KEEP | Reproducible, benchmark-only DB-backed workload harness; not part of a production module |
| Generated `target/` classes, native executable and local Docker images | REMOVE after each run | Build outputs are not source or production artifacts |
| Docker-network PostgreSQL container and trust-auth settings | REMOVE after each run | Ephemeral benchmark resources; never production configuration |
| RabbitMQ/COS integration | DEFER | Explicitly outside this minimal Native POC |
