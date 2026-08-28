package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.InetAddress;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.wotb.web.config.AiModelProperties;

/**
 * HTTP boundary test: a real Spring AI {@code OpenAiChatModel} plus
 * {@link SpringAiChatGateway} talk to a loopback JDK HttpServer, never to an
 * external network. Verifies the final DeepSeek-compatible request body
 * (path, Authorization scheme, model, messages, max_tokens, thinking and
 * reasoning_effort) and completion parsing. The API key is a synthetic value
 * and assertions never print it in failure messages.
 */
class SpringAiChatGatewayHttpBoundaryTest {

    private static final String FAKE_API_KEY = "sk-test-boundary-1234567890abcdef";

    private final List<CapturedRequest> requests = new CopyOnWriteArrayList<>();
    private HttpServer server;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            final byte[] body = exchange.getRequestBody().readAllBytes();
            requests.add(new CapturedRequest(
                    exchange.getRequestURI().getPath(),
                    exchange.getRequestHeaders().getFirst("Authorization"),
                    new String(body, StandardCharsets.UTF_8)));
            final byte[] responseBytes = completionJson().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, responseBytes.length);
            exchange.getResponseBody().write(responseBytes);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void sendsDeepSeekCompatibleRequestAndParsesCompletion() throws Exception {
        final SpringAiChatGateway gateway = gateway();
        final AiChatResponse result = gateway.chat(new AiChatRequest(
                "system-instructions", "player-evidence", "deepseek-v4-flash",
                null, 4096, true, "max", "corr-boundary", "SINGLE_PLAYER_BATTLE"));

        assertEquals(1, requests.size(), "exactly one upstream request expected");
        final CapturedRequest captured = requests.getFirst();
        assertEquals("/chat/completions", captured.path());

        // Verify scheme and non-empty token without echoing the secret.
        assertNotNull(captured.authorization(), "Authorization header must be present");
        assertTrue(captured.authorization().startsWith("Bearer "),
                "Authorization must use the Bearer scheme");
        assertTrue(captured.authorization().length() > "Bearer ".length(),
                "Authorization must carry a non-empty token");

        final JsonNode body = new ObjectMapper().readTree(captured.body());
        assertEquals("deepseek-v4-flash", body.get("model").asText());
        assertEquals(4096, body.get("max_tokens").asInt());
        assertEquals("system", body.get("messages").get(0).get("role").asText());
        assertEquals("system-instructions", body.get("messages").get(0).get("content").asText());
        assertEquals("user", body.get("messages").get(1).get("role").asText());
        assertEquals("player-evidence", body.get("messages").get(1).get("content").asText());
        assertEquals("enabled", body.get("thinking").get("type").asText());
        assertEquals("max", body.get("reasoning_effort").asText());

        assertEquals("tactical review", result.completionText());
        assertEquals("DeepSeek", result.provider());
        assertEquals("deepseek-v4-flash", result.model());
        assertEquals(11, result.inputTokens());
        assertEquals(22, result.outputTokens());
        assertEquals(33, result.totalTokens());
        assertEquals(7, result.reasoningTokens());
        assertEquals(3, result.cacheHitTokens());
        assertEquals(5, result.cacheMissTokens());
        assertEquals("stop", result.finishReason());
    }

    @Test
    void thinkingDisabledOmitsReasoningEffortFromRequestBody() throws Exception {
        final SpringAiChatGateway gateway = gateway();
        gateway.chat(new AiChatRequest(
                "system-instructions", "player-evidence", "deepseek-v4-flash",
                null, 2048, false, "max", "corr-boundary-2", "SINGLE_PLAYER_BATTLE"));

        final CapturedRequest captured = requests.getFirst();
        final JsonNode body = new ObjectMapper().readTree(captured.body());
        assertEquals("disabled", body.get("thinking").get("type").asText());
        assertFalse(body.has("reasoning_effort"),
                "reasoning_effort must be omitted when thinking is disabled");
    }

    @Test
    void cancelsSlowResponseBodyAtTotalDeadline() throws Exception {
        // Raw TCP server: sends a 200 header immediately, then drips one body
        // byte every 50ms (~10s total). The 50ms drip is far below the 4s SDK
        // idle read timeout, so only the total-deadline watchdog can stop the
        // request while the response body is being read.
        final ServerSocket serverSocket = new ServerSocket(0, 50,
                InetAddress.getByName("127.0.0.1"));
        final Thread serverThread = new Thread(() -> {
            try (Socket socket = serverSocket.accept()) {
                final InputStream in = socket.getInputStream();
                final byte[] requestHead = new byte[4096];
                int read = 0;
                while (read < requestHead.length && !endsWithHeader(requestHead, read)) {
                    final int n = in.read(requestHead, read, requestHead.length - read);
                    if (n < 0) {
                        break;
                    }
                    read += n;
                }
                final OutputStream out = socket.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\n"
                        + "Content-Type: application/json\r\n"
                        + "Content-Length: 200\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                for (int i = 0; i < 200; i++) {
                    out.write('x');
                    out.flush();
                    Thread.sleep(50);
                }
            } catch (final IOException | InterruptedException e) {
                // Client cancelled the call at the total deadline; writes fail.
            }
        });
        serverThread.setDaemon(true);
        serverThread.start();
        try {
            final String baseUrl = "http://127.0.0.1:" + serverSocket.getLocalPort();
            // The model's SDK read timeout is 60s and the gateway total budget is
            // 5s: only the total-deadline watchdog can stop the slow body read.
            final AiModelProperties modelProperties = new AiModelProperties(
                    FAKE_API_KEY, baseUrl, "deepseek-v4-flash",
                    1, 60, 61, 1, 0, 0, 2.0,
                1_000_000, 940_000, 32_768, 16_384, true, "max", false, 4096);
            final SpringAiChatGateway gateway = new SpringAiChatGateway(
                    null, "deepseek-v4-flash", new SimpleMeterRegistry(),
                    new AiRetryPolicy(1, 0, 0, 2.0),
                    5_000_000_000L, System::nanoTime, Thread::sleep);
            gateway.chatModel = SpringAiChatGateway.buildModel(modelProperties, gateway);
            final long startNanos = System.nanoTime();
            final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                    () -> gateway.chat(request()));
            final long elapsedMillis = (System.nanoTime() - startNanos) / 1_000_000;
            assertEquals("AI_TIMEOUT", e.code());
            assertTrue(elapsedMillis < 9_000,
                    "must not wait for the full body drip (10s) or the SDK read timeout (60s): " + elapsedMillis);
        } finally {
            serverSocket.close();
        }
    }

    private static boolean endsWithHeader(final byte[] buffer, final int length) {
        if (length < 4) {
            return false;
        }
        return buffer[length - 4] == '\r' && buffer[length - 3] == '\n'
                && buffer[length - 2] == '\r' && buffer[length - 1] == '\n';
    }

    @Test
    void watchdogFiringBeforeInterceptorCapturesCallCancelsRequest() throws Exception {
        final AtomicInteger requestCount = new AtomicInteger();
        final HttpServer countingServer = HttpServer.create(
                new InetSocketAddress("127.0.0.1", 0), 0);
        countingServer.setExecutor(Executors.newSingleThreadExecutor());
        countingServer.createContext("/", exchange -> {
            requestCount.incrementAndGet();
            exchange.sendResponseHeaders(200, 0);
            exchange.close();
        });
        countingServer.start();
        try {
            final String baseUrl = "http://127.0.0.1:" + countingServer.getAddress().getPort();
            final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(
                    new AiModelProperties(FAKE_API_KEY, baseUrl, "deepseek-v4-flash",
                            1, 2, 3, 1, 0, 0, 2.0,
                1_000_000, 940_000, 32_768, 16_384, true, "max", false, 4096),
                    new SimpleMeterRegistry());
            // Deterministically fire the watchdog before the attempt starts, i.e.
            // before the okhttp interceptor captures the Call.
            gateway.attemptStartHook = AttemptBudgetContext::expireAndCancel;

            final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                    () -> gateway.chat(request()));

            assertEquals("AI_TIMEOUT", e.code());
            assertEquals(0, requestCount.get(),
                    "the cancelled request must never reach the provider");
        } finally {
            countingServer.stop(0);
        }
    }

    private SpringAiChatGateway gateway() {
        final String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        return SpringAiChatGateway.fromProperties(new AiModelProperties(
                FAKE_API_KEY, baseUrl, "deepseek-v4-flash",
                10, 300, 315, 3, 0, 0, 2.0,
                1_000_000, 940_000, 32_768, 16_384, true, "max", false, 4096), null);
    }

    private static AiChatRequest request() {
        return new AiChatRequest("system-instructions", "player-evidence",
                "deepseek-v4-flash", null, 4096, true, "max",
                "corr-boundary", "SINGLE_PLAYER_BATTLE");
    }

    private static String completionJson() {
        return """
                {
                  "id": "chatcmpl-boundary-test",
                  "object": "chat.completion",
                  "created": 1,
                  "model": "deepseek-v4-flash",
                  "choices": [
                    {
                      "index": 0,
                      "message": { "role": "assistant", "content": "tactical review" },
                      "finish_reason": "stop"
                    }
                  ],
                  "usage": {
                    "prompt_tokens": 11,
                    "completion_tokens": 22,
                    "total_tokens": 33,
                    "prompt_cache_hit_tokens": 3,
                    "prompt_cache_miss_tokens": 5,
                    "completion_tokens_details": { "reasoning_tokens": 7 }
                  }
                }
                """;
    }

    private record CapturedRequest(String path, String authorization, String body) {
    }
    // ===== docs/architecture/ai-review.md §24：response_format 请求体边界契约 =====

    @Test
    void jsonObjectResponseFormatSendsResponseFormatInRequestBody() throws Exception {
        final SpringAiChatGateway gateway = gateway();
        gateway.chat(new AiChatRequest(
                "system-instructions", "player-evidence", "deepseek-v4-flash",
                null, 4096, true, "max", "corr-json", "SINGLE_TEAM_BATTLE", 315,
                AiResponseFormat.JSON_OBJECT));

        final CapturedRequest captured = requests.getFirst();
        final JsonNode body = new ObjectMapper().readTree(captured.body());
        assertTrue(body.has("response_format"),
                "JSON_OBJECT 请求必须携带 response_format: " + captured.body());
        assertEquals("json_object", body.get("response_format").get("type").asText(),
                "response_format.type 必须为 json_object");
    }

    @Test
    void textResponseFormatOmitsResponseFormatFromRequestBody() throws Exception {
        final SpringAiChatGateway gateway = gateway();
        gateway.chat(new AiChatRequest(
                "system-instructions", "player-evidence", "deepseek-v4-flash",
                null, 4096, true, "max", "corr-text", "SINGLE_PLAYER_BATTLE", 315,
                AiResponseFormat.TEXT));

        final CapturedRequest captured = requests.getFirst();
        final JsonNode body = new ObjectMapper().readTree(captured.body());
        assertFalse(body.has("response_format"),
                "TEXT 请求不得携带 response_format: " + captured.body());
    }

    @Test
    void defaultResponseFormatIsText() {
        // 兼容构造器（无 responseFormat 参数）必须保持 TEXT：存量请求不进入 JSON mode（§6/§23）。
        final AiChatRequest legacy = new AiChatRequest(
                "system-instructions", "player-evidence", "deepseek-v4-flash",
                null, 4096, true, "max", "corr-legacy", "SINGLE_PLAYER_BATTLE");
        assertEquals(AiResponseFormat.TEXT, legacy.responseFormat());
    }
}