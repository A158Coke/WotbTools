package com.wotb.ai.review.service;

import com.wotb.ai.review.AiCancellationRegistry;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AiReviewCancellationService {
    private final AiCancellationRegistry cancellations;

    public AiReviewCancellationService(final AiCancellationRegistry cancellations) {
        this.cancellations = cancellations;
    }

    public void cancel(final String correlationId) {
        if (!AiCancellationRegistry.isValidCorrelationId(correlationId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID");
        }
        cancellations.cancel(correlationId);
    }
}
