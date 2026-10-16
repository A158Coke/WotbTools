package com.wotb.web.admin.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

/** 管理员操作日志。记录管理员对用户的所有操作（删除等）、谁做的、结果如何。 */
@Entity
@Table(name = "admin_user_log")
public class AdminUserLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "operation", nullable = false, length = 32)
    private String operation = "DELETE_USER";

    @Column(name = "target_keycloak_user_id", nullable = false, length = 64)
    private String targetKeycloakUserId;

    @Column(name = "target_profile_id")
    private Long targetProfileId;

    @Column(name = "target_display_name", length = 64)
    private String targetDisplayName;

    @Column(name = "target_wotb_account_id")
    private Long targetWotbAccountId;

    @Column(name = "target_wotb_nickname", length = 64)
    private String targetWotbNickname;

    @Column(name = "target_wotb_server", length = 32)
    private String targetWotbServer;

    @Column(name = "admin_keycloak_user_id", nullable = false, length = 64)
    private String adminKeycloakUserId;

    @Column(name = "admin_username", length = 128)
    private String adminUsername;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "local_profile_deleted", nullable = false)
    private boolean localProfileDeleted = false;

    @Column(name = "keycloak_user_deleted", nullable = false)
    private boolean keycloakUserDeleted = false;

    @Column(name = "error_code", length = 64)
    private String errorCode;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public AdminUserLog() {}

    // ── 工厂方法 ────────────────────────────────────────────────────

    public static AdminUserLog started(
            final String targetKeycloakUserId,
            final com.wotb.web.user.entity.UserProfile profile,
            final String adminKeycloakUserId,
            final String adminUsername) {
        final AdminUserLog log = new AdminUserLog();
        log.operation = "DELETE_USER";
        log.targetKeycloakUserId = targetKeycloakUserId;
        if (profile != null) {
            log.targetProfileId = profile.getId();
            log.targetDisplayName = profile.getDisplayName();
            log.targetWotbAccountId = profile.getWotbAccountId();
            log.targetWotbNickname = profile.getWotbNickname();
            log.targetWotbServer = profile.getWotbServer();
        }
        log.adminKeycloakUserId = adminKeycloakUserId;
        log.adminUsername = adminUsername;
        log.status = "STARTED";
        return log;
    }

    public void markSuccess(final boolean localDeleted, final boolean keycloakDeleted) {
        this.status = "SUCCESS";
        this.localProfileDeleted = localDeleted;
        this.keycloakUserDeleted = keycloakDeleted;
    }

    public void markFailedLocalDelete(final String errorCode, final String errorMessage) {
        this.status = "FAILED_LOCAL_DELETE";
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
    }

    public void markFailedKeycloakDelete(final String errorCode, final boolean localDeleted, final String errorMessage) {
        this.status = "FAILED_KEYCLOAK_DELETE";
        this.localProfileDeleted = localDeleted;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
    }

    // ── Getters ─────────────────────────────────────────────────────

    public Long getId() { return id; }
    public String getOperation() { return operation; }
    public String getTargetKeycloakUserId() { return targetKeycloakUserId; }
    public Long getTargetProfileId() { return targetProfileId; }
    public String getTargetDisplayName() { return targetDisplayName; }
    public Long getTargetWotbAccountId() { return targetWotbAccountId; }
    public String getTargetWotbNickname() { return targetWotbNickname; }
    public String getTargetWotbServer() { return targetWotbServer; }
    public String getAdminKeycloakUserId() { return adminKeycloakUserId; }
    public String getAdminUsername() { return adminUsername; }
    public String getStatus() { return status; }
    public boolean isLocalProfileDeleted() { return localProfileDeleted; }
    public boolean isKeycloakUserDeleted() { return keycloakUserDeleted; }
    public String getErrorCode() { return errorCode; }
    public String getErrorMessage() { return errorMessage; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
