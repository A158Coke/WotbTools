package com.wotb.ai.review.controller;

import com.wotb.ai.review.converter.AiReviewRequestConverter;
import com.wotb.ai.review.service.AiReviewSubmissionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/ai/reviews")
public class AiReviewSubmissionController {
    private final AiReviewRequestConverter requestConverter;
    private final AiReviewSubmissionService submissionService;

    public AiReviewSubmissionController(final AiReviewRequestConverter requestConverter,
                                        final AiReviewSubmissionService submissionService) {
        this.requestConverter = requestConverter;
        this.submissionService = submissionService;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter review(final HttpServletRequest request) {
        return submissionService.submit(requestConverter.convert(request));
    }
}
