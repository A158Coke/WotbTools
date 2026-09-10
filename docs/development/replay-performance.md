# Replay processing performance benchmark

This benchmark measures the existing Java replay pipeline locally without adding
an endpoint or touching production data. It is intentionally opt-in and uses
the committed fixtures when `common/data/` is not present.

## What is measured

The harness is `ReplayPerformanceBenchmarkTest` in `wotb-core` and measures four
stages:

1. `archive`: `ParsedReplay.read(bytes)`.
2. `parser`: a fresh `ParsedReplay.read(bytes)` followed by `ReplayParser.parse(parsed)`.
3. `reconstruction`: canonical read, settlement parse, and
   `ReplayReconstructionService.reconstruct(parsed, context)`.
4. `full`: the production core entrypoint
   `DefaultReplayProcessingFacade.process(source, ReplayProcessingOptions.full())`.

Replay bytes are read from disk once during discovery. Warmup and measurement
rounds reuse those byte arrays, so the benchmark is primarily parser/reconstruction
work rather than filesystem I/O.

Each replay is first validated through the canonical full pipeline. Accepted
replays then receive a correctness pass to establish a SHA-256 fingerprint of
the deterministic `AiReplayFacts` projection. Full-stage warmup and measurement
invocations must reproduce that fingerprint.

## Local run

The harness has two explicit modes. `quick` defaults to warmup 3 and
measurement 5 (and permits at most 10 measurement rounds); it is for repeated
candidate screening, not final performance claims. `full` defaults to warmup 5
and measurement 20 and rejects smaller settings; it is the confirmation mode.
Both modes use the same corpus validation and fingerprint parity by default.

From the repository root:

```powershell
cd java
mvn -s settings.xml -pl wotb-core -Dtest=ReplayPerformanceBenchmarkTest `
  -Dperformance=true -DbenchmarkMode=quick -Dstage=full -Dconcurrency=1 `
  -DargLine="-XX:ActiveProcessorCount=2 -Xms4g -Xmx4g" `
  -DwarmupRounds=3 -DmeasurementRounds=5 `
  -DjfrFile=build/performance/replay-full-c1.jfr test
```

Use `-DbenchmarkMode=full -DwarmupRounds=5 -DmeasurementRounds=20` for
confirmation. Do not compare a quick-screen result directly with a full-mode
result as proof of a performance change.

When `-DjfrFile` is supplied, all configured warmup rounds run before JFR
recording starts; the recording covers measurement rounds only. JFR startup
and class-retransformation samples can still appear around recording start,
so allocation percentages from separate recordings are directional evidence,
not an exact cross-file allocation budget.

For the real 40-replay corpus, pass its absolute path explicitly and verify
the corpus without running the timed matrix first:

```powershell
mvn -s settings.xml -pl wotb-core -Dtest=ReplayPerformanceBenchmarkTest `
  -Dperformance=true -DdiscoveryOnly=true `
  -DcorpusPath=C:/path/to/WotbTools/common/data `
  -DargLine="-XX:ActiveProcessorCount=2 -Xms4g -Xmx4g" test
```

`discoveryOnly=true` reports accepted/rejected files and establishes the
canonical full-pipeline fingerprints without producing throughput numbers.

The default corpus search is recursive:

```text
common/data/**/*.wotbreplay
```

Only when `corpusPath` is not set does the harness fall back to:

```text
common/fixtures/replays/**/*.wotbreplay
```

Override the corpus with `-DcorpusPath=<absolute-or-repository-relative-path>`.
An explicitly configured path is fail-closed: if it does not exist or contains
no `.wotbreplay` files, the benchmark fails instead of falling back to
fixtures. Every run prints and records the resolved corpus root, whether the
path was explicit, and the discovered/accepted file counts.
Use `-DargLine="-XX:ActiveProcessorCount=2 -Xms4g -Xmx4g"` when the result must
be comparable to the 2C/4GiB constrained-node baseline.
Use `-Dstage=all` to run archive, parser, reconstruction, and full stages in one
invocation. Use `-Dconcurrency=1`, then `2`, `3`, and `4` with the same corpus and
round settings for the local concurrency matrix. The executor is a bounded fixed
thread pool with an explicit bounded queue; it does not use `parallelStream`, the
common ForkJoin pool, or virtual threads.

Each run writes ignored artifacts to `build/performance/`:

```text
replay-performance-<timestamp>.json
replay-performance-<timestamp>.csv
replay-performance-<timestamp>.md
```

The JSON/CSV/Markdown include wall time, process CPU time, throughput, latency
percentiles, GC count/time, heap before/after, peak heap, corpus metadata, stage,
concurrency, and fingerprint verification counts.

## JFR analysis

The `-DjfrFile` option records the benchmark process using the JDK `profile`
configuration. Inspect it with the JDK 21 `jfr` command:

```powershell
jfr summary build/performance/replay-full-c1.jfr
jfr view hot-methods build/performance/replay-full-c1.jfr
jfr view allocation-by-class build/performance/replay-full-c1.jfr
jfr view allocation-by-site build/performance/replay-full-c1.jfr
jfr view gc-pauses build/performance/replay-full-c1.jfr
jfr view contention-by-site build/performance/replay-full-c1.jfr
```

Record the top CPU methods, allocation classes/stacks, GC pauses and time,
monitor contention, thread states, file I/O, and socket I/O in the benchmark
report. JFR evidence decides whether any optimization experiment is justified;
do not optimize the listed hypotheses by assumption.

Fingerprint parity is enabled by default. For a lower-overhead CPU/allocation
profile, run the JFR pass with `-DskipFingerprintVerification=true`; this keeps
the Jackson fingerprint codec out of the recording, but does not make the
recording startup-free or turn its allocation shares into exact proof. A
normal pass with the default parity setting must still be run and reported for
correctness.

## Optimization experiments

An optimization must use the same corpus, JVM, heap, warmup, measurement rounds,
and concurrency before and after the change. Compare full-pipeline throughput,
p50/p95, allocation/GC observations, peak heap, and the fingerprints. Keep an
optimization only when it provides meaningful throughput, allocation, or memory
benefit for its maintenance cost. Preserve ZIP safety limits and all replay
correctness semantics.

The benchmark must not enable AI, persistence, network, MQ, COS, or production
processing jobs. It must not add a performance endpoint. Do not use
`System.gc()` between replay operations.

## Production one-shot protocol

Production measurement is a separate owner-approved operation and is not run by
the implementation test. It must use an exact deployed commit/image and an
approved safe replay subset in a temporary location. Before running, record date,
uptime, load, free memory, container stats, and production container state. Run
only an isolated benchmark process for a few minutes, normally at concurrency
1/2/3 on the current 2C node.

The temporary script may verify the environment, launch the harness, capture
stdout/stderr and JFR, and copy results out. It must not stop/restart services,
change production configuration, write the database, call the public API, or
trigger AI. After copying and verifying the result files, remove the temporary
script, corpus, JFR, output directory, and benchmark container/artifact. Verify
that production containers are unchanged. Do not delete production files.

This worktree does not run that protocol or claim production capacity.
