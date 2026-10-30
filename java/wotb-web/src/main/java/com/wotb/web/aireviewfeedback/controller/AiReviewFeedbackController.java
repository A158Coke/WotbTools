package com.wotb.web.aireviewfeedback.controller;

import com.wotb.web.aireviewfeedback.dto.FeedbackCreated;
import com.wotb.web.aireviewfeedback.dto.FeedbackPage;
import com.wotb.web.aireviewfeedback.dto.FeedbackRecord;
import com.wotb.web.aireviewfeedback.service.AiReviewFeedbackService;
import com.wotb.web.config.ApiPaths;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.io.IOException;

@RestController
public class AiReviewFeedbackController {
    private final AiReviewFeedbackService service;
    public AiReviewFeedbackController(final AiReviewFeedbackService service) { this.service = service; }

    @PostMapping(value = ApiPaths.AI_REVIEW_FEEDBACK, consumes = "application/json")
    public ResponseEntity<FeedbackCreated> create(final HttpServletRequest request) throws IOException {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createFromStream(request.getInputStream()));
    }

    @GetMapping("/api/admin/ai-review-feedback")
    public FeedbackPage list(@RequestParam(name = "page", defaultValue = "0") final int page,
            @RequestParam(name = "size", defaultValue = "25") final int size,
            @RequestParam(name = "reason", required = false) final String reason) {
        return service.list(page, size, reason);
    }

    @GetMapping("/api/admin/ai-review-feedback/{id}")
    public FeedbackRecord detail(@PathVariable(name = "id") final String id) { return service.get(id); }

    @DeleteMapping("/api/admin/ai-review-feedback/{id}")
    public ResponseEntity<Void> delete(@PathVariable(name = "id") final String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
