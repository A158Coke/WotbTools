package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.openai.core.JsonValue;
import com.openai.core.http.Headers;
import com.openai.errors.BadRequestException;
import com.openai.errors.InternalServerException;
import com.openai.errors.OpenAIInvalidDataException;
import com.openai.errors.OpenAIIoException;
import com.openai.errors.RateLimitException;
import com.openai.errors.UnauthorizedException;
import com.openai.errors.UnexpectedStatusCodeException;
import com.openai.models.ErrorObject;
import com.openai.models.completions.CompletionUsage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.metadata.ChatGenerationMetadata;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.DefaultUsage;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;

import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.web.config.AiModelProperties;

/**
 * Gateway unit tests: a mocked {@link ChatModel} completely avoids real
 * DeepSeek calls. Verifies the AiChatRequest -> Prompt/OpenAiChatOptions
 * mapping, response parsing, thinking/reasoning_effort forwarding and error
 * mapping.
 */
class SpringAiChatGatewayTest {

    private ChatModel chatModel;
    private SpringAiChatGateway gateway;

    @BeforeEach
    void setUp() {
        chatModel = mock(ChatModel.class);
        gateway = new SpringAiChatGateway(chatModel, "DeepSeek-V4-Pro-0813", null,
                new AiRetryPolicy(3, 0, 0, 2.0));
    }

    @Test
    void buildsSystemAndUserMessages() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse("hello"));
        gateway.chat(request());
        final Prompt prompt = capturedPrompt();
        assertEquals("system-prompt", ((SystemMessage) prompt.getInstructions().getFirst()).getText());
        assertEquals("user-prompt", ((UserMessage) prompt.getInstructions().get(1)).getText());
    }

    @Test
    void appliesModelTemperatureMaxTokensAndThinkingFields() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse("hello"));
        gateway.chat(request());
        final OpenAiChatOptions options = capturedOptions();
        assertEquals("DeepSeek-V4-Pro-0813", options.getModel());
        assertEquals(Double.valueOf(0.7), options.getTemperature());
        assertEquals(Integer.valueOf(4096), options.getMaxTokens());
        assertEquals(Map.of("type", "enabled"), options.getExtraBody().get("thinking"));
        assertEquals("max", options.getExtraBody().get("reasoning_effort"));
    }

    @Test
    void disablesThinkingAndOmitsReasoningEffortWhenFlagOff() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse("hello"));
        gateway.chat(request(false, "max"));
        final OpenAiChatOptions options = capturedOptions();
        assertEquals(Map.of("type", "disabled"), options.getExtraBody().get("thinking"));
        assertFalse(options.getExtraBody().containsKey("reasoning_effort"));
    }

    @Test
    void returnsNormalResponseWithUsageAndFinishReason() {
        when(chatModel.call(any(Prompt.class))).thenReturn(
                response("tactical review", "DeepSeek-V4-Pro-0813",
                        new DefaultUsage(11, 22, 33), "stop"));
        final AiChatResponse result = gateway.chat(request());
        assertEquals("tactical review", result.completionText());
        assertEquals("DeepSeek", result.provider());
        assertEquals("DeepSeek-V4-Pro-0813", result.model());
        assertEquals(11, result.inputTokens());
        assertEquals(22, result.outputTokens());
        assertEquals(33, result.totalTokens());
        assertEquals("stop", result.finishReason());
    }

    @Test
    void extractsReasoningAndCacheTokensFromNativeUsage() {
        final CompletionUsage nativeUsage = mock(CompletionUsage.class);
        final CompletionUsage.CompletionTokensDetails details =
                mock(CompletionUsage.CompletionTokensDetails.class);
        when(nativeUsage.completionTokensDetails()).thenReturn(Optional.of(details));
        when(details.reasoningTokens()).thenReturn(Optional.of(7L));
        when(nativeUsage._additionalProperties()).thenReturn(Map.of(
                "prompt_cache_hit_tokens", JsonValue.from(3),
                "prompt_cache_miss_tokens", JsonValue.from(5)));
        when(chatModel.call(any(Prompt.class))).thenReturn(
                response("hello", "DeepSeek-V4-Pro-0813",
                        new DefaultUsage(11, 22, 33, nativeUsage), "stop"));
        final AiChatResponse result = gateway.chat(request());
        assertEquals(7, result.reasoningTokens());
        assertEquals(3, result.cacheHitTokens());
        assertEquals(5, result.cacheMissTokens());
    }

    @Test
    void mapsNullResponseToAiResponseInvalid() {
        when(chatModel.call(any(Prompt.class))).thenReturn(null);
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_RESPONSE_INVALID", e.code());
    }

    @Test
    void mapsBlankContentToAiEmptyResponse() {
        when(chatModel.call(any(Prompt.class))).thenReturn(
                response(" ", "DeepSeek-V4-Pro-0813", null, "stop"));
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_EMPTY_RESPONSE", e.code());
    }

    @Test
    void mapsAuthenticationFailure() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                UnauthorizedException.builder()
                        .headers(Headers.builder().build())
                        .error(error("bad key"))
                        .build());
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_AUTHENTICATION_ERROR", e.code());
        assertEquals(401, e.providerStatus());
    }

    @Test
    void mapsContextTooLargeFromBadRequestBody() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                BadRequestException.builder()
                        .headers(Headers.builder().build())
                        .error(error("maximum context length exceeded"))
                        .build());
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_CONTEXT_TOO_LARGE", e.code());
    }

    @Test
    void mapsBadRequestToInvalidRequest() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                BadRequestException.builder()
                        .headers(Headers.builder().build())
                        .error(error("bad parameter"))
                        .build());
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_INVALID_REQUEST", e.code());
    }

    @Test
    void mapsRateLimit() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                RateLimitException.builder()
                        .headers(Headers.builder().build())
                        .error(error("slow down"))
                        .build());
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_RATE_LIMITED", e.code());
        assertEquals(429, e.providerStatus());
    }

    @Test
    void mapsTimeoutIoFailure() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                new OpenAIIoException("timed out", new SocketTimeoutException("read timed out")));
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_TIMEOUT", e.code());
    }

    @Test
    void mapsConnectionFailure() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                new OpenAIIoException("connection reset", new IOException("reset")));
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_UPSTREAM_UNAVAILABLE", e.code());
    }

    @Test
    void mapsInternalServerError() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                InternalServerException.builder()
                        .statusCode(500)
                        .headers(Headers.builder().build())
                        .error(error("boom"))
                        .build());
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_UPSTREAM_UNAVAILABLE", e.code());
        assertEquals(500, e.providerStatus());
    }

    @Test
    void mapsUnexpected4xxToInvalidRequest() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                UnexpectedStatusCodeException.builder()
                        .statusCode(404)
                        .headers(Headers.builder().build())
                        .build());
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_INVALID_REQUEST", e.code());
        assertEquals(404, e.providerStatus());
    }

    @Test
    void mapsInvalidDataToAiResponseInvalid() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                new OpenAIInvalidDataException("invalid envelope"));
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_RESPONSE_INVALID", e.code());
    }

    @Test
    void mapsUnknownRuntimeExceptionToUpstreamUnavailable() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                new IllegalStateException("unexpected"));
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_UPSTREAM_UNAVAILABLE", e.code());
    }

    @Test
    void retriesTransientFailureUpToMaxAttempts() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                RateLimitException.builder()
                        .headers(Headers.builder().build())
                        .error(error("slow down"))
                        .build());
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_RATE_LIMITED", e.code());
        verify(chatModel, times(3)).call(any(Prompt.class));
    }

    @Test
    void doesNotRetryNonRetryableErrors() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                UnauthorizedException.builder()
                        .headers(Headers.builder().build())
                        .error(error("bad key"))
                        .build());
        assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));
        verify(chatModel, times(1)).call(any(Prompt.class));
    }

    @Test
    void retriesThenSucceeds() {
        when(chatModel.call(any(Prompt.class)))
                .thenThrow(RateLimitException.builder()
                        .headers(Headers.builder().build())
                        .error(error("slow down"))
                        .build())
                .thenReturn(okResponse("hello"));
        final AiChatResponse result = gateway.chat(request());
        assertEquals("hello", result.completionText());
        verify(chatModel, times(2)).call(any(Prompt.class));
    }

    @Test
    void doesNotRetryEmptyOrInvalidCompletion() {
        when(chatModel.call(any(Prompt.class)))
                .thenReturn(response(" ", "DeepSeek-V4-Pro-0813", null, "stop"));
        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals("AI_EMPTY_RESPONSE", e.code());
        verify(chatModel, times(1)).call(any(Prompt.class));
    }

    @Test
    void missingApiKeyProducesUnconfiguredGateway() {
        final SpringAiChatGateway unconfigured = SpringAiChatGateway.fromProperties(
                properties("", "https://api.deepseek.com", "DeepSeek-V4-Pro-0813"), null);
        assertFalse(unconfigured.isConfigured());
        assertThrows(AiNotConfiguredException.class,
                () -> unconfigured.chat(request()));
    }

    @Test
    void customModelAndBaseUrlAreAppliedFromProperties() {
        final SpringAiChatGateway configured = SpringAiChatGateway.fromProperties(
                properties("sk-test", "https://custom.example.com", "DeepSeek-V4-Pro-0813"), null);
        assertTrue(configured.isConfigured());
        final OpenAiChatModel model = (OpenAiChatModel) configured.chatModel();
        assertEquals("https://custom.example.com", model.getOptions().getBaseUrl());
        assertEquals("sk-test", model.getOptions().getApiKey());
        assertEquals("DeepSeek-V4-Pro-0813", model.getOptions().getModel());
        assertEquals(0, model.getOptions().getMaxRetries());
    }

    @Test
    void customModelStringIsForwardedPerCall() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse("hello"));
        gateway.chat(new AiChatRequest("system-prompt", "user-prompt",
                "DeepSeek-V4-Pro-0813", null, 4096, true, "max",
                "corr-1", "SINGLE_PLAYER_BATTLE"));
        assertEquals("DeepSeek-V4-Pro-0813", capturedOptions().getModel());
    }

    private static AiChatRequest request() {
        return request(true, "max");
    }

    private static AiChatRequest request(final boolean thinkingEnabled, final String reasoningEffort) {
        return new AiChatRequest("system-prompt", "user-prompt",
                "DeepSeek-V4-Pro-0813", 0.7, 4096, thinkingEnabled, reasoningEffort,
                "corr-1", "SINGLE_PLAYER_BATTLE");
    }

    private static AiModelProperties properties(final String apiKey, final String baseUrl, final String model) {
        return new AiModelProperties(
                apiKey, baseUrl, model, 10, 300, 315, 3, 1000, 8000, 2.0,
                1_000_000, 940_000, 32_768, 16_384, true, "max", false);
    }

    private static ErrorObject error(final String message) {
        return ErrorObject.builder()
                .code("invalid_request_error")
                .message(message)
                .param("")
                .type("invalid_request_error")
                .build();
    }

    private Prompt capturedPrompt() {
        final ArgumentCaptor<Prompt> captor = ArgumentCaptor.forClass(Prompt.class);
        verify(chatModel).call(captor.capture());
        return captor.getValue();
    }

    private OpenAiChatOptions capturedOptions() {
        return (OpenAiChatOptions) capturedPrompt().getOptions();
    }

    private static ChatResponse okResponse(final String text) {
        return response(text, "DeepSeek-V4-Pro-0813", new DefaultUsage(11, 22, 33), "stop");
    }

    private static ChatResponse response(final String text, final String model,
                                         final Usage usage, final String finishReason) {
        final Generation generation = new Generation(
                new AssistantMessage(text),
                ChatGenerationMetadata.builder().finishReason(finishReason).build());
        final ChatResponseMetadata.Builder metadata = ChatResponseMetadata.builder().model(model);
        if (usage != null) {
            metadata.usage(usage);
        }
        return ChatResponse.builder()
                .generations(List.of(generation))
                .metadata(metadata.build())
                .build();
    }
}
