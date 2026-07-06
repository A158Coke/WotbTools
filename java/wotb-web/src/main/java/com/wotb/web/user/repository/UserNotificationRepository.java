package com.wotb.web.user.repository;

import com.wotb.web.user.entity.UserNotification;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserNotificationRepository extends JpaRepository<UserNotification, Long> {

    List<UserNotification> findTop30ByKeycloakUserIdOrderByCreatedAtDesc(String keycloakUserId);

    long countByKeycloakUserIdAndReadAtIsNull(String keycloakUserId);

    Optional<UserNotification> findByIdAndKeycloakUserId(Long id, String keycloakUserId);

    List<UserNotification> findByKeycloakUserIdAndReadAtIsNull(String keycloakUserId);
}
