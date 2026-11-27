package com.wotb.web.hof.dto;

import java.util.List;
import java.util.Objects;

public record BulkDeleteRecordsRequest(List<Long> ids) {

    private static final int MAX_BULK_IDS = 100;

    public List<Long> normalizedIds() {
        final List<Long> targets = ids == null ? List.of()
                : ids.stream().filter(Objects::nonNull).distinct().toList();
        if (targets.size() > MAX_BULK_IDS) {
            throw new IllegalArgumentException("BULK_LIMIT_EXCEEDED");
        }
        return targets;
    }
}
