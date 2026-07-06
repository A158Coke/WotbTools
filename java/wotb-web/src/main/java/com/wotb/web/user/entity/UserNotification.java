package com.wotb.web.user.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "user_notification")
public class UserNotification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "keycloak_user_id", nullable = false, length = 64)
    private String keycloakUserId;

    @Column(name = "type", nullable = false, length = 64)
    private String type;

    @Column(name = "subject_type", length = 32)
    private String subjectType;

    @Column(name = "subject_id")
    private Long subjectId;

    @Column(name = "payload", nullable = false, columnDefinition = "text")
    private String payload;

    @Column(name = "read_at")
    private OffsetDateTime readAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public UserNotification() {
        // JPA
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }

    public String getKeycloakUserId() { return keycloakUserId; }
    public void setKeycloakUserId(final String keycloakUserId) { this.keycloakUserId = keycloakUserId; }

    public String getType() { return type; }
    public void setType(final String type) { this.type = type; }

    public String getSubjectType() { return subjectType; }
    public void setSubjectType(final String subjectType) { this.subjectType = subjectType; }

    public Long getSubjectId() { return subjectId; }
    public void setSubjectId(final Long subjectId) { this.subjectId = subjectId; }

    public String getPayload() { return payload; }
    public void setPayload(final String payload) { this.payload = payload; }

    public OffsetDateTime getReadAt() { return readAt; }
    public void setReadAt(final OffsetDateTime readAt) { this.readAt = readAt; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(final OffsetDateTime createdAt) { this.createdAt = createdAt; }
}
