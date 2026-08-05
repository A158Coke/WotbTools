package com.wotb.web.replay.ai.gateway;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.wotb.web.replay.ai.AiUpstreamException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link DeepSeekRestAiChatGateway} 的传输/错误分类/脱敏契约测试。
 * 使用本地 HttpServer 替代真实 DeepSeek，无真实 API 调用。
 */
class DeepSeekRestAiChatGatewayTest {

    private static final String SUCCESS_RESPONSE =
            "{\"choices\":[{\"message\":{\"content\":\"team review\"},\"finish_reason\":\"stop\"}]}";

    private HttpServer server;
    private final List<String> requestBodies = new CopyOnWriteArrayList<>();
    private final List<String> authorizationList = new CopyOnWriteArrayList<>();
    private int responseStatus = 200;
    private String responseBody = SUCCESS_RESPONSE;
    private long responseDelayMillis;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    private DeepSeekRestAiChatGateway startGateway(final int timeoutSec) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", this::handleRequest);
        server.start();
        final String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        return new DeepSeekRestAiChatGateway("test-key", baseUrl, "test-model", timeoutSec);
    }

    private void handleRequest(final HttpExchange exchange) throws IOException {
        requestBodies.add(new String(
                exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        authorizationList.add(exchange.getRequestHeaders().getFirst("Authorization"));
        if (responseDelayMillis > 0) {
            try {
                Thread.sleep(responseDelayMillis);
            } catch (final InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        final byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        try {
            exchange.sendResponseHeaders(responseStatus, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }

    private static AiChatRequest req(final String system, final String user) {
        return new AiChatRequest(system, user, "test-model", null, 8192,
                true, "high", null, "TEST_MODE", null);
    }

    // ========== 配置 ==========

    @Test
    void configuredWhenApiKeyPresent() throws IOException {
        final var gateway = startGateway(2);
        assertTrue(gateway.isConfigured());
    }

    @Test
    void notConfiguredWhenApiKeyBlank() {
        final var gateway = new DeepSeekRestAiChatGateway("  ", "http://x", "m", 2);
        assertFalse(gateway.isConfigured());
    }

    // ========== 正常请求映射 ==========

    @Test
    void passesSystemUserModelAndOptions() throws IOException {
        final var gateway = startGateway(2);
        final var resp = gateway.chat(req("SYS_PROMPT", "USER_PROMPT"));
        assertEquals("team review", resp.completionText());
        assertEquals("DeepSeek", resp.provider());
        assertEquals("test-model", resp.model());
        assertEquals("stop", resp.finishReason());
        assertEquals("Bearer test-key", authorizationList.getLast());
        final String body = requestBodies.getLast();
        assertTrue(body.contains("\"model\":\"test-model\""));
        assertTrue(body.contains("\"max_tokens\":8192"));
        assertTrue(body.contains("\"thinking\":{\"type\":\"enabled\"}"));
        assertTrue(body.contains("\"reasoning_effort\":\"high\""));
        assertTrue(body.contains("SYS_PROMPT"));
        assertTrue(body.contains("USER_PROMPT"));
        assertTrue(body.contains("\"role\":\"system\""));
        assertTrue(body.contains("\"role\":\"user\""));
    }

    @Test
    void usesDefaultModelWhenRequestModelBlank() throws IOException {
        final var gateway = startGateway(2);
        gateway.chat(new AiChatRequest("s", "u", " ", null, 100,
                false, null, null, "M", null));
        final String body = requestBodies.getLast();
        assertTrue(body.contains("\"model\":\"test-model\""));
        assertTrue(body.contains("\"thinking\":{\"type\":\"disabled\"}"));
        assertFalse(body.contains("reasoning_effort"));
    }

    @Test
    void generatesCorrelationIdWhenAbsent() throws IOException {
        final var gateway = startGateway(2);
        final var resp = gateway.chat(req("s", "u"));
        assertTrue(StringUtils.hasText(resp.metadata().get("correlationId")));
    }

    // ========== token usage ==========

    @Test
    void extractsTokenUsage() throws IOException {
        responseBody = "{\"choices\":[{\"message\":{\"content\":\"ok\"}}],"
                + "\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":22,\"total_tokens\":33,"
                + "\"completion_tokens_details\":{\"reasoning_tokens\":7},"
                + "\"prompt_cache_hit_tokens\":3,\"prompt_cache_miss_tokens\":8}}";
        final var gateway = startGateway(2);
        final var resp = gateway.chat(req("s", "u"));
        assertEquals(11, resp.inputTokens());
        assertEquals(22, resp.outputTokens());
        assertEquals(33, resp.totalTokens());
        assertEquals(7, resp.reasoningTokens());
        assertEquals(3, resp.cacheHitTokens());
        assertEquals(8, resp.cacheMissTokens());
    }

    @Test
    void missingUsageDefaultsToZero() throws IOException {
        final var gateway = startGateway(2);
        final var resp = gateway.chat(req("s", "u"));
        assertEquals(0, resp.inputTokens());
        assertEquals(0, resp.outputTokens());
        assertEquals(0, resp.totalTokens());
        assertEquals(0, resp.reasoningTokens());
    }

    // ========== 响应异常 ==========

    @Test
    void emptyCompletionThrowsStableCode() throws IOException {
        responseBody = "{\"choices\":[{\"message\":{\"content\":\"\"}}]}";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertTrue(error.code().equals("AI_EMPTY_RESPONSE")
                        || error.code().equals("AI_RESPONSE_INVALID"),
                "Should produce a stable error code, got: " + error.code());
        assertTrue(StringUtils.hasText(error.correlationId()));
    }

    @Test
    void nullResponseThrowsResponseInvalid() throws IOException {
        responseBody = "null";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals("AI_RESPONSE_INVALID", error.code());
    }

    @Test
    void missingChoicesThrowsResponseInvalid() throws IOException {
        responseBody = "{\"usage\":{}}";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals("AI_RESPONSE_INVALID", error.code());
    }

    @Test
    void malformedJsonUsesResponseInvalid() throws IOException {
        responseBody = "{\"choices\":[{";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals("AI_RESPONSE_INVALID", error.code());
    }

    // ========== HTTP 错误分类 ==========

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 408, 429, 500, 503})
    void providerHttpFailuresUseStableErrorCodes(final int status) throws IOException {
        final String expectedCode = switch (status) {
            case 400 -> "AI_INVALID_REQUEST";
            case 401, 403 -> "AI_AUTHENTICATION_ERROR";
            case 408 -> "AI_TIMEOUT";
            case 429 -> "AI_RATE_LIMITED";
            case 500, 503 -> "AI_UPSTREAM_UNAVAILABLE";
            default -> throw new IllegalArgumentException("Unexpected status: " + status);
        };
        responseStatus = status;
        responseBody = "{\"error\":\"provider detail token=secret-value\"}";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals(expectedCode, error.code());
        assertEquals(status, error.providerStatus().intValue());
        assertNotNull(error.correlationId());
        assertTrue(StringUtils.hasText(error.correlationId()));
        assertEquals(expectedCode, error.getMessage());
    }

    @Test
    void contextLengthFailureUsesSpecificCode() throws IOException {
        responseStatus = 400;
        responseBody = "{\"error\":\"maximum context length exceeded\"}";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals("AI_CONTEXT_TOO_LARGE", error.code());
    }

    @Test
    void timeoutUsesTimeoutCode() throws IOException {
        responseDelayMillis = 3000;
        final var gateway = startGateway(1);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals("AI_TIMEOUT", error.code());
    }

    // ========== 脱敏 ==========

    @Test
    void errorMessageDoesNotLeakSecret() throws IOException {
        responseStatus = 401;
        responseBody = "{\"error\":\"x-api-key=test-secret-123\"}";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals("AI_AUTHENTICATION_ERROR", error.code());
        assertEquals(401, error.providerStatus().intValue());
        assertFalse(error.getMessage().contains("test-secret-123"));
    }

    @Test
    void logCaptureDoesNotContainSecret() throws IOException {
        responseStatus = 429;
        responseBody = "{\"error\":\"Authorization: Bearer sk-live-xxx\"}";
        final var gateway = startGateway(2);
        final var error = assertThrows(AiUpstreamException.class,
                () -> gateway.chat(req("s", "u")));
        assertEquals("AI_RATE_LIMITED", error.code());
        assertFalse(error.getMessage().contains("sk-live-xxx"));
        assertFalse(error.getMessage().contains("Bearer"));
    }

    @Test
    void realLogCaptureDoesNotContainSecret() throws IOException {
        final ch.qos.logback.classic.Logger logbackLogger =
                (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
                        "com.wotb.web.replay.ai.gateway.DeepSeekRestAiChatGateway");
        final ch.qos.logback.classic.Level oldLevel = logbackLogger.getLevel();
        logbackLogger.setLevel(ch.qos.logback.classic.Level.ALL);
        final ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logbackLogger.addAppender(appender);
        try {
            responseStatus = 401;
            responseBody = "{\"error\":\"x-api-key=my-secret-key-456\"}";
            final var gateway = startGateway(2);
            assertThrows(AiUpstreamException.class, () -> gateway.chat(req("s", "u")));
            boolean foundWarning = false;
            for (final ch.qos.logback.classic.spi.ILoggingEvent event : appender.list) {
                if (event.getLevel() == ch.qos.logback.classic.Level.WARN) {
                    foundWarning = true;
                    final String full = event.getFormattedMessage();
                    assertTrue(full.contains("AI_AUTHENTICATION_ERROR"), "Log must contain error code: " + full);
                    assertTrue(full.contains("401"), "Log must contain status: " + full);
                    assertTrue(full.contains("correlationId="), "Log must contain correlationId: " + full);
                    assertTrue(full.contains("[PROVIDER_BODY_REDACTED]")
                                    || full.contains("empty provider error body"),
                            "Log must contain redacted placeholder or empty body indicator: " + full);
                    assertFalse(full.contains("my-secret-key-456"), "Log must not contain secret: " + full);
                }
            }
            assertTrue(foundWarning, "Must have captured a WARNING log");
        } finally {
            logbackLogger.detachAppender(appender);
            logbackLogger.setLevel(oldLevel);
        }
    }

    // ========== safeProviderSummary 脱敏 ==========

    @Test
    void safeProviderSummaryAlwaysRedacts() {
        assertEquals("[PROVIDER_BODY_REDACTED]",
                DeepSeekRestAiChatGateway.safeProviderSummary("Authorization: Bearer my-secret"));
        assertEquals("[PROVIDER_BODY_REDACTED]",
                DeepSeekRestAiChatGateway.safeProviderSummary("{\"api-key\":\"secret-123\"}"));
        assertEquals("[PROVIDER_BODY_REDACTED]",
                DeepSeekRestAiChatGateway.safeProviderSummary("Bearer sk-live-123"));
        assertEquals("[PROVIDER_BODY_REDACTED]",
                DeepSeekRestAiChatGateway.safeProviderSummary("Basic dXNlcjpwYXNz"));
        assertEquals("[PROVIDER_BODY_REDACTED]",
                DeepSeekRestAiChatGateway.safeProviderSummary(
                        "{\"X-Api-Key\":\"sensitive\",\"Authorization\":\"Bearer tok\"}"));
        assertEquals("[PROVIDER_BODY_REDACTED]",
                DeepSeekRestAiChatGateway.safeProviderSummary("customscheme abc"));
        assertEquals("[PROVIDER_BODY_REDACTED]",
                DeepSeekRestAiChatGateway.safeProviderSummary("The quick brown fox jumps over the lazy dog"));
        assertEquals("empty provider error body",
                DeepSeekRestAiChatGateway.safeProviderSummary(""));
        assertEquals("empty provider error body",
                DeepSeekRestAiChatGateway.safeProviderSummary(null));
    }

    // ========== 静态错误分类 ==========

    @Test
    void classifyHttpErrorCoversAllBranches() {
        assertEquals("AI_INVALID_REQUEST", DeepSeekRestAiChatGateway.classifyHttpError(400, ""));
        assertEquals("AI_INVALID_REQUEST", DeepSeekRestAiChatGateway.classifyHttpError(422, ""));
        assertEquals("AI_AUTHENTICATION_ERROR", DeepSeekRestAiChatGateway.classifyHttpError(401, ""));
        assertEquals("AI_AUTHENTICATION_ERROR", DeepSeekRestAiChatGateway.classifyHttpError(403, ""));
        assertEquals("AI_TIMEOUT", DeepSeekRestAiChatGateway.classifyHttpError(408, ""));
        assertEquals("AI_RATE_LIMITED", DeepSeekRestAiChatGateway.classifyHttpError(429, ""));
        assertEquals("AI_UPSTREAM_UNAVAILABLE", DeepSeekRestAiChatGateway.classifyHttpError(500, ""));
        assertEquals("AI_UPSTREAM_UNAVAILABLE", DeepSeekRestAiChatGateway.classifyHttpError(503, ""));
        assertEquals("AI_CONTEXT_TOO_LARGE", DeepSeekRestAiChatGateway.classifyHttpError(413, ""));
        assertEquals("AI_CONTEXT_TOO_LARGE",
                DeepSeekRestAiChatGateway.classifyHttpError(400, "maximum context length exceeded"));
        assertEquals("AI_INVALID_REQUEST", DeepSeekRestAiChatGateway.classifyHttpError(418, ""));
    }
}