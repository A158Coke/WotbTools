package com.wotb.web.sitefeedback.dto;

import java.time.Instant;
import java.util.List;

public record SiteFeedbackRecord(String id, List<SiteFeedbackReason> reasonCodes, String feedbackText,
        String pageView, Instant createdAt) {
}
