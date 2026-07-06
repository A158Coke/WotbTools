package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserNotificationDto;
import com.wotb.web.user.entity.UserNotification;
import org.springframework.stereotype.Service;

import java.util.Map;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

@Service
public class UserNotificationMapper {

    private static final TypeReference<Map<String, String>> PAYLOAD_TYPE = new TypeReference<>() {};
    private static final ObjectMapper OBJECT_MAPPER = JsonMapper.builder().build();

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
            return OBJECT_MAPPER.readValue(payload, PAYLOAD_TYPE);
        } catch (final Exception e) {
            return Map.of();
        }
    }
}
