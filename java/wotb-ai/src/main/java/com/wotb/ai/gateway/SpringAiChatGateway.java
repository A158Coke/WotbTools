package com.wotb.ai.gateway;

import com.wotb.ai.config.AiModelProperties;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.util.StringUtils;

import java.util.function.LongSupplier;
public class SpringAiChatGateway implements AiChatGateway {

    private static final Logger LOGGER = LoggerFactory.getLogger(SpringAiChatGateway.class);
    final AiGatewayRuntimeState state;
    private final AiGatewayLifecycle lifecycle;
    private final AiGatewayChatExecutor chatExecutor;
    private final AiGatewayStreamExecutor streamExecutor;

    public SpringAiChatGateway(final ChatModel chatModel,
                               final String defaultModel,
                               final MeterRegistry meterRegistry,
                               final AiRetryPolicy retryPolicy) {
        this(chatModel, defaultModel, meterRegistry, retryPolicy,
                AiGatewayRuntimeState.DEFAULT_CALL_TIMEOUT_NANOS, System::nanoTime, Thread::sleep);
    }

    SpringAiChatGateway(final ChatModel chatModel,
                        final String defaultModel,
                        final MeterRegistry meterRegistry,
                        final AiRetryPolicy retryPolicy,
                        final long callTimeoutNanos,
                        final LongSupplier nanoTimeSource,
                        final BudgetSleeper sleeper) {
        this.state = new AiGatewayRuntimeState(chatModel, defaultModel, meterRegistry,
                retryPolicy, callTimeoutNanos, nanoTimeSource, sleeper);
        final AiGatewayMetrics metrics = new AiGatewayMetrics(meterRegistry);
        final AiGatewayFailurePolicy failurePolicy = new AiGatewayFailurePolicy(defaultModel, this.state.retryPolicy,
                this.state.nanoTimeSource, LOGGER);
        final AiGatewayResponseMapper responseMapper = new AiGatewayResponseMapper(failurePolicy, LOGGER);
        this.lifecycle = new AiGatewayLifecycle();
        this.chatExecutor = new AiGatewayChatExecutor(state, metrics, failurePolicy,
                responseMapper, lifecycle);
        this.streamExecutor = new AiGatewayStreamExecutor(state, metrics, failurePolicy,
                responseMapper, lifecycle);
    }

    public static SpringAiChatGateway fromProperties(final AiModelProperties properties,
                                                     final MeterRegistry meterRegistry) {
        final SpringAiChatGateway gateway = new SpringAiChatGateway(
                null, properties.model(), meterRegistry, AiRetryPolicy.from(properties),
                properties.callTimeoutSec() * 1_000_000_000L, System::nanoTime, Thread::sleep);
        if (!StringUtils.hasText(properties.apiKey())) {
            return gateway;
        }
        gateway.state.chatModel = AiGatewayModelFactory.buildModel(properties, gateway.state.activeContext);
        return gateway;
    }

    @Override
    public boolean isConfigured() {
        return state.chatModel != null;
    }

    @Override
    public AiChatResponse chat(final AiChatRequest request) {
        return chatExecutor.chat(request);
    }

    @Override
    public AiChatResponse stream(final AiChatRequest request, final StreamConsumer consumer) {
        return streamExecutor.stream(request, consumer);
    }

    @PreDestroy
    void shutdownBudgetWatchdog() {
        lifecycle.shutdown();
    }

}
