package com.wotb.web.hof.dto;

import java.util.List;

public record BulkDeleteResultDto(
        int requested,
        int deleted,
        int failed,
        List<BulkDeleteItemResult> results
) {
}
