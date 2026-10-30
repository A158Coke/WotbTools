package com.wotb.web.aireviewfeedback.dto;

import java.time.Instant;
import java.util.List;

public record FeedbackListItem(String id, List<FeedbackReason> reasonCodes, String feedbackText,
        String model, Instant createdAt) {
}
