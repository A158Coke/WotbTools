package com.wotb.web.user.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.web.user.dto.UserNotificationDto;
import com.wotb.web.user.entity.UserNotification;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class UserNotificationMapper {

    private static final TypeReference<Map<String, String>> PAYLOAD_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper;

    public UserNotificationMapper(final ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public UserNotificationDto toDto(final UserNotification notification) {
        return new UserNotificationDto(
                notification.getId(),
                notification.getType(),
                notification.getSubjectType(),
                notification.getSubjectId(),
                readPayload(notification.getPayload()),
                notification.getReadAt() != null,
                notification.getReadAt(),
                notification.getCreatedAt()
        );
    }

    private Map<String, String> readPayload(final String payload) {
        try {
            return objectMapper.readValue(payload, PAYLOAD_TYPE);
        } catch (final Exception e) {
            return Map.of();
        }
    }
}
