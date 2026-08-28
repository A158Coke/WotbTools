package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import com.wotb.web.config.AiModelProperties;

/**
 * docs/architecture/ai-review.md §57/§61 敏感数据回归：AI Review 全链路事件日志（ai_upstream_call_* /
 * AI usage / AI provider failure）必须不含 API key、Authorization、prompt、completion、
 * 回放内容等敏感文本；只记录低基数 metadata。
 */
class SpringAiChatGatewaySensitiveLogTest {

    private static final String FAKE_API_KEY = "sk-test-sensitive-1234567890abcdef";
    private static final String SYSTEM_PROMPT = "system-instructions-secret";
    private static final String USER_PROMPT = "player-evidence-secret";
    private static final String COMPLETION = "tactical review secret completion";

    private final List<CapturedRequest> requests = new CopyOnWriteArrayList<>();
    private HttpServer server;
    private ListAppender<ILoggingEvent> appender;
    private Logger gatewayLogger;

    @BeforeEach
    void setUp() throws IOException {
        gatewayLogger = (Logger) LoggerFactory.getLogger(SpringAiChatGateway.class);
        appender = new ListAppender<>();
        appender.start();
        gatewayLogger.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        gatewayLogger.detachAppender(appender);
        if (server != null) {
            server.stop(0);
        }
    }

    private void startServer(final int status, final String body) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            final byte[] requestBody = exchange.getRequestBody().readAllBytes();
            requests.add(new CapturedRequest(new String(requestBody, StandardCharsets.UTF_8)));
            final byte[] responseBytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, responseBytes.length);
            exchange.getResponseBody().write(responseBytes);
            exchange.close();
        });
        server.start();
    }

    @Test
    void successPathLogsNeverContainSensitiveData() throws Exception {
        startServer(200, completionJson());
        final SpringAiChatGateway gateway = gateway();
        gateway.chat(new AiChatRequest(
                SYSTEM_PROMPT, USER_PROMPT, "deepseek-v4-flash",
                null, 4096, true, "max", "corr-sensitive", "SINGLE_TEAM_BATTLE", 315,
                AiResponseFormat.JSON_OBJECT));

        final String all = formattedLogs();
        assertTrue(all.contains("event=ai_upstream_call_started"),
                "必须记录 ai_upstream_call_started 事件");
        assertTrue(all.contains("event=ai_upstream_call_completed"),
                "必须记录 ai_upstream_call_completed 事件");
        assertTrue(all.contains("responseFormat=JSON_OBJECT"),
                "事件日志必须携带 responseFormat（§17）");
        assertSensitiveAbsent(all);
    }

    @Test
    void failurePathLogsNeverContainSensitiveDataOrRawProviderBody() throws Exception {
        // 恶意 provider 500 响应体回显 API key：safeProviderSummary 必须整体脱敏。
        startServer(500, "{\"error\":\"unauthorized " + FAKE_API_KEY + "\"}");
        // retryMaxAttempts=1：500 不重试，避免测试等待退避。
        final SpringAiChatGateway gateway = gateway(1);
        try {
            gateway.chat(new AiChatRequest(
                    SYSTEM_PROMPT, USER_PROMPT, "deepseek-v4-flash",
                    null, 4096, true, "max", "corr-sensitive-fail", "SINGLE_PLAYER_BATTLE", 315,
                    AiResponseFormat.TEXT));
        } catch (final AiUpstreamException expected) {
            // AI_UPSTREAM_UNAVAILABLE (500) — 预期失败
        }

        final String all = formattedLogs();
        assertTrue(all.contains("event=ai_upstream_call_failed"),
                "必须记录 ai_upstream_call_failed 事件（§42）");
        assertSensitiveAbsent(all);
        assertFalse(all.contains("unauthorized"),
                "provider 错误体必须整体脱敏（[PROVIDER_BODY_REDACTED]），不得泄露原始内容");
    }

    private void assertSensitiveAbsent(final String all) {
        assertFalse(all.contains(FAKE_API_KEY), "日志不得包含 API key");
        assertFalse(all.contains("Authorization"), "日志不得包含 Authorization header");
        assertFalse(all.contains(SYSTEM_PROMPT), "日志不得包含 systemPrompt");
        assertFalse(all.contains(USER_PROMPT), "日志不得包含 userPrompt");
        assertFalse(all.contains(COMPLETION), "日志不得包含 completion");
    }

    private String formattedLogs() {
        return appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .collect(Collectors.joining("\n"));
    }

    private SpringAiChatGateway gateway() {
        return gateway(3);
    }

    private SpringAiChatGateway gateway(final int retryMaxAttempts) {
        final String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        return SpringAiChatGateway.fromProperties(new AiModelProperties(
                FAKE_API_KEY, baseUrl, "deepseek-v4-flash",
                10, 300, 315, retryMaxAttempts, 0, 0, 2.0,
                1_000_000, 940_000, 32_768, 16_384, true, "max", false, 4096), null);
    }

    private static String completionJson() {
        return "{\"id\":\"chatcmpl-sensitive\",\"object\":\"chat.completion\","
                + "\"created\":1,\"model\":\"deepseek-v4-flash\",\"choices\":[{\"index\":0,"
                + "\"message\":{\"role\":\"assistant\",\"content\":\"" + COMPLETION + "\"},"
                + "\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":11,"
                + "\"completion_tokens\":22,\"total_tokens\":33}}";
    }

    private record CapturedRequest(String body) {
    }
}