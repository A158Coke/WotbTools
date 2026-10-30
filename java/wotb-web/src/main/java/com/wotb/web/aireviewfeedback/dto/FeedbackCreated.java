package com.wotb.web.aireviewfeedback.dto;

import java.time.Instant;

public record FeedbackCreated(String id, Instant createdAt) {
}
