package com.wotb.ai.review;

import com.wotb.ai.config.AiModelProperties;
import com.wotb.ai.gateway.SpringAiChatGateway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import jdk.jfr.Recording;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Tag("ai-live")
class AiVirtualThreadBenchmarkTest extends AiVirtualThreadBenchmarkSupport {

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
}
