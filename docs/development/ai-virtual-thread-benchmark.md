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
