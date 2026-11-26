package com.wotb.web.mark3.dto;

import java.util.List;

public record BulkDeleteResultDto(int requested, int deleted, int failed, List<BulkDeleteItemResult> results) {
}
