package com.wotb.web.aireviewfeedback.dto;

import java.time.Instant;
import java.util.List;

public record FeedbackRecord(String id, List<FeedbackReason> reasonCodes, String feedbackText,
        String aiResponseText, String model, Instant createdAt) {
}
