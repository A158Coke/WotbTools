package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/** 玩家确认陪练订单完成后的响应。 */
public record ConfirmBoostRequestResponse(
        Long id,
        String status,
        String code,
        OffsetDateTime completedAt
) {}
