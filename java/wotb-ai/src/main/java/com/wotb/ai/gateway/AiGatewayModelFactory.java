package com.wotb.ai.gateway;

import com.openai.core.Timeout;
import com.wotb.ai.config.AiModelProperties;
import io.micrometer.observation.ObservationRegistry;
import okhttp3.Call;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.http.okhttp.OpenAiHttpClientBuilderCustomizer;

import java.time.Duration;
import java.util.List;

final class AiGatewayModelFactory {
    private AiGatewayModelFactory() { }

    static ChatModel buildModel(final AiModelProperties properties,
                                final ThreadLocal<AttemptBudgetContext> activeContext) {
        final OpenAiChatOptions.Builder connectionOptions = OpenAiChatOptions.builder();
        connectionOptions.baseUrl(properties.baseUrl());
        connectionOptions.apiKey(properties.apiKey());
        connectionOptions.model(properties.model());
        connectionOptions.maxRetries(0);
        connectionOptions.timeout(Duration.ofSeconds(properties.timeoutSec()));
        final OpenAiHttpClientBuilderCustomizer httpCustomizer = builder -> {
            builder.timeout(Timeout.builder()
                    .connect(Duration.ofSeconds(properties.connectTimeoutSec()))
                    .read(Duration.ofSeconds(properties.timeoutSec()))
                    .write(Duration.ofSeconds(properties.timeoutSec()))
                    .request(Duration.ofSeconds(properties.callTimeoutSec()))
                    .build());
            builder.interceptor(chain -> {
                final AttemptBudgetContext context = activeContext.get();
                if (context == null) {
                    return chain.proceed(chain.request());
                }
                final Call call = chain.call();
                context.capture(call);
                if (context.isStopped()) {
                    call.cancel();
                }
                return chain.proceed(chain.request());
            });
        };
        return OpenAiChatModel.builder()
                .options(connectionOptions.build())
                .observationRegistry(ObservationRegistry.NOOP)
                .httpClientBuilderCustomizers(List.of(httpCustomizer))
                .build();
    }

}
