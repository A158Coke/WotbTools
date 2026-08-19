package com.wotb.web.hof.dto;

import java.util.List;

/**
 * 名人堂管理审计分页响应。
 */
public record HofAdminAuditPageDto(
        List<HofAdminAuditDto> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
