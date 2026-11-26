package com.wotb.web.hundred.dto;

import java.util.List;

public record BulkDeleteResultDto(int requested, int deleted, int failed, List<BulkDeleteItemResult> results) {
}
