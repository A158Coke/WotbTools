# Local replay performance results

This is the local result of the opt-in benchmark on 2026-09-09. It is a
measurement record, not a production capacity guarantee. Production benchmark
was not run.

## Environment and corpus

- Commit under test: `01521fa9bfbbbf62013f91eba365e94608962a25`
- Java: Oracle JDK 21.0.1
- OS: Windows 11; 16 available processors
- Heap: 500 MiB initial, 8 GiB maximum
- Corpus: 3 committed fixtures under `common/fixtures/replays/`
- Corpus bytes: 3,841,569 bytes; min 944,399; median 1,264,822; max 1,632,348
- All 3 fixtures passed canonical full processing and deterministic SHA-256
  fingerprint parity

The local checkout did not contain `common/data/`, so the harness correctly
used its documented fixture fallback. The measured production-core entrypoint
was `DefaultReplayProcessingFacade.process(Source, ReplayProcessingOptions.full())`.

## Final c1 stage breakdown

Warmup was 5 rounds and measurement was 20 rounds. Each measured operation used
the already loaded replay bytes.

| Stage | Replays/s | Mean ms | P50 ms | P95 ms | GC count/time | Peak heap |
|---|---:|---:|---:|---:|---:|---:|
| Archive / canonical read | 84.661 | 11.716 | 11.374 | 15.630 | 4 / 4 ms | 255 MiB |
| Parser | 74.523 | 13.339 | 13.684 | 18.623 | 4 / 4 ms | 253 MiB |
| Reconstruction | 33.294 | 29.936 | 29.456 | 39.432 | 8 / 21 ms | 416 MiB |
| Full production core | 25.804 | 38.632 | 37.021 | 53.970 | 11 / 23 ms | 1,394 MiB |

The full stage processed 60 measured operations and verified 60 fingerprints.

## Concurrency matrix

These runs use the same corpus, JDK, 5/20 rounds, bounded executor, and default
fingerprint parity. The first four rows are the pre-optimization baseline on
the final harness; the last row is the same c3 run after the low-risk map
lookup change.

| Version | C | Replays/s | P50 ms | P95 ms | GC count/time |
|---|---:|---:|---:|---:|---:|
| Baseline | 1 | 23.667 | 39.214 | 55.891 | 7 / 27 ms |
| Baseline | 2 | 37.878 | 44.826 | 61.075 | 1 / 3 ms |
| Baseline | 3 | 49.280 | 49.344 | 63.667 | 22 / 40 ms |
| Baseline | 4 | 43.628 | 53.962 | 75.995 | 3 / 9 ms |
| Candidate | 3 | 51.009 | 46.033 | 61.075 | 4 / 11 ms |

The c3 candidate is about `+3.51%` throughput over its same-run baseline. c3
was the best local concurrency; c4 regressed, indicating oversubscription or
contention on this machine.

## JFR findings

The clean, extended JFR recording used warmup 20, measurement 100, c1, and
disabled fingerprint serialization only for profiling. Normal benchmark runs
keep parity enabled. The recording was 17 seconds long.

Top workload CPU samples were:

1. `ReplayPacketDecoderRegistry.decode` — 8.82%
2. `BattleStateReconstructor.reconstruct` — 7.30%
3. `ReplayHpTimeline.eventTime` — 6.80%
4. `SupremacyBaseStateReconstructor` lambda — 6.30%
5. `TeamPerspectiveResolver` lambda — 5.79%
6. `HashMap.put` / `HashMap.computeIfAbsent` — 5.54% / 5.04%
7. `ReplayPacketStreamReader.scan` — 4.03%

Sampled allocation was mainly `byte[]` (57.18%), `Object[]` (7.80%),
`RawReplayPacket` (6.65%), `VehicleState` (4.20%),
`PositionChangedEvent` (2.64%), and `ReplayDecodeResult` (1.97%). The largest
workload allocation sites were `Arrays.copyOf(byte[])` (30.16%),
`RawReplayPacket.payload()` (8.71%), `PositionDecoder.decode` (7.56%), and
`ReplayPacketStreamReader.scan` (6.65%). JIT-generated ASM allocation remained
visible in the recording and is excluded from the replay interpretation.

GC pause time was 1.01 s across 277 pauses; median pause 2.92 ms, p95 9.41 ms,
maximum 14.1 ms. No meaningful monitor contention, socket I/O, or replay file
I/O was recorded.

## Hypothesis decisions

- `Protobuf.readVarint()` `long[]` allocation was not a top sampled allocation;
  no speculative primitive parser rewrite was made.
- Generic protobuf byte-array/copy pressure is real evidence, but a broad
  wire-model rewrite was not justified by this corpus and was not attempted.
- `RawReplayPacket` and event materialization are measurable but not dominant
  enough to justify a streaming reconstruction rewrite without a dedicated
  parity-preserving prototype.
- The `ReplayReconstructionService` type statistics double lookup was replaced
  with one `computeIfAbsent` result; the c3 AB result is documented above.
- `ReplayArchiveReader` was not changed: its allocation site was not a leading
  full-pipeline hotspot, and ZIP safety behavior remains untouched.

## Production status

NOT RUN. A production one-shot benchmark requires a separate owner-approved
execution using an exact deployed commit/image, an approved replay subset,
preflight load checks, and verified cleanup. No public endpoint, production
job, AI call, persistence write, network call, or production service change was
introduced by this work.
