package com.wotb.web.aireviewfeedback.dto;

import java.util.List;

public record FeedbackPage(List<FeedbackListItem> items, int page, int size, long totalItems, long totalPages) {
}
