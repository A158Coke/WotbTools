# Control API JVM / Native POC benchmark

Generated: 2026-08-31T13:20:20Z

## Reproduction

From a clean checkout with Docker available:

```bash
CONTROL_POC_REQUESTS=100 bash tools/control-native-benchmark.sh
```

The script builds both images with `--no-cache`, starts the same Control API against a real PostgreSQL 18 container, waits for the independent management health endpoint, then sends the health workload. The health workload exercises Spring Boot Actuator and the JDBC-backed health indicator; the PR E integration test separately covers the protected `JdbcClient SELECT 1` endpoint and security roles.

The POC build images use JDK 25 because this Spring Boot Native Build Tools path requires it; Maven still compiles the Control API with the repository's Java 21 release target. This isolated POC build choice does not change the project's Java 21 baseline or production runtime.

PostgreSQL uses Docker-network-local trust authentication only. No production credentials or configuration are used.

## Results

| Variant | Build duration (ms) | Image size (bytes) | Startup after container launch (ms) | Latency | CPU / RSS sample | Ports |
|---|---:|---:|---:|---|---|---|
| jvm build | 59951 | 367920984 | — | — | — | — |
| native build | 210034 | 181326339 | — | — | — | — |
| JVM runtime | — | — | 6103 | P50=5.342ms P95=9.036ms P99=9.959ms | 0.19% | 354.9MiB / 15.25GiB / 18090 |
| Native runtime | — | — | 123 | P50=1.690ms P95=2.058ms P99=2.223ms | 0.03% | 71.16MiB / 15.25GiB / 18092 |

## Decision

Both paths were reproduced from the checkout with clean Docker build caches. The Native Image path is complete as a POC and is the preferred foundation for the future Control API runtime comparison: it had lower startup, lower sampled RSS/CPU, lower request latency, and a smaller image in this workload. This is a POC result only; production deployment adoption remains outside PR F.

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
