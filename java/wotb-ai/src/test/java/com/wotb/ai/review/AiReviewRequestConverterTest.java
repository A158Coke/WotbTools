package com.wotb.ai.review;

import com.wotb.ai.review.converter.AiReviewRequestConverter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AiReviewRequestConverterTest {
    private final AiReviewRequestConverter converter = new AiReviewRequestConverter();

    @Test
    void localeValidationPrecedesProjectionValidation() {
        final var error = assertThrows(ResponseStatusException.class,
                () -> converter.convert(request(body("de-DE", "6f1e6f1e-0000-4000-8000-000000000001"))));
        assertEquals("UNKNOWN_LOCALE", error.getReason());
    }

    @Test
    void correlationIdValidationPrecedesProjectionValidation() {
        final var error = assertThrows(ResponseStatusException.class,
                () -> converter.convert(request(body("zh-CN", "invalid"))));
        assertEquals("INVALID_CORRELATION_ID", error.getReason());
    }

    @Test
    void malformedProjectionMapsToInvalidRequest() {
        final var error = assertThrows(ResponseStatusException.class,
                () -> converter.convert(request(body("zh-CN", "6f1e6f1e-0000-4000-8000-000000000001"))));
        assertEquals("INVALID_AI_REQUEST", error.getReason());
    }

    @Test
    void malformedJsonMapsToInvalidRequest() {
        final var error = assertThrows(ResponseStatusException.class,
                () -> converter.convert(request("{\"locale\":")));
        assertEquals("INVALID_AI_REQUEST", error.getReason());
    }

    private static MockHttpServletRequest request(final String body) {
        final MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContentType("application/json");
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        return request;
    }

    private static String body(final String locale, final String id) {
        return "{\"locale\":\"" + locale + "\",\"correlationId\":\"" + id
                + "\",\"battle\":{\"players\":[]},\"projection\":{}}";
    }
}
