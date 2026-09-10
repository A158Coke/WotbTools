package com.wotb.web.replay.ai;

import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.ai.gateway.SpringAiChatGateway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.ThreadMXBean;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.ToLongFunction;
import java.util.stream.Collectors;
import jdk.jfr.Configuration;
import jdk.jfr.Recording;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Explicit real-provider benchmark for the bounded AI worker thread model.
 * It is deliberately independent from replay processing and uses a tiny fixed
 * prompt so provider generation cost does not dominate the thread comparison.
 *
 * <p>Run only with an out-of-band key and an explicit enable flag:</p>
 * <pre>
 * $env:AI_API_KEY = "..."
 * mvn -pl wotb-web -am test `
 *   "-Dtest=AiVirtualThreadBenchmarkTest" `
 *   "-Dai.probe.excludedGroups=" `
 *   "-Dai.vt.enabled=true" `
 *   "-Dai.vt.jfrFile=target/ai-vt-benchmark/ai-vt.jfr"
 * </pre>
 *
 * <p>The benchmark concurrency values are experimental admission limits for
 * this test only. They do not change production AI or replay limits.</p>
 */
@Tag("ai-live")
class AiVirtualThreadBenchmarkTest {

    private static final String PROMPT = "Return exactly: OK";
    private static final String SYSTEM_PROMPT = "You are a latency benchmark endpoint. Follow the user exactly.";
    private static final int CALL_TIMEOUT_SEC = 75;
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void comparePlatformAndVirtualWorkers() throws Exception {
        Assumptions.assumeTrue(Boolean.parseBoolean(
                        System.getProperty("ai.vt.enabled", "false")),
                "live benchmark disabled; set -Dai.vt.enabled=true");
        final String apiKey = System.getenv("AI_API_KEY");
        Assumptions.assumeTrue(apiKey != null && !apiKey.isBlank(), "AI_API_KEY env missing");

        final int warmupRequests = boundedInt("ai.vt.warmupRequests", 2, 1, 3);
        final int measurementRequests = boundedInt("ai.vt.measurementRequests", 10, 1, 20);
        final List<Integer> concurrencies = parseConcurrencies(
                System.getProperty("ai.vt.concurrencies", "1,2,5,10"));
        final String model = System.getenv().getOrDefault("AI_MODEL", "deepseek-v4-flash");
        final AiModelProperties properties = new AiModelProperties(
                apiKey,
                System.getenv().getOrDefault("AI_BASE_URL", "https://api.deepseek.com"),
                model,
                5, 60, CALL_TIMEOUT_SEC, 1, 0, 0, 1.0,
                16_384, 512, 16, 0,
                false, "max", false, 16);
        final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(properties, null);
        final List<VariantResult> results = new ArrayList<>();
        for (final int concurrency : concurrencies) {
            runBatch(gateway, model, false, concurrency, warmupRequests, false);
            runBatch(gateway, model, true, concurrency, warmupRequests, false);
        }
        final Recording recording = startRecording();
        try {
            for (final int concurrency : concurrencies) {
                results.add(runBatch(gateway, model, false, concurrency,
                        measurementRequests, true));
                results.add(runBatch(gateway, model, true, concurrency,
                        measurementRequests, true));
            }
        } finally {
            stopRecording(recording);
        }
        writeReport(model, warmupRequests, measurementRequests, concurrencies, results);
        assertTrue(results.stream().allMatch(result -> result.completed() == result.requestCount()),
                "AI VT benchmark must complete every request; inspect target/ai-vt-benchmark");
    }

    private static VariantResult runBatch(final SpringAiChatGateway gateway,
                                          final String model,
                                          final boolean virtualThreads,
                                          final int concurrency,
                                          final int requestCount,
                                          final boolean measured) throws InterruptedException {
        final ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();
        final MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        final ProcessCpu processCpu = ProcessCpu.capture();
        final GcSnapshot gcBefore = GcSnapshot.capture();
        final long heapBefore = memoryBean.getHeapMemoryUsage().getUsed();
        final long wallStart = System.nanoTime();
        final AtomicInteger active = new AtomicInteger();
        final AtomicInteger peakActive = new AtomicInteger();
        final AtomicInteger virtualTasks = new AtomicInteger();
        final AtomicInteger platformTasks = new AtomicInteger();
        final AtomicInteger completed = new AtomicInteger();
        final AtomicInteger successes = new AtomicInteger();
        final AtomicInteger unexpectedResponses = new AtomicInteger();
        final AtomicReference<String> firstFailure = new AtomicReference<>();
        final List<Sample> samples = Collections.synchronizedList(new ArrayList<>());
        final Map<String, AtomicInteger> failures = new java.util.concurrent.ConcurrentHashMap<>();
        final Map<String, AtomicInteger> providerStatuses = new java.util.concurrent.ConcurrentHashMap<>();
        final CountDownLatch done = new CountDownLatch(requestCount);
        final AiReviewWorkerExecutor executor = new AiReviewWorkerExecutor(
                concurrency, requestCount, CALL_TIMEOUT_SEC, virtualThreads, null);
        try {
            for (int i = 0; i < requestCount; i++) {
                final long submitted = System.nanoTime();
                executor.execute(() -> {
                    final long started = System.nanoTime();
                    final int currentActive = active.incrementAndGet();
                    peakActive.accumulateAndGet(currentActive, Math::max);
                    if (Thread.currentThread().isVirtual()) {
                        virtualTasks.incrementAndGet();
                    } else {
                        platformTasks.incrementAndGet();
                    }
                    final long queueWait = started - submitted;
                    final long providerStart = System.nanoTime();
                    boolean success = false;
                    long providerDuration = 0L;
                    String failure = null;
                    Integer providerStatus = null;
                    int responseLength = 0;
                    try {
                        final AiChatResponse response = gateway.chat(new AiChatRequest(
                                SYSTEM_PROMPT, PROMPT, model, null, 16, false, null,
                                null, "AI_VT_BENCHMARK", CALL_TIMEOUT_SEC,
                                AiResponseFormat.TEXT));
                        responseLength = response.completionText().length();
                        success = !response.completionText().isBlank();
                        if (!PROMPT.substring(PROMPT.indexOf(':') + 1).trim()
                                .equals(response.completionText().trim())) {
                            unexpectedResponses.incrementAndGet();
                        }
                    } catch (final RuntimeException error) {
                        if (error instanceof AiUpstreamException upstream) {
                            failure = upstream.code();
                            providerStatus = upstream.providerStatus();
                            if (providerStatus != null) {
                                providerStatuses.computeIfAbsent(String.valueOf(providerStatus),
                                                ignored -> new AtomicInteger())
                                        .incrementAndGet();
                            }
                        } else {
                            failure = error.getClass().getSimpleName();
                        }
                        failures.computeIfAbsent(failure, ignored -> new AtomicInteger())
                                .incrementAndGet();
                        firstFailure.compareAndSet(null, failure);
                    } finally {
                        providerDuration = System.nanoTime() - providerStart;
                        samples.add(new Sample(
                                queueWait, providerDuration, System.nanoTime() - submitted,
                                success, Thread.currentThread().isVirtual(), failure,
                                providerStatus, responseLength));
                        if (success) {
                            successes.incrementAndGet();
                        }
                        completed.incrementAndGet();
                        active.decrementAndGet();
                        done.countDown();
                    }
                });
            }
            final long timeoutSeconds = Math.max(180L,
                    (long) CALL_TIMEOUT_SEC * Math.max(1, requestCount / concurrency + 1) + 30L);
            assertTrue(done.await(timeoutSeconds, TimeUnit.SECONDS),
                    "AI VT benchmark timed out: variant=" + (virtualThreads ? "VT" : "PT")
                            + " concurrency=" + concurrency);
        } finally {
            executor.close();
        }
        if (!measured) {
            return null;
        }
        final long wallNanos = System.nanoTime() - wallStart;
        final long heapAfter = memoryBean.getHeapMemoryUsage().getUsed();
        final GcSnapshot gcAfter = GcSnapshot.capture();
        final ProcessCpu processCpuAfter = ProcessCpu.capture();
        final Map<String, Integer> failureCounts = failures.entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, entry -> entry.getValue().get(),
                        Integer::sum, LinkedHashMap::new));
        return new VariantResult(
                virtualThreads ? "virtual" : "platform", concurrency, requestCount,
                completed.get(), successes.get(), unexpectedResponses.get(), peakActive.get(),
                virtualTasks.get(), platformTasks.get(), threadBean.getPeakThreadCount(),
                threadBean.getThreadCount(), wallNanos, processCpu.cpuNanos(),
                processCpuAfter.cpuNanos() - processCpu.cpuNanos(), heapBefore, heapAfter,
                gcAfter.count() - gcBefore.count(), gcAfter.timeMillis() - gcBefore.timeMillis(),
                failureCounts, firstFailure.get(), percentiles(samples, Sample::totalNanos),
                percentiles(samples, Sample::providerNanos),
                percentiles(samples, Sample::queueWaitNanos),
                providerStatuses.entrySet().stream().collect(Collectors.toMap(
                        Map.Entry::getKey, entry -> entry.getValue().get(), Integer::sum,
                        LinkedHashMap::new)));
    }

    private static Map<String, Double> percentiles(final List<Sample> samples,
                                                   final ToLongFunction<Sample> value) {
        final List<Long> sorted = samples.stream().map(value::applyAsLong)
                .sorted().toList();
        final Map<String, Double> result = new LinkedHashMap<>();
        result.put("p50_ms", percentile(sorted, 0.50));
        result.put("p95_ms", percentile(sorted, 0.95));
        result.put("p99_ms", percentile(sorted, 0.99));
        return result;
    }

    private static double percentile(final List<Long> sorted, final double quantile) {
        if (sorted.isEmpty()) {
            return 0.0;
        }
        final int index = Math.min(sorted.size() - 1,
                Math.max(0, (int) Math.ceil(quantile * sorted.size()) - 1));
        return sorted.get(index) / 1_000_000.0;
    }

    private static int boundedInt(final String property, final int fallback,
                                  final int min, final int max) {
        final int value = Integer.parseInt(System.getProperty(property, String.valueOf(fallback)));
        if (value < min || value > max) {
            throw new IllegalArgumentException(property + " must be in [" + min + ", " + max + "]: " + value);
        }
        return value;
    }

    private static List<Integer> parseConcurrencies(final String raw) {
        final List<Integer> result = new ArrayList<>();
        for (final String token : raw.split(",")) {
            final int value = Integer.parseInt(token.trim());
            if (value < 1 || value > 10 || result.contains(value)) {
                throw new IllegalArgumentException("ai.vt.concurrencies values must be unique and in [1, 10]: " + raw);
            }
            result.add(value);
        }
        if (result.isEmpty()) {
            throw new IllegalArgumentException("ai.vt.concurrencies must not be empty");
        }
        return List.copyOf(result);
    }

    private static Recording startRecording() throws Exception {
        final String configured = System.getProperty("ai.vt.jfrFile", "").trim();
        if (configured.isBlank()) {
            return null;
        }
        final Path path = Path.of(configured);
        Files.createDirectories(path.toAbsolutePath().getParent());
        final Recording recording = new Recording(Configuration.getConfiguration("profile"));
        recording.setName("wotb-ai-platform-vs-virtual");
        recording.setDestination(path);
        recording.start();
        return recording;
    }

    private static void stopRecording(final Recording recording) throws IOException {
        if (recording == null) {
            return;
        }
        try {
            recording.stop();
        } finally {
            recording.close();
        }
    }

    private static void writeReport(final String model, final int warmupRequests,
                                    final int measurementRequests,
                                    final List<Integer> concurrencies,
                                    final List<VariantResult> results) throws IOException {
        final Path dir = Path.of("target", "ai-vt-benchmark");
        Files.createDirectories(dir);
        final Map<String, Object> report = new LinkedHashMap<>();
        report.put("generatedAt", Instant.now().toString());
        report.put("javaVersion", System.getProperty("java.version"));
        report.put("model", model);
        report.put("prompt", PROMPT);
        report.put("warmupRequests", warmupRequests);
        report.put("measurementRequests", measurementRequests);
        report.put("concurrencies", concurrencies);
        report.put("results", results.stream().map(VariantResult::asMap).toList());
        Files.writeString(dir.resolve("ai-vt-benchmark.json"),
                MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(report));

        final StringBuilder markdown = new StringBuilder("# AI Platform vs Virtual Thread Benchmark\n\n");
        markdown.append("Java: ").append(System.getProperty("java.version"))
                .append("\nModel: ").append(model)
                .append("\nPrompt: `").append(PROMPT).append("`\n\n")
                .append("This is a real-provider blocking-call benchmark, not a replay throughput claim.\n\n")
                .append("| variant | concurrency | completed | wall ms | total p50/p95/p99 ms | provider p50/p95/p99 ms | queue p50/p95/p99 ms | peak active | virtual tasks | platform tasks | CPU ms | GC ms | failures | statuses |\n")
                .append("|---|---:|---:|---:|---|---|---|---:|---:|---:|---:|---:|---|---|\n");
        for (final VariantResult result : results) {
            markdown.append('|').append(result.variant()).append('|').append(result.concurrency())
                    .append('|').append(result.completed()).append('|')
                    .append(result.wallNanos() / 1_000_000.0).append('|')
                    .append(formatPercentiles(result.totalMs())).append('|')
                    .append(formatPercentiles(result.providerMs())).append('|')
                    .append(formatPercentiles(result.queueWaitMs())).append('|')
                    .append(result.peakActive()).append('|').append(result.virtualTasks()).append('|')
                    .append(result.platformTasks()).append('|')
                    .append(result.cpuDeltaNanos() / 1_000_000.0).append('|')
                    .append(result.gcTimeMillis()).append('|').append(result.failures()).append('|')
                    .append(result.providerStatuses()).append("|\n");
        }
        Files.writeString(dir.resolve("ai-vt-benchmark.md"), markdown.toString());
    }

    private static String formatPercentiles(final Map<String, Double> values) {
        return String.format(java.util.Locale.ROOT, "%.1f / %.1f / %.1f",
                values.get("p50_ms"), values.get("p95_ms"), values.get("p99_ms"));
    }

    private record Sample(long queueWaitNanos, long providerNanos, long totalNanos,
                          boolean success, boolean virtual, String failure,
                          Integer providerStatus, int responseLength) {
    }

    private record VariantResult(String variant, int concurrency, int requestCount,
                                 int completed, int successes, int unexpectedResponses,
                                 int peakActive, int virtualTasks, int platformTasks,
                                 int peakLiveThreads, int endingLiveThreads,
                                 long wallNanos, long processCpuNanos,
                                 long cpuDeltaNanos, long heapBefore, long heapAfter,
                                 long gcCount, long gcTimeMillis,
                                 Map<String, Integer> failures, String firstFailure,
                                 Map<String, Double> totalMs, Map<String, Double> providerMs,
                                 Map<String, Double> queueWaitMs,
                                 Map<String, Integer> providerStatuses) {
        Map<String, Object> asMap() {
            final Map<String, Object> result = new LinkedHashMap<>();
            result.put("variant", variant);
            result.put("concurrency", concurrency);
            result.put("requestCount", requestCount);
            result.put("completed", completed);
            result.put("successes", successes);
            result.put("unexpectedResponses", unexpectedResponses);
            result.put("peakActive", peakActive);
            result.put("virtualTasks", virtualTasks);
            result.put("platformTasks", platformTasks);
            result.put("peakLiveThreads", peakLiveThreads);
            result.put("endingLiveThreads", endingLiveThreads);
            result.put("wallMs", wallNanos / 1_000_000.0);
            result.put("processCpuMs", processCpuNanos / 1_000_000.0);
            result.put("cpuDeltaMs", cpuDeltaNanos / 1_000_000.0);
            result.put("heapBefore", heapBefore);
            result.put("heapAfter", heapAfter);
            result.put("gcCount", gcCount);
            result.put("gcTimeMs", gcTimeMillis);
            result.put("failures", failures);
            result.put("providerStatuses", providerStatuses);
            result.put("firstFailure", firstFailure);
            result.put("totalMs", totalMs);
            result.put("providerMs", providerMs);
            result.put("queueWaitMs", queueWaitMs);
            return result;
        }
    }

    private record GcSnapshot(long count, long timeMillis) {
        static GcSnapshot capture() {
            long count = 0;
            long time = 0;
            for (final GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
                if (bean.getCollectionCount() >= 0) {
                    count += bean.getCollectionCount();
                }
                if (bean.getCollectionTime() >= 0) {
                    time += bean.getCollectionTime();
                }
            }
            return new GcSnapshot(count, time);
        }
    }

    private record ProcessCpu(long cpuNanos) {
        static ProcessCpu capture() {
            final java.lang.management.OperatingSystemMXBean bean =
                    ManagementFactory.getOperatingSystemMXBean();
            if (bean instanceof com.sun.management.OperatingSystemMXBean extended) {
                return new ProcessCpu(Math.max(0L, extended.getProcessCpuTime()));
            }
            return new ProcessCpu(0L);
        }
    }
}
