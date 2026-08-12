package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Parameterized redaction coverage. Test secrets are synthetic values only;
 * assertion failures therefore never expose real credentials, prompts or
 * replay evidence.
 */
class AiSecretRedactorTest {

    @ParameterizedTest
    @MethodSource("redactionCases")
    void redactsSecrets(final String input, final String expected) {
        assertEquals(expected, AiSecretRedactor.redact(input));
    }

    @ParameterizedTest
    @MethodSource("plainTextCases")
    void leavesPlainTextUntouched(final String input) {
        assertEquals(input, AiSecretRedactor.redact(input));
    }

    @Test
    void nullAndBlankAreSafe() {
        assertNull(AiSecretRedactor.redact(null));
        assertEquals("", AiSecretRedactor.redact(""));
        assertEquals("   ", AiSecretRedactor.redact("   "));
    }

    @Test
    void doesNotExposeSecretInOutput() {
        final String redacted = AiSecretRedactor.redact(
                "Authorization: Bearer sk-test-abcdef1234567890");
        assertFalse(redacted.contains("sk-test-abcdef1234567890"));
    }

    private static Stream<Arguments> redactionCases() {
        return Stream.of(
                Arguments.of("Authorization: Bearer sk-test-abc123",
                        "Authorization: Bearer ***"),
                Arguments.of("\"authorization\": \"Bearer sk-test-abc123\"",
                        "\"authorization\": \"Bearer ***\""),
                Arguments.of("api-key: sk-test-abc123", "api-key: ***"),
                Arguments.of("\"api_key\": \"sk-test-abc123\"", "\"api_key\": \"***\""),
                Arguments.of("apiKey=sk-test-abc123", "apiKey=***"),
                Arguments.of("apikey=sk-test-abc123", "apikey=***"),
                Arguments.of("API_KEY=sk-test-abc123", "API_KEY=***"),
                Arguments.of("Api-Key: sk-test-abc123", "Api-Key: ***"),
                Arguments.of("?api_key=sk-test-abc123&page=2", "?api_key=***&page=2"),
                Arguments.of("&token=sk-test-abc123", "&token=***"),
                Arguments.of("{\"auth\":{\"api_key\":\"sk-test-abc123\"}}",
                        "{\"auth\":{\"api_key\":\"***\"}}"),
                Arguments.of("Unauthorized: Authorization: Bearer sk-test-abc123",
                        "Unauthorized: Authorization: Bearer ***"),
                Arguments.of("client_secret: sk-test-abc123", "client_secret: ***"),
                Arguments.of("password=sk-test-abc123", "password=***"),
                Arguments.of("Bearer sk-test-abc123", "Bearer ***"));
    }

    private static Stream<Arguments> plainTextCases() {
        return Stream.of(
                Arguments.of("model=deepseek-v4-pro"),
                Arguments.of("the quick brown fox"),
                Arguments.of("reasoning_effort=max"));
    }
}
