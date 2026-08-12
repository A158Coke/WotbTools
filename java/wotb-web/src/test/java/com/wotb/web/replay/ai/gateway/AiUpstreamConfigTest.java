package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.env.PropertySource;

import com.wotb.web.config.AiModelProperties;

/**
 * Timeout and retry configuration: single source (wotb.ai.* env mapping),
 * explicit defaults, and legal min/max validation.
 */
class AiUpstreamConfigTest {

    @Test
    void applicationYmlExposesExplicitTimeoutAndRetryDefaults() throws Exception {
        final List<PropertySource<?>> sources = new YamlPropertySourceLoader()
                .load("application", new ClassPathResource("application.yml"));
        final PropertySource<?> source = sources.getFirst();
        assertEquals("${AI_CONNECT_TIMEOUT_SEC:10}",
                source.getProperty("wotb.ai.connect-timeout-sec"));
        assertEquals("${AI_TIMEOUT_SEC:300}",
                source.getProperty("wotb.ai.timeout-sec"));
        assertEquals("${AI_CALL_TIMEOUT_SEC:315}",
                source.getProperty("wotb.ai.call-timeout-sec"));
        assertEquals("${AI_RETRY_MAX_ATTEMPTS:3}",
                source.getProperty("wotb.ai.retry-max-attempts"));
        assertEquals("${AI_RETRY_INITIAL_BACKOFF_MS:1000}",
                source.getProperty("wotb.ai.retry-initial-backoff-millis"));
        assertEquals("${AI_RETRY_MAX_BACKOFF_MS:8000}",
                source.getProperty("wotb.ai.retry-max-backoff-millis"));
        assertEquals("${AI_RETRY_BACKOFF_MULTIPLIER:2.0}",
                source.getProperty("wotb.ai.retry-backoff-multiplier"));
    }

    @Test
    void springAiOpenAiChatModelLoggingIsSuppressed() throws Exception {
        final List<PropertySource<?>> sources = new YamlPropertySourceLoader()
                .load("application", new ClassPathResource("application.yml"));
        final PropertySource<?> source = sources.getFirst();
        // OpenAiChatModel logs the full prompt at WARN when the provider returns
        // empty choices; the production config must keep that class at ERROR and
        // must not silence the whole application via a global ERROR level.
        assertEquals("ERROR", source.getProperty(
                "logging.level.org.springframework.ai.openai.OpenAiChatModel"));
        assertEquals("WARN", source.getProperty("logging.level.org.apache.poi"));
    }

    @Test
    void validDefaultsBind() {
        final AiModelProperties properties = properties(
                10, 300, 315, 3, 1000, 8000, 2.0);
        assertEquals(10, properties.connectTimeoutSec());
        assertEquals(300, properties.timeoutSec());
        assertEquals(315, properties.callTimeoutSec());
        assertEquals(3, properties.retryMaxAttempts());
        assertEquals(1000, properties.retryInitialBackoffMillis());
        assertEquals(8000, properties.retryMaxBackoffMillis());
        assertEquals(2.0, properties.retryBackoffMultiplier());
    }

    @Test
    void rejectsOutOfRangeTimeouts() {
        assertThrows(IllegalArgumentException.class,
                () -> properties(0, 300, 315, 3, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 0, 315, 3, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 0, 3, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 3601, 3, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 309, 3, 1000, 8000, 2.0));
    }

    @Test
    void rejectsInvalidRetryBounds() {
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 315, 0, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 315, 6, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 315, 3, -1, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 315, 3, 9000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> properties(10, 300, 315, 3, 1000, 8000, 0.9));
    }

    @Test
    void call2ThinkingEnabledRequiresHighOrMaxEffort() {
        // call2 开启但 effort 非法 → 拒绝
        assertThrows(IllegalArgumentException.class,
                () -> new AiModelProperties(
                        "sk-test", "https://api.deepseek.com", "DeepSeek-V4-Pro-0813",
                        10, 300, 315, 3, 1000, 8000, 2.0,
                        1_000_000, 940_000, 32_768, 16_384, false, null, true));
        // 开启 + high → 合法且透传
        final AiModelProperties enabled = new AiModelProperties(
                "sk-test", "https://api.deepseek.com", "DeepSeek-V4-Pro-0813",
                10, 300, 315, 3, 1000, 8000, 2.0,
                1_000_000, 940_000, 32_768, 16_384, false, "high", true);
        assertTrue(enabled.call2ThinkingEnabled(), "call2ThinkingEnabled must be forwarded");
    }

    private static AiModelProperties properties(
            final int connect, final int read, final int call,
            final int retryMax, final long initialBackoff, final long maxBackoff,
            final double multiplier) {
        return new AiModelProperties(
                "sk-test", "https://api.deepseek.com", "DeepSeek-V4-Pro-0813",
                connect, read, call, retryMax, initialBackoff, maxBackoff, multiplier,
                1_000_000, 940_000, 32_768, 16_384, true, "max", false);
    }
}
