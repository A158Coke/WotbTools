package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

public record CreateBoosterApplicationResponse(
    Long id,
    String status,
    String code,
    OffsetDateTime createdAt
) {}
