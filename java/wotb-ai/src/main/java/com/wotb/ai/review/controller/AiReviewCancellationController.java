package com.wotb.ai.review.controller;

import com.wotb.ai.review.service.AiReviewCancellationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai/reviews")
public class AiReviewCancellationController {
    private final AiReviewCancellationService cancellationService;

    public AiReviewCancellationController(final AiReviewCancellationService cancellationService) {
        this.cancellationService = cancellationService;
    }

    @PostMapping("/{correlationId}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable("correlationId") final String correlationId) {
        cancellationService.cancel(correlationId);
        return ResponseEntity.noContent().build();
    }
}
