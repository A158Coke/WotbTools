package com.wotb.web.user.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.web.user.dto.UserNotificationDto;
import com.wotb.web.user.entity.UserNotification;
import com.wotb.web.user.enums.UserNotificationType;
import com.wotb.web.user.repository.UserNotificationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Service
public class UserNotificationService {

    private static final String EMPTY_PAYLOAD = "{}";

    private final UserNotificationRepository repository;
    private final UserNotificationMapper mapper;
    private final ObjectMapper objectMapper;

    public UserNotificationService(final UserNotificationRepository repository,
                                   final UserNotificationMapper mapper,
                                   final ObjectMapper objectMapper) {
        this.repository = repository;
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public void create(final String keycloakUserId,
                       final UserNotificationType type,
                       final String subjectType,
                       final Long subjectId,
                       final Map<String, String> payload) {
        if (!StringUtils.hasText(keycloakUserId)) {
            return;
        }
        final UserNotification notification = new UserNotification();
        notification.setKeycloakUserId(keycloakUserId);
        notification.setType(type.name());
        notification.setSubjectType(subjectType);
        notification.setSubjectId(subjectId);
        notification.setPayload(toJson(payload));
        repository.save(notification);
    }

    @Transactional(readOnly = true)
    public List<UserNotificationDto> listMine(final String keycloakUserId) {
        return repository.findTop30ByKeycloakUserIdOrderByCreatedAtDesc(keycloakUserId)
                .stream()
                .map(mapper::toDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public long unreadCount(final String keycloakUserId) {
        return repository.countByKeycloakUserIdAndReadAtIsNull(keycloakUserId);
    }

    @Transactional
    public UserNotificationDto markRead(final String keycloakUserId, final Long id) {
        final UserNotification notification = repository.findByIdAndKeycloakUserId(id, keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("NOTIFICATION_NOT_FOUND"));
        if (notification.getReadAt() == null) {
            notification.setReadAt(OffsetDateTime.now());
        }
        return mapper.toDto(notification);
    }

    @Transactional
    public void markAllRead(final String keycloakUserId) {
        final OffsetDateTime now = OffsetDateTime.now();
        repository.findByKeycloakUserIdAndReadAtIsNull(keycloakUserId)
                .forEach(notification -> notification.setReadAt(now));
    }

    private String toJson(final Map<String, String> payload) {
        if (payload == null || payload.isEmpty()) {
            return EMPTY_PAYLOAD;
        }
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (final JsonProcessingException e) {
            return EMPTY_PAYLOAD;
        }
    }
}
