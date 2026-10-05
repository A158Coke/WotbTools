package com.wotb.web.replay.ai.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.wotb.web.config.AiModelProperties;
import org.junit.jupiter.api.Test;
import org.springframework.ai.content.Media;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.util.MimeTypeUtils;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real Spring AI adapter against loopback HTTP only; no external provider or credentials. */
class SpringAiChatGatewayMediaTest {
    @Test
    void sendsImageAsDataUrlAndKeepsExistingTextRequestBehavior() throws Exception {
        final AtomicReference<String> captured = new AtomicReference<>();
        final HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            captured.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            final byte[] response = ("{\"id\":\"fake\",\"object\":\"chat.completion\",\"created\":1,"
                    + "\"model\":\"deepseek-flash\",\"choices\":[{\"index\":0,\"finish_reason\":\"stop\","
                    + "\"message\":{\"role\":\"assistant\",\"content\":\"{}\"}}],"
                    + "\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        final AiModelProperties properties = new AiModelProperties("synthetic-loopback-key",
                "http://127.0.0.1:" + server.getAddress().getPort(), "deepseek-v4-flash",
                1, 5, 6, 1, 0, 0, 2.0, 1_000_000, 940_000,
                32_768, 16_384, true, "max", false, 4096);
        final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(properties, null);
        try {
            final byte[] bytes = {1, 2, 3, 4};
            final AiChatResponse response = gateway.chat(new AiChatRequest("system", "read this", "deepseek-flash",
                    null, 2048, false, null, "media-fixture", "TOURNAMENT_GROUP_RECOGNITION", 90,
                    AiResponseFormat.JSON_OBJECT, List.of(new Media(MimeTypeUtils.IMAGE_PNG, new ByteArrayResource(bytes)))));
            final var json = new ObjectMapper().readTree(captured.get());
            assertEquals("deepseek-flash", json.path("model").asText());
            assertEquals("disabled", json.path("thinking").path("type").asText());
            assertEquals("json_object", json.path("response_format").path("type").asText());
            final var content = json.path("messages").get(1).path("content");
            assertTrue(content.isArray());
            assertEquals("text", content.get(0).path("type").asText());
            assertEquals("read this", content.get(0).path("text").asText());
            assertEquals("image_url", content.get(1).path("type").asText());
            assertEquals("data:image/png;base64," + Base64.getEncoder().encodeToString(bytes),
                    content.get(1).path("image_url").path("url").asText());
            assertEquals("{}", response.completionText());
            assertEquals(5, response.totalTokens());

            final AiChatRequest oldRequest = new AiChatRequest("system", "plain text", "deepseek-v4-flash",
                    null, 100, false, null, "text-fixture", "SINGLE_PLAYER_BATTLE");
            assertTrue(oldRequest.media().isEmpty());
            gateway.chat(oldRequest);
            final var text = new ObjectMapper().readTree(captured.get());
            assertEquals("plain text", text.path("messages").get(1).path("content").asText());
            assertTrue(text.path("response_format").isMissingNode());
        } finally {
            gateway.shutdownBudgetWatchdog();
            server.stop(0);
        }
    }
}
