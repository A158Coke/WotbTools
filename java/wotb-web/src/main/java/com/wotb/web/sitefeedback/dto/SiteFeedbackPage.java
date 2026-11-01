package com.wotb.web.sitefeedback.dto;

import java.util.List;

public record SiteFeedbackPage(List<SiteFeedbackListItem> items, int page, int size, long totalItems, long totalPages) {
}
