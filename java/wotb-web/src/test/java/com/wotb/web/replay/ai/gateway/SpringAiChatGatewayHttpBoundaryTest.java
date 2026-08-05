package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
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
                null, 4096, true, "max", "corr-boundary", "SINGLE_PLAYER_BATTLE", null));

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
                null, 2048, false, "max", "corr-boundary-2", "SINGLE_PLAYER_BATTLE", null));

        final CapturedRequest captured = requests.getFirst();
        final JsonNode body = new ObjectMapper().readTree(captured.body());
        assertEquals("disabled", body.get("thinking").get("type").asText());
        assertFalse(body.has("reasoning_effort"),
                "reasoning_effort must be omitted when thinking is disabled");
    }

    private SpringAiChatGateway gateway() {
        final String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        return SpringAiChatGateway.fromProperties(new AiModelProperties(
                FAKE_API_KEY, baseUrl, "deepseek-v4-flash",
                10, 300, 315, 3, 0, 0, 2.0,
                1_000_000, 940_000, 32_768, 16_384, true, "max"), null);
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
}
