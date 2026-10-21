package com.wotb.ai.review;

import com.wotb.ai.review.controller.AiReviewCancellationController;
import com.wotb.ai.review.controller.AiReviewSubmissionController;
import com.wotb.ai.review.converter.AiReviewRequestConverter;
import com.wotb.ai.review.service.AiReviewCancellationService;
import com.wotb.ai.review.service.AiReviewSubmissionService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiReviewControllerTest {
    @Test void submissionControllerOnlyConvertsAndSubmits() {
        final AiReviewRequestConverter converter = mock(AiReviewRequestConverter.class);
        final AiReviewSubmissionService service = mock(AiReviewSubmissionService.class);
        final HttpServletRequest httpRequest = mock(HttpServletRequest.class);
        final AiReviewRequest converted = mock(AiReviewRequest.class);
        final SseEmitter emitter = new SseEmitter();
        when(converter.convert(httpRequest)).thenReturn(converted);
        when(service.submit(converted)).thenReturn(emitter);
        assertSame(emitter, new AiReviewSubmissionController(converter, service).review(httpRequest));
        verify(converter).convert(httpRequest);
        verify(service).submit(converted);
    }

    @Test void cancellationControllerReturnsNoContentThroughService() {
        final AiReviewCancellationService service = mock(AiReviewCancellationService.class);
        assertEquals(HttpStatus.NO_CONTENT,
                new AiReviewCancellationController(service).cancel("6f1e6f1e-0000-4000-8000-000000000001")
                        .getStatusCode());
        verify(service).cancel("6f1e6f1e-0000-4000-8000-000000000001");
    }
}
