package com.wotb.core.performance;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ParsedReplay;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionContext;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryPoolMXBean;
import java.lang.management.MemoryType;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import com.sun.management.OperatingSystemMXBean;
import jdk.jfr.Configuration;
import jdk.jfr.Recording;

import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Opt-in macro benchmark for the replay core pipeline.
 *
 * <p>This test deliberately lives under test sources. It is skipped unless
 * {@code -Dperformance=true} is supplied, and it never introduces an HTTP,
 * persistence, AI, MQ, or COS path.</p>
 */
@Tag("performance")
class ReplayPerformanceBenchmarkTest {

    private static final DateTimeFormatter FILE_TIMESTAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS").withZone(ZoneOffset.UTC);
    private static final double BYTES_PER_MIB = 1024.0 * 1024.0;
    private static final boolean PROGRESS_LOGGING =
            Boolean.getBoolean("performance.progress");

    private final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
    private final ReplayReconstructionService reconstructionService = new ReplayReconstructionService();

    @Test
    void runOptInReplayPerformanceBenchmark() throws Exception {
        assumeTrue(Boolean.getBoolean("performance"),
                "Opt-in only: run with -Dperformance=true -Dtest=ReplayPerformanceBenchmarkTest");

        final Path repoRoot = findRepositoryRoot();
        final Discovery discovery = discover(repoRoot);
        System.out.printf("CORPUS_RESOLVED root=%s explicit=%s replayFiles=%d%n",
                discovery.root(), discovery.explicitPath(), discovery.samples().size());
        final CorpusValidation validation = validateCorpus(discovery.samples());
        final List<ReplaySample> validSamples = validation.validSamples();
        if (validSamples.isEmpty()) {
            fail("No replay passed the canonical full-processing validation: "
                    + String.join("; ", validation.rejections()));
        }

        final Map<String, String> fingerprints = validation.fingerprints();
        final String requestedMode = benchmarkMode();
        final int defaultWarmupRounds = requestedMode.equals("quick") ? 3 : 5;
        final int defaultMeasurementRounds = requestedMode.equals("quick") ? 5 : 20;
        final int warmupRounds = positiveIntProperty("warmupRounds", defaultWarmupRounds);
        final int measurementRounds = positiveIntProperty("measurementRounds", defaultMeasurementRounds);
        validateRounds(requestedMode, warmupRounds, measurementRounds);
        final int concurrency = positiveIntProperty("concurrency", 1);
        final String requestedStage = System.getProperty("stage", "all").trim().toLowerCase();
        final List<Stage> stages = stages(requestedStage);
        final boolean verifyParity = !Boolean.getBoolean("skipFingerprintVerification");
        final boolean discoveryOnly = Boolean.getBoolean("discoveryOnly");
        final Path outputDirectory = resolvePath(repoRoot,
                System.getProperty("performance.output", "build/performance"));
        Files.createDirectories(outputDirectory);

        final Path jfrPath = configuredJfrPath(repoRoot);
        if (discoveryOnly && jfrPath != null) {
            throw new IllegalArgumentException("-DdiscoveryOnly=true cannot be combined with -DjfrFile");
        }
        final List<BenchmarkResult> benchmarkResults;
        if (discoveryOnly) {
            benchmarkResults = List.of();
        } else if (jfrPath == null) {
            benchmarkResults = runStages(validSamples, fingerprints, stages,
                    warmupRounds, measurementRounds, concurrency, verifyParity);
        } else {
            benchmarkResults = runWithJfr(jfrPath, validSamples, fingerprints, stages,
                    warmupRounds, measurementRounds, concurrency, verifyParity);
        }

        final Metadata metadata = Metadata.capture(repoRoot, validSamples, warmupRounds,
                measurementRounds, concurrency, discoveryOnly ? "discovery" : requestedStage,
                discoveryOnly ? "discovery" : requestedMode,
                verifyParity, jfrPath);
        final Path resultBase = outputDirectory.resolve(
                (discoveryOnly ? "replay-corpus-discovery-" : "replay-performance-" + requestedMode + "-")
                        + FILE_TIMESTAMP.format(Instant.now()));
        writeJson(resultBase.resolveSibling(resultBase.getFileName() + ".json"),
                metadata, discovery, validation, fingerprints, benchmarkResults);
        writeCsv(resultBase.resolveSibling(resultBase.getFileName() + ".csv"), benchmarkResults);
        writeMarkdown(resultBase.resolveSibling(resultBase.getFileName() + ".md"),
                metadata, discovery, validation, benchmarkResults);

        System.out.println(discoveryOnly ? "Replay corpus discovery complete"
                : "Replay performance benchmark complete");
        System.out.println("  corpus=" + validSamples.size() + " accepted files, "
                + validation.rejections().size() + " rejected files");
        if (!discoveryOnly) {
            System.out.println("  mode=" + requestedMode + ", stage=" + requestedStage
                    + ", concurrency=" + concurrency);
        }
        System.out.println("  results=" + resultBase + ".{json,csv,md}");
        if (jfrPath != null) {
            System.out.println("  jfr=" + jfrPath);
        }
        if (!discoveryOnly) {
            benchmarkResults.forEach(result -> System.out.printf(
                    "  %s: %.3f replays/s, p50=%.3f ms, p95=%.3f ms, gc=%d/%d ms%n",
                    result.stage().label, result.replaysPerSecond(), result.p50Ms(), result.p95Ms(),
                    result.gcCollections(), result.gcTimeMs()));
        }
    }

    private List<BenchmarkResult> runStages(final List<ReplaySample> samples,
                                            final Map<String, String> fingerprints,
                                            final List<Stage> stages,
                                            final int warmupRounds,
                                            final int measurementRounds,
                                            final int concurrency,
                                            final boolean verifyParity) throws Exception {
        return runStages(samples, fingerprints, stages, warmupRounds, measurementRounds,
                concurrency, verifyParity, true);
    }

    private List<BenchmarkResult> runStages(final List<ReplaySample> samples,
                                            final Map<String, String> fingerprints,
                                            final List<Stage> stages,
                                            final int warmupRounds,
                                            final int measurementRounds,
                                            final int concurrency,
                                            final boolean verifyParity,
                                            final boolean executeWarmup) throws Exception {
        final List<BenchmarkResult> results = new ArrayList<>();
        for (final Stage stage : stages) {
            results.add(benchmark(stage, samples, fingerprints, warmupRounds,
                    measurementRounds, concurrency, verifyParity, executeWarmup));
        }
        return results;
    }

    private List<BenchmarkResult> runWithJfr(final Path jfrPath,
                                             final List<ReplaySample> samples,
                                             final Map<String, String> fingerprints,
                                             final List<Stage> stages,
                                             final int warmupRounds,
                                             final int measurementRounds,
                                             final int concurrency,
                                             final boolean verifyParity) throws Exception {
        Files.createDirectories(Objects.requireNonNull(jfrPath.getParent()));
        runWarmupStages(samples, fingerprints, stages, warmupRounds, concurrency, verifyParity);
        try (Recording recording = new Recording(Configuration.getConfiguration("profile"))) {
            recording.setName("wotb-replay-performance");
            recording.setToDisk(true);
            recording.setDestination(jfrPath);
            recording.start();
            try {
                return runStages(samples, fingerprints, stages, warmupRounds,
                        measurementRounds, concurrency, verifyParity, false);
            } finally {
                recording.stop();
            }
        }
    }

    private void runWarmupStages(final List<ReplaySample> samples,
                                 final Map<String, String> fingerprints,
                                 final List<Stage> stages,
                                 final int warmupRounds,
                                 final int concurrency,
                                 final boolean verifyParity) throws Exception {
        for (final Stage stage : stages) {
            final ExecutorService executor = newExecutor(concurrency, samples.size());
            try {
                for (int round = 0; round < warmupRounds; round++) {
                    logRound("START", stage, "warmup", round + 1, warmupRounds, concurrency);
                    final long roundStart = System.nanoTime();
                    final Round roundResult = executeRound(executor, stage, samples);
                    if (verifyParity) {
                        verifyRound(stage, roundResult.invocations(), fingerprints);
                    }
                    logRoundDone(stage, "warmup", round + 1, warmupRounds, concurrency,
                            roundStart);
                }
            } finally {
                executor.shutdownNow();
                if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Benchmark warmup executor did not terminate");
                }
            }
        }
    }

    private BenchmarkResult benchmark(final Stage stage,
                                      final List<ReplaySample> samples,
                                      final Map<String, String> fingerprints,
                                      final int warmupRounds,
                                      final int measurementRounds,
                                      final int concurrency,
                                      final boolean verifyParity) throws Exception {
        return benchmark(stage, samples, fingerprints, warmupRounds, measurementRounds,
                concurrency, verifyParity, true);
    }

    private BenchmarkResult benchmark(final Stage stage,
                                      final List<ReplaySample> samples,
                                      final Map<String, String> fingerprints,
                                      final int warmupRounds,
                                      final int measurementRounds,
                                      final int concurrency,
                                      final boolean verifyParity,
                                      final boolean executeWarmup) throws Exception {
        final ExecutorService executor = newExecutor(concurrency, samples.size());
        try {
            if (executeWarmup) {
                for (int round = 0; round < warmupRounds; round++) {
                    final Round roundResult = executeRound(executor, stage, samples);
                    if (verifyParity) {
                        verifyRound(stage, roundResult.invocations(), fingerprints);
                    }
                }
            }

            final List<Long> latencies = new ArrayList<>();
            long wallNanos = 0L;
            long cpuNanos = 0L;
            long gcCollections = 0L;
            long gcTimeMs = 0L;
            long heapBefore = -1L;
            long heapAfter = -1L;
            long peakHeap = -1L;
            long packetCount = 0L;
            long eventCount = 0L;
            long checkpointCount = 0L;
            long participantCount = 0L;
            int fingerprintCount = 0;

            for (int round = 0; round < measurementRounds; round++) {
                logRound("START", stage, "measurement", round + 1, measurementRounds, concurrency);
                final long roundStart = System.nanoTime();
                final GcSnapshot beforeGc = GcSnapshot.capture();
                HeapSnapshot.resetPeaks();
                final HeapSnapshot beforeHeap = HeapSnapshot.capture();
                final long beforeCpu = processCpuTime();
                final long beforeWall = System.nanoTime();
                final Round roundResult = executeRound(executor, stage, samples);
                final long afterWall = System.nanoTime();
                final long afterCpu = processCpuTime();
                final GcSnapshot afterGc = GcSnapshot.capture();
                final HeapSnapshot afterHeap = HeapSnapshot.capture();

                wallNanos += afterWall - beforeWall;
                if (beforeCpu >= 0L && afterCpu >= beforeCpu) {
                    cpuNanos += afterCpu - beforeCpu;
                }
                gcCollections += afterGc.collectionCount() - beforeGc.collectionCount();
                gcTimeMs += afterGc.collectionTimeMs() - beforeGc.collectionTimeMs();
                if (heapBefore < 0L) {
                    heapBefore = beforeHeap.used();
                }
                heapAfter = afterHeap.used();
                peakHeap = Math.max(peakHeap, afterHeap.peakUsed());
                for (final TimedInvocation invocation : roundResult.invocations()) {
                    latencies.add(invocation.elapsedNanos());
                    packetCount += invocation.output().packetCount();
                    eventCount += invocation.output().eventCount();
                    checkpointCount += invocation.output().checkpointCount();
                    participantCount += invocation.output().participantCount();
                }
                if (verifyParity) {
                    fingerprintCount += verifyRound(stage, roundResult.invocations(), fingerprints);
                }
                logRoundDone(stage, "measurement", round + 1, measurementRounds, concurrency,
                        roundStart);
            }

            final long operations = (long) samples.size() * measurementRounds;
            final double wallSeconds = wallNanos / 1_000_000_000.0;
            final double totalBytes = samples.stream().mapToLong(ReplaySample::size).sum()
                    * (double) measurementRounds;
            return BenchmarkResult.of(stage, concurrency, warmupRounds, measurementRounds,
                    operations, wallNanos, cpuNanos, totalBytes, latencies, gcCollections,
                    gcTimeMs, heapBefore, heapAfter, peakHeap, packetCount, eventCount,
                    checkpointCount, participantCount, fingerprintCount, wallSeconds);
        } finally {
            executor.shutdownNow();
            if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Benchmark executor did not terminate");
            }
        }
    }

    private static ExecutorService newExecutor(final int concurrency, final int sampleCount) {
        return new ThreadPoolExecutor(
                concurrency,
                concurrency,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(Math.max(1, sampleCount)),
                new ThreadPoolExecutor.AbortPolicy());
    }

    private static void logRound(final String event, final Stage stage, final String phase,
                                 final int round, final int total, final int concurrency) {
        if (PROGRESS_LOGGING) {
            System.out.printf("BENCHMARK_ROUND_%s stage=%s phase=%s round=%d/%d concurrency=%d%n",
                    event, stage.label, phase, round, total, concurrency);
        }
    }

    private static void logRoundDone(final Stage stage, final String phase,
                                     final int round, final int total, final int concurrency,
                                     final long roundStart) {
        if (PROGRESS_LOGGING) {
            System.out.printf("BENCHMARK_ROUND_DONE stage=%s phase=%s round=%d/%d concurrency=%d elapsedMs=%.3f%n",
                    stage.label, phase, round, total, concurrency,
                    (System.nanoTime() - roundStart) / 1_000_000.0);
        }
    }

    private Round executeRound(final ExecutorService executor, final Stage stage,
                               final List<ReplaySample> samples) throws Exception {
        final List<Callable<TimedInvocation>> tasks = samples.stream()
                .map(sample -> (Callable<TimedInvocation>) () -> {
                    final long started = System.nanoTime();
                    final StageOutput output = execute(stage, sample);
                    return new TimedInvocation(sample.path().toString(), System.nanoTime() - started, output);
                })
                .toList();
        final List<Future<TimedInvocation>> futures = executor.invokeAll(tasks);
        final List<TimedInvocation> invocations = new ArrayList<>(futures.size());
        for (final Future<TimedInvocation> future : futures) {
            try {
                invocations.add(future.get());
            } catch (final ExecutionException e) {
                final Throwable cause = e.getCause() == null ? e : e.getCause();
                throw new IllegalStateException("Benchmark invocation failed", cause);
            }
        }
        return new Round(invocations);
    }

    private StageOutput execute(final Stage stage, final ReplaySample sample) throws Exception {
        return switch (stage) {
            case ARCHIVE -> {
                ParsedReplay.read(sample.bytes());
                yield StageOutput.empty();
            }
            case PARSER -> {
                final ParsedReplay parsed = ParsedReplay.read(sample.bytes());
                ReplayParser.parse(parsed);
                yield StageOutput.empty();
            }
            case RECONSTRUCTION -> {
                final ParsedReplay parsed = ParsedReplay.read(sample.bytes());
                final Battle battle = ReplayParser.parse(parsed);
                final ReplayReconstruction reconstruction = reconstructionService.reconstruct(
                        parsed, contextFor(battle));
                yield StageOutput.from(reconstruction);
            }
            case FULL -> {
                final ReplayProcessingResult result = facade.process(
                        new Source(sample.name(), sample.bytes()), ReplayProcessingOptions.full());
                if (result.status() != ReplayProcessingStatus.SUCCESS || result.reconstruction() == null) {
                    throw new IllegalStateException("Full pipeline did not succeed for " + sample.name()
                            + ": " + failureReason(result));
                }
                yield StageOutput.from(result);
            }
        };
    }

    private int verifyRound(final Stage stage, final List<TimedInvocation> invocations,
                            final Map<String, String> fingerprints) {
        if (stage != Stage.FULL) {
            return 0;
        }
        int verified = 0;
        for (final TimedInvocation invocation : invocations) {
            final StageOutput output = invocation.output();
            final String expected = fingerprints.get(invocation.fileName());
            final String actual = fingerprint(output.result());
            if (!Objects.equals(expected, actual)) {
                throw new AssertionError("Replay fingerprint changed for " + invocation.fileName()
                        + ": expected=" + expected + ", actual=" + actual);
            }
            verified++;
        }
        return verified;
    }

    private CorpusValidation validateCorpus(final List<ReplaySample> samples) {
        final List<ReplaySample> valid = new ArrayList<>();
        final List<String> rejections = new ArrayList<>();
        final Map<String, String> fingerprints = new LinkedHashMap<>();
        for (final ReplaySample sample : samples) {
            try {
                final ReplayProcessingResult result = facade.process(
                        new Source(sample.name(), sample.bytes()), ReplayProcessingOptions.full());
                if (result.status() == ReplayProcessingStatus.SUCCESS && result.reconstruction() != null) {
                    valid.add(sample);
                    final String fingerprint = fingerprint(result);
                    fingerprints.put(sample.path().toString(), fingerprint);
                    System.out.println("CORPUS_ACCEPTED file=" + sample.path()
                            + " | stage=full | fingerprint=" + fingerprint);
                } else {
                    final String rejection = sample.path() + " | stage=full | " + failureReason(result);
                    rejections.add(rejection);
                    System.out.println("CORPUS_REJECTED file=" + rejection);
                }
            } catch (final Exception e) {
                final String rejection = sample.path() + " | stage=full | "
                        + e.getClass().getSimpleName() + ": " + e.getMessage();
                rejections.add(rejection);
                System.out.println("CORPUS_REJECTED file=" + rejection);
            }
        }
        return new CorpusValidation(List.copyOf(valid), List.copyOf(rejections), Map.copyOf(fingerprints));
    }

    private Discovery discover(final Path repoRoot) throws IOException {
        final String configured = System.getProperty("corpusPath");
        if (configured != null && configured.isBlank()) {
            throw new IllegalArgumentException("Configured -DcorpusPath must not be blank");
        }
        final boolean explicitPath = configured != null;
        final Path requested = explicitPath ? resolvePath(repoRoot, configured)
                : repoRoot.resolve("common/data");
        final Path corpusRoot;
        if (Files.isDirectory(requested) && hasReplayFile(requested)) {
            corpusRoot = requested;
        } else if (explicitPath) {
            throw new IllegalArgumentException(
                    "Configured -DcorpusPath does not exist or contains no .wotbreplay files: "
                            + requested);
        } else {
            corpusRoot = repoRoot.resolve("common/fixtures/replays");
        }
        if (!Files.isDirectory(corpusRoot)) {
            return new Discovery(corpusRoot, List.of(),
                    List.of("missing corpus directory: " + corpusRoot), explicitPath);
        }
        final List<ReplaySample> samples = new ArrayList<>();
        final List<String> rejections = new ArrayList<>();
        try (Stream<Path> paths = Files.walk(corpusRoot)) {
            for (final Path path : paths.filter(Files::isRegularFile)
                    .sorted(Comparator.comparing(Path::toString)).toList()) {
                if (!path.getFileName().toString().toLowerCase().endsWith(".wotbreplay")) {
                    continue;
                }
                try {
                    final byte[] bytes = Files.readAllBytes(path);
                    samples.add(new ReplaySample(path, path.getFileName().toString(), bytes));
                } catch (final IOException e) {
                    rejections.add(path + " | " + e.getClass().getSimpleName() + ": " + e.getMessage());
                }
            }
        }
        return new Discovery(corpusRoot, List.copyOf(samples), List.copyOf(rejections), explicitPath);
    }

    private static boolean hasReplayFile(final Path root) throws IOException {
        try (Stream<Path> paths = Files.walk(root)) {
            return paths.anyMatch(path -> Files.isRegularFile(path)
                    && path.getFileName().toString().toLowerCase().endsWith(".wotbreplay"));
        }
    }

    private static ReplayReconstructionContext contextFor(final Battle battle) {
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            return ReplayReconstructionContext.empty();
        }
        final Map<Long, PlayerResult> playersByAccount = new HashMap<>();
        Long recorderAccountId = null;
        for (final PlayerResult player : battle.players) {
            playersByAccount.put(player.accountId, player);
            if (battle.recorder != null && battle.recorder.equals(player.nickname)) {
                recorderAccountId = player.accountId;
            }
        }
        return new ReplayReconstructionContext(battle, playersByAccount,
                recorderAccountId, battle.recorder);
    }

    private static String fingerprint(final ReplayProcessingResult result) {
        return sha256(ReplayFactsCodec.toBytes(AiReplayFacts.fromResult(result)));
    }

    private static String sha256(final byte[] data) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (final Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static List<Stage> stages(final String requested) {
        if (requested.equals("all")) {
            return List.of(Stage.ARCHIVE, Stage.PARSER, Stage.RECONSTRUCTION, Stage.FULL);
        }
        return List.of(Stage.from(requested));
    }

    private static int positiveIntProperty(final String name, final int defaultValue) {
        final int value = Integer.getInteger(name, defaultValue);
        if (value <= 0) {
            throw new IllegalArgumentException("-D" + name + " must be positive: " + value);
        }
        return value;
    }

    private static String benchmarkMode() {
        final String mode = System.getProperty("benchmarkMode", "full").trim().toLowerCase();
        if (!mode.equals("quick") && !mode.equals("full")) {
            throw new IllegalArgumentException("-DbenchmarkMode must be quick or full: " + mode);
        }
        return mode;
    }

    private static void validateRounds(final String mode, final int warmupRounds,
                                       final int measurementRounds) {
        if (mode.equals("full") && (warmupRounds < 5 || measurementRounds < 20)) {
            throw new IllegalArgumentException(
                    "full mode requires warmupRounds >= 5 and measurementRounds >= 20");
        }
        if (mode.equals("quick") && measurementRounds > 10) {
            throw new IllegalArgumentException(
                    "quick mode requires measurementRounds <= 10; use full mode for confirmation");
        }
    }

    private static Path findRepositoryRoot() {
        Path current = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        while (current != null) {
            if (Files.isDirectory(current.resolve("common"))
                    && Files.isRegularFile(current.resolve("java/pom.xml"))) {
                return current;
            }
            current = current.getParent();
        }
        throw new IllegalStateException("Cannot locate repository root from "
                + System.getProperty("user.dir"));
    }

    private static Path resolvePath(final Path repoRoot, final String value) {
        final Path path = Path.of(value);
        return path.isAbsolute() ? path.normalize() : repoRoot.resolve(path).normalize();
    }

    private static Path configuredJfrPath(final Path repoRoot) {
        final String configured = System.getProperty("jfrFile");
        if (configured == null || configured.isBlank()) {
            return null;
        }
        final Path configuredPath = Path.of(configured);
        return (configuredPath.isAbsolute() ? configuredPath : repoRoot.resolve(configuredPath)).normalize();
    }

    private static List<String> combinedRejections(final Discovery discovery,
                                                    final CorpusValidation validation) {
        return Stream.concat(discovery.rejections().stream(), validation.rejections().stream())
                .toList();
    }

    private static long processCpuTime() {
        final java.lang.management.OperatingSystemMXBean bean =
                ManagementFactory.getOperatingSystemMXBean();
        return bean instanceof OperatingSystemMXBean os ? os.getProcessCpuTime() : -1L;
    }

    private static String failureReason(final ReplayProcessingResult result) {
        if (result.error() != null) {
            return result.error().code() + ": " + result.error().message();
        }
        if (result.reconstructionError() != null) {
            return result.reconstructionError().code() + ": " + result.reconstructionError().message();
        }
        return String.valueOf(result.status());
    }

    private static void writeJson(final Path file, final Metadata metadata,
                                  final Discovery discovery, final CorpusValidation validation,
                                  final Map<String, String> fingerprints,
                                  final List<BenchmarkResult> results) throws IOException {
        final StringBuilder out = new StringBuilder(16_384);
        out.append("{\n  \"metadata\":").append(metadata.toJson()).append(",\n");
        out.append("  \"discovery\":{")
                .append("\"root\":").append(json(discovery.root().toString())).append(",")
                .append("\"explicitCorpusPath\":").append(discovery.explicitPath()).append(",")
                .append("\"discovered\":").append(discovery.samples().size()).append(",")
                .append("\"accepted\":").append(validation.validSamples().size()).append(",")
                .append("\"acceptedFiles\":").append(json(validation.validSamples().stream()
                        .map(sample -> sample.path().toString()).toList())).append(",")
                .append("\"rejected\":").append(json(combinedRejections(discovery, validation))).append(",")
                .append("\"totalBytes\":").append(discovery.samples().stream()
                        .mapToLong(ReplaySample::size).sum()).append(",")
                .append("\"minBytes\":").append(minSize(discovery.samples())).append(",")
                .append("\"medianBytes\":").append(medianSize(discovery.samples())).append(",")
                .append("\"maxBytes\":").append(maxSize(discovery.samples()))
                .append("},\n");
        out.append("  \"fingerprints\":{");
        out.append(fingerprints.entrySet().stream()
                .map(entry -> json(entry.getKey()) + ":" + json(entry.getValue()))
                .collect(Collectors.joining(",")));
        out.append("},\n  \"benchmarks\":[");
        out.append(results.stream().map(BenchmarkResult::toJson).collect(Collectors.joining(",")));
        out.append("]\n}\n");
        Files.writeString(file, out, StandardCharsets.UTF_8);
    }

    private static void writeCsv(final Path file, final List<BenchmarkResult> results) throws IOException {
        final StringBuilder out = new StringBuilder();
        out.append("stage,concurrency,warmupRounds,measurementRounds,operations,totalWallMs,"
                + "processCpuMs,replaysPerSecond,mbPerSecond,meanMs,p50Ms,p90Ms,p95Ms,p99Ms,minMs,maxMs,"
                + "gcCollections,gcTimeMs,heapBeforeBytes,heapAfterBytes,peakHeapBytes,packetCount,eventCount,"
                + "checkpointCount,participantCount,fingerprintsVerified\n");
        for (final BenchmarkResult result : results) {
            out.append(result.toCsv()).append('\n');
        }
        Files.writeString(file, out, StandardCharsets.UTF_8);
    }

    private static void writeMarkdown(final Path file, final Metadata metadata,
                                      final Discovery discovery, final CorpusValidation validation,
                                      final List<BenchmarkResult> results) throws IOException {
        final StringBuilder out = new StringBuilder(12_000);
        out.append("# Replay performance benchmark\n\n")
                .append("This is an opt-in local macro benchmark. Raw results are ignored by Git.\n\n")
                .append("## Corpus\n\n")
                .append("- root: `").append(discovery.root()).append("`\n")
                .append("- explicit corpus path: ").append(discovery.explicitPath()).append("\n")
                .append("- discovered: ").append(discovery.samples().size()).append("\n")
                .append("- accepted full-pipeline corpus: ").append(validation.validSamples().size()).append("\n")
                .append("- total compressed bytes: ").append(discovery.samples().stream()
                        .mapToLong(ReplaySample::size).sum()).append("\n");
        out.append("- accepted files:\n");
        validation.validSamples().forEach(sample -> out.append("  - ").append(sample.path()).append('\n'));
        if (!combinedRejections(discovery, validation).isEmpty()) {
            out.append("- corpus rejections:\n");
            combinedRejections(discovery, validation)
                    .forEach(rejection -> out.append("  - ").append(rejection).append('\n'));
        }
        out.append("\n## Metadata\n\n")
                .append("- commit: `").append(metadata.commit()).append("`\n")
                .append("- dirty working tree: ").append(metadata.dirty()).append("\n")
                .append("- Java: `").append(metadata.javaVersion()).append("` / `")
                .append(metadata.jvmVendor()).append("`\n")
                .append("- OS: `").append(metadata.os()).append("`\n")
                .append("- CPU: `").append(metadata.cpuModel()).append("`\n")
                .append("- available processors: ").append(metadata.availableProcessors()).append("\n")
                .append("- heap max/initial: ").append(metadata.heapMaxBytes()).append(" / ")
                .append(metadata.heapInitialBytes()).append(" bytes\n")
                .append("- benchmark mode: `").append(metadata.benchmarkMode()).append("`\n")
                .append("- warmup/measurement rounds: ").append(metadata.warmupRounds()).append(" / ")
                .append(metadata.measurementRounds()).append("\n")
                .append("- fingerprint parity enabled: ").append(metadata.fingerprintVerification()).append("\n")
                .append("- JFR: `").append(metadata.jfrFile()).append("`\n\n")
                .append("## Measurements\n\n")
                .append("| Stage | C | Replays/s | MB/s | Mean ms | P50 ms | P95 ms | P99 ms | GC count/time ms | Peak heap |\n")
                .append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n");
        for (final BenchmarkResult result : results) {
            out.append('|').append(result.stage().label).append('|').append(result.concurrency())
                    .append('|').append(format(result.replaysPerSecond()))
                    .append('|').append(format(result.megabytesPerSecond()))
                    .append('|').append(format(result.meanMs()))
                    .append('|').append(format(result.p50Ms()))
                    .append('|').append(format(result.p95Ms()))
                    .append('|').append(format(result.p99Ms()))
                    .append('|').append(result.gcCollections()).append("/").append(result.gcTimeMs())
                    .append('|').append(result.peakHeapBytes()).append('|').append('\n');
        }
        out.append("\n## Interpretation checklist\n\n")
                .append("Use the JFR recording to inspect CPU methods, allocation by class and stack, GC pauses, "
                        + "monitor contention, thread states, file I/O, and socket I/O. Do not treat this fixture "
                        + "run as production capacity, and do not run a production benchmark through the public API.\n");
        Files.writeString(file, out, StandardCharsets.UTF_8);
    }

    private static long minSize(final List<ReplaySample> samples) {
        return samples.stream().mapToLong(ReplaySample::size).min().orElse(0L);
    }

    private static long maxSize(final List<ReplaySample> samples) {
        return samples.stream().mapToLong(ReplaySample::size).max().orElse(0L);
    }

    private static long medianSize(final List<ReplaySample> samples) {
        final long[] sizes = samples.stream().mapToLong(ReplaySample::size).sorted().toArray();
        return sizes.length == 0 ? 0L : sizes[sizes.length / 2];
    }

    private static String format(final double value) {
        return String.format(java.util.Locale.ROOT, "%.3f", value);
    }

    private static String json(final Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof Number number) {
            final double asDouble = number.doubleValue();
            return Double.isFinite(asDouble) ? number.toString() : "null";
        }
        if (value instanceof Boolean) {
            return value.toString();
        }
        if (value instanceof List<?> list) {
            return "[" + list.stream().map(ReplayPerformanceBenchmarkTest::json)
                    .collect(Collectors.joining(",")) + "]";
        }
        final String text = String.valueOf(value);
        final StringBuilder escaped = new StringBuilder(text.length() + 2).append('"');
        for (int i = 0; i < text.length(); i++) {
            final char c = text.charAt(i);
            switch (c) {
                case '\\' -> escaped.append("\\\\");
                case '"' -> escaped.append("\\\"");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (c < 0x20) {
                        escaped.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        escaped.append(c);
                    }
                }
            }
        }
        return escaped.append('"').toString();
    }

    private record ReplaySample(Path path, String name, byte[] bytes) {
        private long size() {
            return bytes.length;
        }
    }

    private record Discovery(Path root, List<ReplaySample> samples, List<String> rejections,
                             boolean explicitPath) {
    }

    private record CorpusValidation(List<ReplaySample> validSamples, List<String> rejections,
                                    Map<String, String> fingerprints) {
    }

    private record Round(List<TimedInvocation> invocations) {
    }

    private record TimedInvocation(String fileName, long elapsedNanos, StageOutput output) {
    }

    private record StageOutput(ReplayProcessingResult result, long packetCount, long eventCount,
                               long checkpointCount, long participantCount) {
        private static StageOutput empty() {
            return new StageOutput(null, 0L, 0L, 0L, 0L);
        }

        private static StageOutput from(final ReplayReconstruction reconstruction) {
            return new StageOutput(null,
                    reconstruction.diagnostics().packetCount(), reconstruction.events().size(),
                    reconstruction.checkpoints().size(), reconstruction.participants().size());
        }

        private static StageOutput from(final ReplayProcessingResult result) {
            final ReplayReconstruction reconstruction = result.reconstruction();
            return new StageOutput(result,
                    reconstruction.diagnostics().packetCount(), reconstruction.events().size(),
                    reconstruction.checkpoints().size(), reconstruction.participants().size());
        }
    }

    private record BenchmarkResult(Stage stage, int concurrency, int warmupRounds,
                                   int measurementRounds, long operations, long wallNanos,
                                   long processCpuNanos, double totalBytes, double replaysPerSecond,
                                   double megabytesPerSecond, double meanMs, double p50Ms,
                                   double p90Ms, double p95Ms, double p99Ms, double minMs,
                                   double maxMs, long gcCollections, long gcTimeMs,
                                   long heapBeforeBytes, long heapAfterBytes, long peakHeapBytes,
                                   long packetCount, long eventCount, long checkpointCount,
                                   long participantCount, int fingerprintsVerified) {
        private static BenchmarkResult of(final Stage stage, final int concurrency,
                                          final int warmupRounds, final int measurementRounds,
                                          final long operations, final long wallNanos,
                                          final long processCpuNanos, final double totalBytes,
                                          final List<Long> latencies, final long gcCollections,
                                          final long gcTimeMs, final long heapBeforeBytes,
                                          final long heapAfterBytes, final long peakHeapBytes,
                                          final long packetCount, final long eventCount,
                                          final long checkpointCount, final long participantCount,
                                          final int fingerprintsVerified, final double wallSeconds) {
            final List<Long> sorted = latencies.stream().sorted().toList();
            final double totalLatency = latencies.stream().mapToLong(Long::longValue).sum();
            return new BenchmarkResult(stage, concurrency, warmupRounds, measurementRounds,
                    operations, wallNanos, processCpuNanos, totalBytes,
                    operations / wallSeconds,
                    totalBytes / BYTES_PER_MIB / wallSeconds,
                    nanosToMs(totalLatency / latencies.size()), percentileMs(sorted, 0.50),
                    percentileMs(sorted, 0.90), percentileMs(sorted, 0.95), percentileMs(sorted, 0.99),
                    nanosToMs(sorted.getFirst()), nanosToMs(sorted.getLast()), gcCollections,
                    gcTimeMs, heapBeforeBytes, heapAfterBytes, peakHeapBytes, packetCount,
                    eventCount, checkpointCount, participantCount, fingerprintsVerified);
        }

        private static double percentileMs(final List<Long> sorted, final double percentile) {
            final int index = Math.min(sorted.size() - 1,
                    Math.max(0, (int) Math.ceil(percentile * sorted.size()) - 1));
            return nanosToMs(sorted.get(index));
        }

        private static double nanosToMs(final double nanos) {
            return nanos / 1_000_000.0;
        }

        private String toJson() {
            return "{" + "\"stage\":" + json(stage.label)
                    + ",\"concurrency\":" + concurrency
                    + ",\"warmupRounds\":" + warmupRounds
                    + ",\"measurementRounds\":" + measurementRounds
                    + ",\"operations\":" + operations
                    + ",\"totalWallMs\":" + json(wallNanos / 1_000_000.0)
                    + ",\"processCpuMs\":" + json(processCpuNanos / 1_000_000.0)
                    + ",\"replaysPerSecond\":" + json(replaysPerSecond)
                    + ",\"mbPerSecond\":" + json(megabytesPerSecond)
                    + ",\"meanMs\":" + json(meanMs) + ",\"p50Ms\":" + json(p50Ms)
                    + ",\"p90Ms\":" + json(p90Ms) + ",\"p95Ms\":" + json(p95Ms)
                    + ",\"p99Ms\":" + json(p99Ms) + ",\"minMs\":" + json(minMs)
                    + ",\"maxMs\":" + json(maxMs) + ",\"gcCollections\":" + gcCollections
                    + ",\"gcTimeMs\":" + gcTimeMs + ",\"heapBeforeBytes\":" + heapBeforeBytes
                    + ",\"heapAfterBytes\":" + heapAfterBytes + ",\"peakHeapBytes\":" + peakHeapBytes
                    + ",\"packetCount\":" + packetCount + ",\"eventCount\":" + eventCount
                    + ",\"checkpointCount\":" + checkpointCount + ",\"participantCount\":"
                    + participantCount + ",\"fingerprintsVerified\":" + fingerprintsVerified + "}";
        }

        private String toCsv() {
            return String.join(",", stage.label, Integer.toString(concurrency),
                    Integer.toString(warmupRounds), Integer.toString(measurementRounds),
                    Long.toString(operations), format(wallNanos / 1_000_000.0),
                    format(processCpuNanos / 1_000_000.0), format(replaysPerSecond),
                    format(megabytesPerSecond), format(meanMs), format(p50Ms), format(p90Ms),
                    format(p95Ms), format(p99Ms), format(minMs), format(maxMs),
                    Long.toString(gcCollections), Long.toString(gcTimeMs), Long.toString(heapBeforeBytes),
                    Long.toString(heapAfterBytes), Long.toString(peakHeapBytes), Long.toString(packetCount),
                    Long.toString(eventCount), Long.toString(checkpointCount), Long.toString(participantCount),
                    Integer.toString(fingerprintsVerified));
        }
    }

    private record GcSnapshot(long collectionCount, long collectionTimeMs) {
        private static GcSnapshot capture() {
            long count = 0L;
            long time = 0L;
            for (final GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
                final long beanCount = bean.getCollectionCount();
                final long beanTime = bean.getCollectionTime();
                if (beanCount >= 0L) {
                    count += beanCount;
                }
                if (beanTime >= 0L) {
                    time += beanTime;
                }
            }
            return new GcSnapshot(count, time);
        }
    }

    private record HeapSnapshot(long used, long peakUsed) {
        private static void resetPeaks() {
            for (final MemoryPoolMXBean pool : ManagementFactory.getMemoryPoolMXBeans()) {
                try {
                    pool.resetPeakUsage();
                } catch (final UnsupportedOperationException ignored) {
                    // Some JVM memory pools do not expose peak usage.
                }
            }
        }

        private static HeapSnapshot capture() {
            final MemoryMXBean heap = ManagementFactory.getMemoryMXBean();
            long peak = heap.getHeapMemoryUsage().getUsed();
            for (final MemoryPoolMXBean pool : ManagementFactory.getMemoryPoolMXBeans()) {
                try {
                    if (pool.getType() == MemoryType.HEAP) {
                        final var peakUsage = pool.getPeakUsage();
                        if (peakUsage != null) {
                            peak = Math.max(peak, peakUsage.getUsed());
                        }
                    }
                } catch (final UnsupportedOperationException ignored) {
                    // Some JVM memory pools do not expose peak usage.
                }
            }
            return new HeapSnapshot(heap.getHeapMemoryUsage().getUsed(), peak);
        }
    }

    private record Metadata(String timestamp, String commit, boolean dirty, String javaVersion,
                            String jvmVendor, String os, String cpuModel, int availableProcessors,
                            long heapInitialBytes, long heapMaxBytes, long physicalMemoryBytes,
                            int corpusFileCount, long corpusBytes, int warmupRounds,
                            int measurementRounds, int concurrency, String stage, String benchmarkMode,
                            boolean fingerprintVerification, String jfrFile) {
        private static Metadata capture(final Path repoRoot, final List<ReplaySample> samples,
                                        final int warmupRounds, final int measurementRounds,
                                        final int concurrency, final String stage,
                                        final String benchmarkMode,
                                        final boolean fingerprintVerification, final Path jfrFile) {
            final java.lang.management.OperatingSystemMXBean bean =
                    ManagementFactory.getOperatingSystemMXBean();
            final long physicalMemory = bean instanceof OperatingSystemMXBean os
                    ? os.getTotalMemorySize() : -1L;
            final Runtime runtime = Runtime.getRuntime();
            final long heapInitial = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getInit();
            return new Metadata(Instant.now().toString(), git(repoRoot, "rev-parse", "HEAD"),
                    !git(repoRoot, "status", "--porcelain").isBlank(),
                    System.getProperty("java.version"), System.getProperty("java.vendor"),
                    System.getProperty("os.name") + " " + System.getProperty("os.version"),
                    System.getenv().getOrDefault("PROCESSOR_IDENTIFIER", System.getProperty("os.arch")),
                    runtime.availableProcessors(), heapInitial, runtime.maxMemory(),
                    physicalMemory, samples.size(), samples.stream().mapToLong(ReplaySample::size).sum(),
                    warmupRounds, measurementRounds, concurrency, stage, benchmarkMode,
                    fingerprintVerification,
                    jfrFile == null ? "" : jfrFile.toString());
        }

        private String toJson() {
            return "{" + "\"timestamp\":" + json(timestamp) + ",\"commit\":" + json(commit)
                    + ",\"dirty\":" + dirty + ",\"javaVersion\":" + json(javaVersion)
                    + ",\"jvmVendor\":" + json(jvmVendor) + ",\"os\":" + json(os)
                    + ",\"cpuModel\":" + json(cpuModel) + ",\"availableProcessors\":"
                    + availableProcessors + ",\"heapInitialBytes\":" + heapInitialBytes
                    + ",\"heapMaxBytes\":" + heapMaxBytes + ",\"physicalMemoryBytes\":"
                    + physicalMemoryBytes + ",\"corpusFileCount\":" + corpusFileCount
                    + ",\"corpusBytes\":" + corpusBytes + ",\"warmupRounds\":" + warmupRounds
                    + ",\"measurementRounds\":" + measurementRounds + ",\"concurrency\":"
                    + concurrency + ",\"stage\":" + json(stage)
                    + ",\"benchmarkMode\":" + json(benchmarkMode)
                    + ",\"fingerprintVerification\":" + fingerprintVerification
                    + ",\"jfrFile\":" + json(jfrFile) + "}";
        }
    }

    private static String git(final Path root, final String... arguments) {
        try {
            final List<String> command = new ArrayList<>();
            command.add("git");
            command.add("-C");
            command.add(root.toString());
            command.addAll(List.of(arguments));
            final Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            final String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (process.waitFor() != 0) {
                return "unavailable";
            }
            return output;
        } catch (final Exception e) {
            return "unavailable";
        }
    }

    private enum Stage {
        ARCHIVE("archive"), PARSER("parser"), RECONSTRUCTION("reconstruction"), FULL("full");

        private final String label;

        Stage(final String label) {
            this.label = label;
        }

        private static Stage from(final String value) {
            return switch (value) {
                case "archive", "a" -> ARCHIVE;
                case "parser", "settlement", "b" -> PARSER;
                case "reconstruction", "reconstruct", "c" -> RECONSTRUCTION;
                case "full", "production", "d" -> FULL;
                default -> throw new IllegalArgumentException("Unknown -Dstage value: " + value);
            };
        }
    }
}
