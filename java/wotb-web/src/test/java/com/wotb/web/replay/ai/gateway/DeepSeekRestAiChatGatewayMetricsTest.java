package com.wotb.web.replay.ai.gateway;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.wotb.web.replay.ai.AiUpstreamException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 验证 Gateway upstream 指标语义：
 * <ul>
 *   <li>一次真实上游尝试只增加一次 request</li>
 *   <li>成功与失败都正确结束 Timer（duration 被记录）</li>
 *   <li>失败按错误码计入 error counter</li>
 * </ul>
 */
class DeepSeekRestAiChatGatewayMetricsTest {

    private static final String SUCCESS_RESPONSE =
            "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}";

    private HttpServer server;
    private final List<String> requestBodies = new ArrayList<>();
    private int responseStatus = 200;
    private SimpleMeterRegistry registry;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", this::handleRequest);
        server.start();
        registry = new SimpleMeterRegistry();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private void handleRequest(final HttpExchange exchange) throws IOException {
        requestBodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        final byte[] bytes = SUCCESS_RESPONSE.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        try {
            exchange.sendResponseHeaders(responseStatus, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }

    private DeepSeekRestAiChatGateway gatewayWithMetrics() throws Exception {
        final String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        final DeepSeekRestAiChatGateway gateway =
                new DeepSeekRestAiChatGateway("test-key", baseUrl, "test-model", 2);
        final Field f = DeepSeekRestAiChatGateway.class.getDeclaredField("meterRegistry");
        f.setAccessible(true);
        f.set(gateway, registry);
        gateway.initMetrics();
        return gateway;
    }

    private static AiChatRequest req() {
        return new AiChatRequest("s", "u", "test-model", null, 8192,
                true, "high", null, "TEST_MODE", null);
    }

    @Test
    void singleUpstreamAttemptIncrementsRequestOnce() throws Exception {
        final DeepSeekRestAiChatGateway gateway = gatewayWithMetrics();
        gateway.chat(req());

        assertEquals(1, requestBodies.size(), "exactly one upstream call expected");
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total").counter().count(),
                "one attempt must increment requests exactly once");
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds").timer().count(),
                "successful attempt must record duration");
    }

    @Test
    void upstreamFailureStopsTimer() throws Exception {
        responseStatus = 401;
        final DeepSeekRestAiChatGateway gateway = gatewayWithMetrics();

        assertThrows(AiUpstreamException.class, () -> gateway.chat(req()));

        assertEquals(1, requestBodies.size(), "upstream must be attempted once");
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total").counter().count(),
                "failed attempt still counts as one request");
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds").timer().count(),
                "timer must stop on failure too");
        assertTrue(registry.find("wotb_ai_upstream_errors_total").tag("type", "AI_AUTHENTICATION_ERROR")
                        .counter().count() >= 1L,
                "failure must record an error classification");
    }
}