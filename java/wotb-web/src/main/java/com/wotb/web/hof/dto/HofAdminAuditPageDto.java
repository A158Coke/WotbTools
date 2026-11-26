package com.wotb.web.hof.dto;

import java.util.List;

public record HofAdminAuditPageDto(
    List<HofAdminAuditDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
