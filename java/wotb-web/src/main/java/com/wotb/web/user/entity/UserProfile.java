package com.wotb.web.user.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/** WotBTools 业务用户资料。Keycloak 负责认证，本表负责轻量业务数据。 */
@Entity
@Table(
    name = "user_profile",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_user_profile_wotb_account",
        columnNames = {"wotb_server", "wotb_account_id"}
    )
)
public class UserProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "keycloak_user_id", nullable = false, unique = true, length = 64)
    private String keycloakUserId;

    @Column(name = "display_name", length = 64)
    private String displayName;

    @Column(name = "wotb_account_id")
    private Long wotbAccountId;

    @Column(name = "wotb_nickname", length = 64)
    private String wotbNickname;

    @Column(name = "wotb_server", nullable = false, length = 32)
    private String wotbServer = "CN";

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public UserProfile() {
        // JPA
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }

    public String getKeycloakUserId() { return keycloakUserId; }
    public void setKeycloakUserId(final String keycloakUserId) { this.keycloakUserId = keycloakUserId; }

    public String getDisplayName() { return displayName; }
    public void setDisplayName(final String displayName) { this.displayName = displayName; }

    public Long getWotbAccountId() { return wotbAccountId; }
    public void setWotbAccountId(final Long wotbAccountId) { this.wotbAccountId = wotbAccountId; }

    public String getWotbNickname() { return wotbNickname; }
    public void setWotbNickname(final String wotbNickname) { this.wotbNickname = wotbNickname; }

    public String getWotbServer() { return wotbServer; }
    public void setWotbServer(final String wotbServer) { this.wotbServer = wotbServer; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(final OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
