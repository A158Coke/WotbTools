package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.openai.errors.UnauthorizedException;
import com.openai.core.http.Headers;
import com.openai.models.ErrorObject;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.metadata.ChatGenerationMetadata;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.DefaultUsage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;

import com.wotb.web.replay.ai.AiUpstreamException;

import java.util.List;

/**
 * æ ¸¡éªŒ upstream æŒ‡æ ‡å®žçŽ°ä¸Žæ—§ Gateway ä¸€è‡´ï¼š
 * request/duration/error counter åå­—ä¸Ž tag ä¸å˜ã€‚
 */
class SpringAiChatGatewayMetricsTest {

    private SimpleMeterRegistry registry;
    private ChatModel chatModel;
    private SpringAiChatGateway gateway;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        chatModel = mock(ChatModel.class);
        gateway = new SpringAiChatGateway(chatModel, "test-model", registry);
    }

    @Test
    void successRecordsRequestAndDuration() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse());
        gateway.chat(request());
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total")
                .tag("mode", "TEST_MODE").counter().count());
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds")
                .timer().count());
        assertEquals(0, registry.find("wotb_ai_upstream_errors_total")
                .counters().size());
    }

    @Test
    void failureRecordsRequestDurationAndErrorType() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                UnauthorizedException.builder()
                        .headers(Headers.builder().build())
                        .error(ErrorObject.builder()
                                .code("invalid_request_error")
                                .message("bad key")
                                .param("")
                                .type("invalid_request_error")
                                .build())
                        .build());
        assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total")
                .tag("mode", "TEST_MODE").counter().count());
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds")
                .timer().count());
        assertEquals(1L, registry.find("wotb_ai_upstream_errors_total")
                .tag("type", "AI_AUTHENTICATION_ERROR").counter().count());
    }

    private static AiChatRequest request() {
        return new AiChatRequest("system-prompt", "user-prompt",
                "test-model", null, 4096, true, "max",
                "corr-1", "TEST_MODE", null);
    }

    private static ChatResponse okResponse() {
        final Generation generation = new Generation(
                new AssistantMessage("ok"),
                ChatGenerationMetadata.builder().finishReason("stop").build());
        return ChatResponse.builder()
                .generations(List.of(generation))
                .metadata(ChatResponseMetadata.builder()
                        .model("test-model")
                        .usage(new DefaultUsage(1, 2, 3))
                        .build())
                .build();
    }
}
