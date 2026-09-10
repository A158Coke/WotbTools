# Local replay performance results

This document records local investigation results from 2026-09-09/10. It is a
measurement record, not a production capacity guarantee. Production was not
accessed.

## Environment and corpus

- Worktree: isolated replay-performance worktree; no architecture split was made.
- Historical baseline matrix tree: `0db88597fe25706c2bf80f433f59ab9be15b2be8`.
- Historical PositionDecoder quick/JFR artifacts were generated from the dirty
  pre-review candidate tree; they are not measurements of the final Java25
  candidate tree.
- Final candidate source tree: PR #284 worktree based on `678d83e5` plus the
  Java25, Spring Boot 4.1.1, bounded AI virtual-worker and benchmark changes in
  this round. The c1 artifact was generated before commit from that source
  content and records `dirty=true`; the clean source commit and later
  documentation-only evidence commit are recorded in the final PR history.
- Java: Eclipse Temurin OpenJDK 25.0.4.1 (LTS).
- Spring Boot: 4.1.1.
- Benchmark JVM: `-XX:ActiveProcessorCount=2 -Xms4g -Xmx4g`.
- Corpus: 40 replay files recursively discovered under the real
  `common/data/` directory in the main checkout.
- Corpus bytes: 58,878,997 bytes (56.151 MiB).
- Canonical full-processing validation: 40 accepted, 0 rejected in every
  quick run and in the candidate parity smoke.
- Full-stage fingerprint verification was enabled for the baseline matrix and
  the candidate parity smoke. Quick A/B screening disabled fingerprint
  serialization to keep candidate screening bounded; canonical validation still
  computed the 40 fingerprints.

## Historical Java21 baseline matrix

The baseline-quality matrix used warmup 5, measurement 20, full-stage
fingerprint verification, and the same 2C/4GiB JVM. No c4 run was made.

| Stage | Replays/s | Mean ms | P50 ms | P90 ms | P95 ms | P99 ms | GC count/time |
|---|---:|---:|---:|---:|---:|---:|---:|
| c1 | 18.131 | 55.116 | 51.663 | 68.844 | 87.279 | 205.313 | 71 / 4,331 ms |
| c2 | 35.209 | 56.504 | 53.426 | 69.909 | 91.759 | 185.771 | 71 / 2,537 ms |
| c3 | 36.972 | 80.161 | 71.642 | 106.471 | 197.408 | 285.461 | 65 / 3,425 ms |

c2 remains the best balanced local point in this historical Java21 matrix. The
final Java25 run below did not change `REPLAY_PARSE_MAX_CONCURRENT=2` and did
not claim a production capacity change.

## Benchmark workflow change

The harness now has two explicit modes:

- `quick`: default warmup 3, measurement 5, maximum measurement 10. It is a
  repeated candidate screen, not performance proof.
- `full`: default warmup 5, measurement 20, and rejects smaller settings. It is
  the confirmation mode for a candidate with a credible quick-screen signal.

Both modes perform the same canonical corpus validation. The quick PositionDecoder
screen used `-DskipFingerprintVerification=true` because serializing the full
fingerprint projection made a single screening run unreasonably expensive.
That choice is recorded in each JSON artifact, removes only the per-measurement
Jackson fingerprint work, and does not replace the separate 40/40 deterministic
parity validation or make JFR startup-free.

## PositionDecoder A/B quick screen

### Setup

- B: baseline `packet.payload()` copy and varargs finite check.
- C: direct reads from `RawReplayPacket.source()` plus payload offset/length,
  direct `Float.isFinite` checks, and no temporary varargs `float[]`.
- Same real 40-replay corpus, full production-core entrypoint, 2C/4GiB JVM,
  warmup 3, measurement 5, and interleaved B/C/B/C/B/C runs.
- No unrelated HashMap change was included in the comparison.
- Quick artifacts are under `build/performance/replay-performance-quick-*.{json,csv,md}`.

### Repeated-run medians

The following are medians of the three labelled B runs and three labelled C
runs. The screen is intentionally reported as a median rather than a single
run; the broad run-to-run spread is itself evidence that this is not a final
performance claim.

| Concurrency | Variant | Replays/s | Mean ms | P50 ms | P95 ms | P99 ms | GC count | GC time ms | Process CPU ms |
|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | B | 14.717 | 67.890 | 59.516 | 113.716 | 229.850 | 11 | 1,866 | 16,546.9 |
| 1 | C | 15.649 | 63.850 | 60.248 | 87.278 | 204.870 | 5 | 763 | 14,000.0 |
| 2 | B | 21.502 | 92.746 | 79.153 | 212.464 | 260.390 | 16 | 2,201 | 19,187.5 |
| 2 | C | 22.527 | 88.340 | 72.485 | 239.361 | 287.891 | 12 | 1,924 | 17,781.3 |

The individual quick runs are noisy. For example, c2-C ranged from 17.793 to
27.145 replays/s in the labelled runs. Therefore no percentage speedup is
claimed. The median screen is directionally positive for throughput/mean and
GC count/time, but c2 tail latency is not consistently better.

### Allocation/JFR comparison

A short c1 JFR was recorded for each variant with the same 2C/4GiB JVM and
quick workload. These recordings were captured before the measurement-only
JFR boundary repair, when `Recording.start()` preceded both warmup and
measurement:

- B: `build/performance/position-b-quick-c1.jfr`
- C: `build/performance/position-c-quick-c1.jfr`

The current harness now executes all configured warmup rounds before starting
each JFR recording; its recording contains measurement rounds only. The B/C
files and percentages below predate that repair and therefore include the old
warmup, JVM/JFR startup, and class-instrumentation/retransformation noise.
They are retained only as historical investigation data. They are not output
from the current measurement-only harness, are not a precise B/C allocation
comparison, and must not be used to claim an allocation percentage
improvement. Even with the repaired boundary, JFR start and class
retransformation samples can occur near the recording boundary.

`jfr view allocation-by-site` reported:

| Site | B | C | Interpretation |
|---|---:|---:|---|
| `Arrays.copyOf(byte[], int)` | 10.35% | 8.48% | Historical site share only; not an allocation improvement claim |
| `RawReplayPacket.payload()` | 3.38% | 2.34% | Historical site share only; not an allocation improvement claim |
| `PositionDecoder.decode` | 1.54% | 2.37% | Historical site share only; not a current-harness comparison |

Allocation-by-class totals are not suitable for a direct B/C claim in this
short historical recording: the B recording was dominated by JFR/JVM startup
`ConcurrentHashMap` instrumentation and the C recording by ASM class-rewrite
allocation. These historical allocation-site shares are not a byte-accurate
total-allocation proof and are not evidence produced by the repaired harness.

### Decision

`PositionDecoder` = **KEEP** in this worktree.

Reason: the candidate has deterministic semantic parity on all 40 real
replays; the original `packet.payload()` implementation allocates a new
`byte[payloadLength]` and performs `System.arraycopy`, while the candidate
reads directly from the shared `source` with `payloadOffset` and
`payloadLength`; and removing the `float...` finite helper removes its
temporary `float[]`. The change is local and readable, `PositionDecoderTest`
covers a non-zero payload offset, and the production packet reader validates
payload framing and bounds before constructing `RawReplayPacket`. The quick
screen is noisy and does not justify a throughput claim. The historical JFR
percentages above are not part of the KEEP evidence.

Required semantic checks remain mandatory before merge: targeted regression
tests, malformed packet behavior, and a full 40-replay fingerprint parity run.

## `StringLatin1.replace` investigation

### JFR call chain

The extended real-corpus JFR originally showed:

```text
StringLatin1.replace = 26.34% of allocation sites
```

The allocation-sample stack was inspected rather than treating that method as
an application caller. The only matching sample was:

```text
StringLatin1.replace(byte[], char, char)
└── String.replace(char, char)
    └── InnerClassLambdaMetafactory.generateInnerClass()
        └── LambdaMetafactory / JFR EventInstrumentation
```

The sample is JFR's own class instrumentation while the recording starts, not
a WotBTools replay-processing call chain. It must not be optimized as if it
were production replay work.

### Production source audit

The production `.replace(...)` search found these relevant categories:

- `ClusterTermSanitizer.replaceCluster`: AI/text sanitization, not the
  canonical replay decode/reconstruction hot path.
- `RouteSkill`: artifact/display text construction.
- `TeamFactualConsistencyValidator`: nickname comparison normalization.
- `TankNameCorrector` uses `StringBuilder.replace`, not `StringLatin1.replace`.
- `LeagueRatingCalculator.replaceAll` is `List.replaceAll`, not String replace.

No production caller was present under the matching JFR allocation stack, so a
per-replay/per-packet frequency for `StringLatin1.replace` cannot be honestly
derived from that 26.34% figure. The current evidence classifies it as a JFR
profiling artifact, not a confirmed replay allocation hotspot.

Decision: defer String replacement optimization. If it becomes a priority,
repeat profiling with recording-start instrumentation excluded or use an
application-only allocation capture before changing sanitization or display
code. Do not introduce a global cache, ThreadLocal cache, interning, or a
custom string buffer.

## `ReplayHpTimeline.eventTime` investigation

### Exact implementation

`ReplayHpTimeline.eventTime` is a pure deterministic time-domain fallback:

1. null timestamp → `NaN`;
2. finite `battleClockSec` → that battle-relative value;
3. otherwise, if the battle start raw clock is unavailable/non-finite →
   `rawClockSec`;
4. otherwise → `rawClockSec - startRawClockSec`.

It performs no string formatting, decimal conversion, map lookup, stream
operation, sorting, or explicit boxing. The `Float` and `Double` values it reads
are already part of the event/call contract.

### Call graph and repeated work

The extended JFR stack traces show:

```text
DefaultReplayProcessingFacade.process
└── ObservedMaxHp.populate
    ├── ObservedMaxHp.byAccount
    │   └── ReplayHpTimeline.build
    │       └── eventTime once for every ReplayEvent
    └── ObservedMaxHp.hpTimelineByAccount
        └── ReplayHpTimeline.build
            └── eventTime once for every ReplayEvent again
```

Thus the same `events`, `mapping`, and `startRawClockSec == null` inputs are
fully scanned twice in one `ObservedMaxHp.populate` call. The first result is
reduced to `account → max HP`; the second is reduced to
`account → List<HpObservation>`. This is repeated computation, not a sorting
comparator issue. `ReplayTerminalLifecycle` also has its own pure event-time
helper and is called by `PlaybackCombatReconstruction`; it is a separate pass
and must not be changed by assumption.

JFR samples occasionally show `FloatToDecimal.toDecimal`,
`FloatToDecimal.removeTrailingZeroes`, or `Integer.getChars` adjacent to the
`eventTime` frame. Source inspection proves that `eventTime` itself contains no
formatting or decimal conversion, so the relationship is not established; the
samples are treated as neighbouring/inlined workload evidence, not as a reason
to change numeric formatting.

### Candidate mitigation and risk

The narrow candidate is to build the HP timeline once inside
`ObservedMaxHp.populate` and derive both the max-HP map and per-account timeline
from that immutable list. This avoids the duplicate full event-time pass while
preserving the canonical event model. It needs focused `ObservedMaxHp` tests and
the same 40-replay fingerprint parity check. Risk is low to moderate because
the two current reductions must retain their existing filtering and ordering
semantics.

## HashMap reassessment

The earlier HashMap cleanup remains a code-quality cleanup candidate. The strict
old B/C/B/C/B/C protocol was abandoned after a c1-B run took about 45 minutes
without producing an artifact. No performance effect was measured:

`performance effect = unproven`

It does not block the higher-value investigation above.

## Next candidate decision

| Candidate | Evidence | Expected benefit | Risk | Decision |
|---|---|---:|---|---|
| PositionDecoder no-copy | 40/40 parity; known payload copy and temporary varargs array removed; offset regression covered; quick throughput noisy | Lower packet-copy/temporary-array allocation | Low | KEEP |
| String replace hotspot | 26.34% is JFR instrumentation; no production caller in matching stack | None established | N/A | Defer |
| Duplicate `ReplayHpTimeline.build` in `ObservedMaxHp.populate` | Same event list was scanned twice; eventTime was 10.98% CPU hotspot | Avoid one HP timeline time pass per populate | Low/medium | DONE |
| HashMap cleanup | No completed clean A/B | Unproven | Low | Cleanup/defer |

`NEXT OPTIMIZATION CANDIDATE: none for #284; speculative follow-up work is deferred`

The duplicate timeline build is implemented in the final candidate tree. No
additional optimization was selected merely to improve the final number.

## GC baseline and constraints

The historical extended c1 JFR baseline recorded 257 GC pauses totaling 24.5
seconds:
median 60.2 ms, p95 276 ms, p99 464 ms, maximum 583 ms. The allocation-heavy
classes were `byte[]` (35.36%), `String` (27.20%), `Object[]` (6.96%),
`RawReplayPacket` (4.56%), `float[]` (2.94%), and `PositionChangedEvent`
(2.34%). These values predate the final Java25 tree and are not a final-tree
allocation claim.

This round did not tune G1/ZGC/Shenandoah, change heap size, change concurrency,
or add caches/pools. Avoidable allocation reduction remains the first action.

## Validation and production status

Java25 validation completed:

- `AiReviewWorkerSaturationTest`: 5/5 passed.
- `ObservedMaxHpTest` + `ReplayHpTimelineTest`: 11/11 passed.
- Explicit real-corpus discovery/parity: 40/40 accepted, 0 rejected.
- Final c1 full confirmation: 40/40 corpus parity and 800/800 measurement
  fingerprints. Its JSON metadata records commit `678d83e5` and `dirty=true`
  because the source candidate had not yet been committed when it ran; no
  source changes were made after that run.
- c2 full confirmation: incomplete because the bounded observation window was
  exceeded; failure was caused by safe test-process termination.

No production endpoint, production job, persistence write, service restart,
MQ/COS/Grafana change, or production configuration change was made. The replay
benchmark and the AI blocking-call benchmark remain separate evidence sets.

## Final PR #284 tree validation

### ObservedMaxHp / ReplayHpTimeline

- `ObservedMaxHp.populate` invokes `ReplayHpTimeline.build` once.
- The same immutable timeline supplies both `account → max HP` and
  `account → List<HpObservation>` reductions.
- Ordering, filtering, null events, unknown accounts and `UNKNOWN_FFFF` handling
  remain covered by `ObservedMaxHpTest` and `ReplayHpTimelineTest`.
- Targeted result: 11 tests passed (9 `ObservedMaxHpTest`, 2
  `ReplayHpTimelineTest`).
- Real corpus parity: 40/40 accepted, 0 rejected in Java25 discovery and in
  the c1 full confirmation; c1 verified 800/800 measurement fingerprints.

### Final Java25 full confirmation

The final replay confirmation used Eclipse Temurin OpenJDK 25.0.4.1,
`-XX:ActiveProcessorCount=2 -Xms4g -Xmx4g`, an explicit real corpus path,
`stage=full`, warmup 5, measurement 20, and fingerprint verification enabled.

| Run | Status | Replays/s | Mean ms | P50 ms | P95 ms | P99 ms | GC count/time | Fingerprints |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| c1 | completed | 15.455 | 64.656 | 58.726 | 99.260 | 328.611 | 51 / 5,317 ms | 800/800 |
| c2 | stopped after >2 h with no artifact | — | — | — | — | — | — | incomplete |

c1 artifact:
`build/performance/final-confirmation/java25-final-c1/replay-performance-full-20260910-103616-438.{json,csv,md}`.

The c2 JVM remained CPU-active but did not finish within the observation
window; it was then terminated safely. The Maven result is a Surefire fork
termination failure, not a performance result. Therefore this round makes no
c2 throughput or latency claim. The c1 result is evidence for the final
candidate source content and one constrained-node performance point, not a
proof of a production capacity increase.

### AI Platform vs Virtual Thread benchmark

The separate real-provider benchmark is implemented as an opt-in `ai-live`
test with identical Platform/Virtual settings, fixed prompt
`Return exactly: OK`, matrix `1,2,5,10`, warmup 2 and measurement 10 per
variant, bounded worker admission, and optional measurement-only JFR. It does
not change replay concurrency or production AI admission limits. It was not
executed in this environment because `AI_API_KEY` was not present; no provider
request or token cost was incurred. Consequently there is no VT latency,
error-rate, provider-status, or `VirtualThreadPinned` result to report.

### Java25 test/build status

- `mvn -o -s settings.xml -pl wotb-web -am test`: passed; `wotb-core` had
  1,255 tests with 0 failures/errors and `wotb-web` had 1,336 tests with 0
  failures/errors (skips are reported by Maven).
- Full reactor `mvn ... test` reached `wotb-control`, but its Docker-backed
  integration test could not start because no local Docker daemon was
  available. This remains a CI validation requirement.
- The backend image build was not run locally for the same Docker-daemon
  limitation; CI must validate the Temurin OpenJDK 25 build/runtime images.
