package com.wotb.web.user.dto;

import java.time.OffsetDateTime;
import java.util.Map;

public record UserNotificationDto(
        Long id,
        String type,
        String subjectType,
        Long subjectId,
        Map<String, String> payload,
        boolean read,
        OffsetDateTime readAt,
        OffsetDateTime createdAt
) {}
