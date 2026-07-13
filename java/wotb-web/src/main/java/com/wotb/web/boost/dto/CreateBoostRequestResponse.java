package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/** 创建陪练需求响应。 */
public record CreateBoostRequestResponse(
    Long id,
    String status,
    String code,
    OffsetDateTime createdAt
) {}
