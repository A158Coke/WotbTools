# AI blocking-call Platform vs Virtual Thread benchmark

This is a manually enabled, real-provider benchmark for the AI worker thread
model. It is separate from replay CPU throughput and must not be combined with
the replay benchmark as a single performance claim.

## Contract

Each Platform/Virtual pair uses the same Java 25 runtime, model, prompt,
timeouts, HTTP client configuration, request count, machine and heap settings.
The prompt is intentionally tiny:

```text
Return exactly: OK
```

The default matrix is concurrency `1,2,5,10`, with two warmup requests and ten
measurement requests per variant. The experimental concurrency only controls
this benchmark executor. It does not change `REPLAY_PARSE_MAX_CONCURRENT`,
`max-concurrent-jobs`, AI production admission, queue capacity or token policy.

The report records end-to-end latency and provider-call latency at p50/p95/p99,
wall time, active/peak active requests, queue wait, task thread kind,
platform-thread count and reset per-variant platform peak, Java 25 virtual
thread scheduler parallelism/pool/mounted/queued counts and sampled peaks,
process CPU, heap, GC, failures, provider statuses and unexpected response
counts. `target/ai-vt-benchmark/` is ignored build output.

## Run

Use an out-of-band `AI_API_KEY`; never place it in the repository or command
history. Surefire excludes `ai-live` by default. From `java/`:

```powershell
$env:AI_API_KEY = "<provided out of band>"
$env:AI_MODEL = "deepseek-v4-flash"
mvn -s settings.xml -pl wotb-web -am test `
  "-Dtest=AiVirtualThreadBenchmarkTest" `
  "-Dai.probe.excludedGroups=" `
  "-Dai.vt.enabled=true" `
  "-Dai.vt.jfrFile=target/ai-vt-benchmark/ai-vt.jfr" `
  "-DargLine=-XX:ActiveProcessorCount=2 -Xms4g -Xmx4g"
```

The benchmark uses the same business admission limits in both variants. Platform
mode uses fixed platform workers. Virtual mode creates one virtual thread per
admitted task; a semaphore limits active upstream calls to `maxConcurrent` and
the admission semaphore limits active plus parked tasks to
`maxConcurrent + queueCapacity`. It does not run full replay analysis and does
not invoke the production controller. Warmup batches for every matrix point
complete before the optional JFR recording starts; the recording covers
measurement batches only.

The Spring Boot global setting `spring.threads.virtual.enabled` is a separate
policy for Spring-managed request/task infrastructure. Replay parsing remains
on bounded platform workers, replay export remains on bounded platform workers,
and the AI watchdog remains a platform scheduled executor. The explicit AI
worker admission gate is still bounded and is not the same as enabling global
Spring virtual threads.

## JFR interpretation

Inspect the Java 25 recording with the matching JDK 25 `jfr` command:

```powershell
jfr summary target/ai-vt-benchmark/ai-vt.jfr
jfr view hot-methods target/ai-vt-benchmark/ai-vt.jfr
jfr view thread-allocation-statistics target/ai-vt-benchmark/ai-vt.jfr
jfr print --events jdk.VirtualThreadPinned target/ai-vt-benchmark/ai-vt.jfr
```

The key question is whether blocking HTTPS waits park Virtual Threads without
material `jdk.VirtualThreadPinned` events. If pinning appears, fix only the
verified stack that holds the pin; do not replace synchronization primitives by
assumption.

Latency differences alone do not prove a Virtual Thread speedup because provider
load, generation speed, network RTT and output length vary. The primary result
is resource behavior at equal blocking concurrency; errors, queue behavior,
heap/GC and pinning must not regress.

The backend build uses Eclipse Temurin 25, an OpenJDK 25 distribution. The
Docker Official `openjdk:25-*` tags were checked and are not published, so the
repository must not invent those image names.

## 历史实测结果（2026，harness `AiVirtualThreadBenchmarkTest` 仍存在）

Salvaged verbatim from the deleted `docs/development/replay-performance-results.md` (section
"AI Platform vs Virtual Thread benchmark"). Only the host document was retired: it recorded the
server-side Java replay baseline (`ReplayParser`, `DefaultReplayProcessingFacade`, `ReplayHpTimeline`,
all deleted 2026-10-02 with the server-side parser). This measurement itself is independent of that
baseline — its input is real provider calls, not replay parsing, and the harness
`AiVirtualThreadBenchmarkTest` still exists. It is kept as a historical record; the 2026 run used an
earlier matrix (warmup 1, measurement 5, paired concurrencies `1,2,4`) than the `## Contract` / `## Run`
matrix above, so the two are not directly comparable. As stated at the top of this document, these
numbers must not be combined with replay CPU throughput into a single performance claim.

The separate real-provider benchmark was executed with Java 25, model
`deepseek-v4-flash`, fixed prompt `Return exactly: OK`, warmup 1, measurement 5,
and paired concurrencies `1,2,4`. Every request completed successfully with
the expected `OK` response and no provider errors/status failures. The JFR
contained zero `jdk.VirtualThreadPinned` events; blocking HTTPS calls parked
virtual threads without verified pinning.

| Concurrency | Variant | Wall ms | Total p50/p95/p99 ms | Provider p50/p95/p99 ms | Platform count / peak | VT scheduler peak pool/mounted/queued |
|---:|---|---:|---|---|---:|---|
| 1 | Platform | 3,846.6 | 2,228.9 / 3,845.0 / 3,845.0 | 776.1 / 939.5 / 939.5 | 24 / 25 | 2 / 1 / 0 |
| 1 | Virtual | 5,294.2 | 3,363.5 / 5,293.6 / 5,293.6 | 990.5 / 1,367.5 / 1,367.5 | 24 / 24 | 2 / 2 / 1 |
| 2 | Platform | 2,365.6 | 1,377.2 / 2,364.0 / 2,364.0 | 867.3 / 1,444.2 / 1,444.2 | 24 / 26 | 2 / 1 / 0 |
| 2 | Virtual | 2,469.2 | 1,650.0 / 2,468.8 / 2,468.8 | 830.5 / 986.0 / 986.0 | 24 / 24 | 2 / 2 / 4 |
| 4 | Platform | 1,726.6 | 1,237.9 / 1,725.7 / 1,725.7 | 1,007.3 / 1,723.8 / 1,723.8 | 24 / 28 | 2 / 1 / 0 |
| 4 | Virtual | 1,504.5 | 1,163.5 / 1,504.0 / 1,504.0 | 938.6 / 1,329.6 / 1,329.6 | 24 / 24 | 2 / 2 / 1 |

The small provider sample is noisy and is not a DeepSeek speedup claim. The
reliable result for this run is resource behavior: platform mode created no
virtual tasks and increased the reset per-variant platform peak by up to four;
virtual mode created one VT per request, held active work at the requested
concurrency, and kept platform-thread count at the 24-thread baseline. The
benchmark did not change production admission values or replay concurrency.
