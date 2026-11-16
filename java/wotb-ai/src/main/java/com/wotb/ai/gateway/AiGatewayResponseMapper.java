package com.wotb.ai.gateway;

import com.openai.core.JsonValue;
import com.openai.models.completions.CompletionUsage;
import org.slf4j.Logger;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static com.wotb.ai.gateway.AiGatewayRuntimeState.PROVIDER_NAME;
/** Projects provider prompts, responses, and usage into gateway contracts. */
final class AiGatewayResponseMapper {
    private final Logger logger;
    private final AiGatewayFailurePolicy failurePolicy;

    AiGatewayResponseMapper(final AiGatewayFailurePolicy failurePolicy, final Logger logger) {
        this.failurePolicy = failurePolicy;
        this.logger = logger;
    }

    AiChatResponse toResponse(final ChatResponse response,
                                      final AiChatRequest request,
                                      final String model,
                                      final String correlationId) {
        final String content = extractContent(response, request.analysisMode(), correlationId);
        final ChatResponseMetadata metadata = response.getMetadata();
        final Usage usage = metadata != null ? metadata.getUsage() : null;
        return new AiChatResponse(
                content,
                PROVIDER_NAME,
                metadata != null && StringUtils.hasText(metadata.getModel())
                        ? metadata.getModel() : model,
                usage != null && usage.getPromptTokens() != null ? usage.getPromptTokens() : 0,
                usage != null && usage.getCompletionTokens() != null ? usage.getCompletionTokens() : 0,
                usage != null && usage.getTotalTokens() != null ? usage.getTotalTokens() : 0,
                reasoningTokens(usage),
                cacheHitTokens(usage),
                cacheMissTokens(usage),
                finishReason(response));
    }

    Prompt buildPrompt(final AiChatRequest request, final String model) {
        final Map<String, Object> extraBody = new LinkedHashMap<>();
        extraBody.put("thinking", Map.of(
                "type", request.thinkingEnabled() ? "enabled" : "disabled"));
        if (request.thinkingEnabled() && StringUtils.hasText(request.reasoningEffort())) {
            extraBody.put("reasoning_effort", request.reasoningEffort());
        }
        final OpenAiChatOptions.Builder options = OpenAiChatOptions.builder();
        options.model(model);
        options.maxTokens(request.maxOutputTokens());
        options.extraBody(extraBody);
        // Per-request output format：JSON_OBJECT → 原生
        // response_format=json_object；TEXT 不发送 response_format（最小 provider surface，
        // 绝不全局污染连接级 model options）。
        if (request.responseFormat() == AiResponseFormat.JSON_OBJECT) {
            options.responseFormat(OpenAiChatModel.ResponseFormat.builder()
                    .type(OpenAiChatModel.ResponseFormat.Type.JSON_OBJECT)
                    .build());
        }
        if (request.temperature() != null) {
            options.temperature(request.temperature());
        }
        return new Prompt(
                List.of(
                        new SystemMessage(request.systemPrompt()),
                        UserMessage.builder().text(request.userPrompt()).media(request.media()).build()),
                options.build());
    }

    private String extractContent(final ChatResponse response,
                                  final String analysisMode,
                                  final String correlationId) {
        if (response == null || response.getResult() == null
                || response.getResult().getOutput() == null) {
            throw failurePolicy.providerFailure(null, "AI_RESPONSE_INVALID", analysisMode, correlationId,
                    "invalid completion envelope");
        }
        final String content = response.getResult().getOutput().getText();
        if (!StringUtils.hasText(content)) {
            throw failurePolicy.providerFailure(null, "AI_EMPTY_RESPONSE", analysisMode, correlationId,
                    "blank completion content");
        }
        return content;
    }

    private static String finishReason(final ChatResponse response) {
        if (response == null || response.getResult() == null
                || response.getResult().getMetadata() == null) {
            return null;
        }
        final String reason = response.getResult().getMetadata().getFinishReason();
        // The SDK normalizes finish_reason to an enum name (e.g. "STOP"); the
        // legacy gateway returned the raw provider value ("stop"). Keep the
        // original casing contract by normalizing to lower case.
        return reason != null ? reason.toLowerCase(Locale.ROOT) : null;
    }

    static int reasoningTokens(final Usage usage) {
        if (usage == null || !(usage.getNativeUsage() instanceof CompletionUsage completionUsage)) {
            return 0;
        }
        return completionUsage.completionTokensDetails()
                .flatMap(details -> details.reasoningTokens())
                .map(Long::intValue)
                .orElse(0);
    }

    static int cacheHitTokens(final Usage usage) {
        if (usage == null) {
            return 0;
        }
        final Long mapped = usage.getCacheReadInputTokens();
        if (mapped != null && mapped > 0) {
            return mapped.intValue();
        }
        return nativeUsageLong(usage, "prompt_cache_hit_tokens");
    }

    static int cacheMissTokens(final Usage usage) {
        if (usage == null) {
            return 0;
        }
        return nativeUsageLong(usage, "prompt_cache_miss_tokens");
    }

    private static int nativeUsageLong(final Usage usage, final String key) {
        if (!(usage.getNativeUsage() instanceof CompletionUsage completionUsage)) {
            return 0;
        }
        final JsonValue value = completionUsage._additionalProperties().get(key);
        if (value == null) {
            return 0;
        }
        try {
            final Long parsed = value.convert(Long.class);
            return parsed != null ? parsed.intValue() : 0;
        } catch (final RuntimeException e) {
            return 0;
        }
    }

    static boolean hasReceivedUsage(final ChatResponse response) {
        if (response == null || response.getMetadata() == null) {
            return false;
        }
        final Usage usage = response.getMetadata().getUsage();
        // Spring AI supplies an empty Usage for chunks without provider usage.
        return usage != null && (usage.getNativeUsage() instanceof CompletionUsage
                || (usage.getTotalTokens() != null && usage.getTotalTokens() > 0));
    }

    void recordReceivedUsage(final ChatResponse response, final String mode,
                                     final String correlationId) {
        recordReceivedUsage(response, mode, correlationId, AiRequestContext.usageTotals(), null);
    }

    void recordReceivedUsage(final ChatResponse response, final String mode,
                                     final String correlationId, final AiRequestContext.UsageTotals totals,
                                     final ChatResponse previous) {
        final boolean missing = !hasReceivedUsage(response);
        final Usage usage = missing ? null : response.getMetadata().getUsage();
        final Usage prior = previous == null ? null : previous.getMetadata().getUsage();
        final int input = Math.max(0, (usage != null && usage.getPromptTokens() != null ? usage.getPromptTokens() : 0)
                - (prior != null && prior.getPromptTokens() != null ? prior.getPromptTokens() : 0));
        final int output = Math.max(0, (usage != null && usage.getCompletionTokens() != null ? usage.getCompletionTokens() : 0)
                - (prior != null && prior.getCompletionTokens() != null ? prior.getCompletionTokens() : 0));
        final int total = Math.max(0, (usage != null && usage.getTotalTokens() != null ? usage.getTotalTokens() : 0)
                - (prior != null && prior.getTotalTokens() != null ? prior.getTotalTokens() : 0));
        if (totals != null) {
            if (previous == null) {
                totals.add(input, output, total, missing);
            } else {
                totals.inputTokens += input;
                totals.outputTokens += output;
                totals.totalTokens += total;
            }
        }
        logger.info(AiEventLog.line("ai_token_usage", correlationId,
                "mode", mode, "inputTokens", input, "outputTokens", output,
                "totalTokens", total, "usageMissing", missing ? 1 : 0,
                "reasoningTokens", reasoningTokens(usage), "cacheHitTokens", cacheHitTokens(usage),
                "cacheMissTokens", cacheMissTokens(usage)));
    }

    static String streamDelta(final ChatResponse response) {
        if (response == null || response.getResult() == null
                || response.getResult().getOutput() == null) {
            return "";
        }
        final String delta = response.getResult().getOutput().getText();
        return delta != null ? delta : "";
    }


    static ChatResponse toAggregatedResponse(final String text,
                                              final ChatResponse last,
                                              final String model) {
        final ChatResponseMetadata metadata = last != null ? last.getMetadata() : null;
        final Generation generation;
        if (last != null && last.getResult() != null
                && last.getResult().getMetadata() != null) {
            generation = new Generation(
                    new AssistantMessage(text), last.getResult().getMetadata());
        } else {
            generation = new Generation(new AssistantMessage(text));
        }
        return ChatResponse.builder()
                .generations(List.of(generation))
                .metadata(metadata != null ? metadata
                        : ChatResponseMetadata.builder().model(model).build())
                .build();
    }


}
