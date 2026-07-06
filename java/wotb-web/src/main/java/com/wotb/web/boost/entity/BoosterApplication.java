package com.wotb.web.boost.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "booster_application")
public class BoosterApplication {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "keycloak_user_id", nullable = false, length = 64)
    private String keycloakUserId;

    @Column(name = "user_profile_id", nullable = false)
    private Long userProfileId;

    @Column(name = "wotb_account_id", nullable = false)
    private Long wotbAccountId;

    @Column(name = "wotb_nickname", nullable = false, length = 100)
    private String wotbNickname;

    @Column(name = "wotb_server", nullable = false, length = 32)
    private String wotbServer;

    @Column(name = "overall_stats_image", nullable = false, columnDefinition = "text")
    private String overallStatsImage;

    @Column(name = "vehicle_stats_image", nullable = false, columnDefinition = "text")
    private String vehicleStatsImage;

    @Column(name = "requested_level", nullable = false, length = 32)
    private String requestedLevel;

    @Column(name = "qq", nullable = false, length = 64)
    private String qq;

    @Column(name = "wechat", length = 64)
    private String wechat;

    @Column(name = "availability_tier", nullable = false, length = 64)
    private String availabilityTier;

    @Column(name = "daily_time_window", nullable = false, length = 255)
    private String dailyTimeWindow;

    @Column(name = "self_assessment", columnDefinition = "text")
    private String selfAssessment;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "admin_note", columnDefinition = "text")
    private String adminNote;

    @Column(name = "approved_booster_id")
    private Long approvedBoosterId;

    @Column(name = "reviewed_by", length = 64)
    private String reviewedBy;

    @Column(name = "reviewed_at")
    private OffsetDateTime reviewedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public BoosterApplication() {
        // JPA
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }

    public String getKeycloakUserId() { return keycloakUserId; }
    public void setKeycloakUserId(final String keycloakUserId) { this.keycloakUserId = keycloakUserId; }

    public Long getUserProfileId() { return userProfileId; }
    public void setUserProfileId(final Long userProfileId) { this.userProfileId = userProfileId; }

    public Long getWotbAccountId() { return wotbAccountId; }
    public void setWotbAccountId(final Long wotbAccountId) { this.wotbAccountId = wotbAccountId; }

    public String getWotbNickname() { return wotbNickname; }
    public void setWotbNickname(final String wotbNickname) { this.wotbNickname = wotbNickname; }

    public String getWotbServer() { return wotbServer; }
    public void setWotbServer(final String wotbServer) { this.wotbServer = wotbServer; }

    public String getOverallStatsImage() { return overallStatsImage; }
    public void setOverallStatsImage(final String overallStatsImage) { this.overallStatsImage = overallStatsImage; }

    public String getVehicleStatsImage() { return vehicleStatsImage; }
    public void setVehicleStatsImage(final String vehicleStatsImage) { this.vehicleStatsImage = vehicleStatsImage; }

    public String getRequestedLevel() { return requestedLevel; }
    public void setRequestedLevel(final String requestedLevel) { this.requestedLevel = requestedLevel; }

    public String getQq() { return qq; }
    public void setQq(final String qq) { this.qq = qq; }

    public String getWechat() { return wechat; }
    public void setWechat(final String wechat) { this.wechat = wechat; }

    public String getAvailabilityTier() { return availabilityTier; }
    public void setAvailabilityTier(final String availabilityTier) { this.availabilityTier = availabilityTier; }

    public String getDailyTimeWindow() { return dailyTimeWindow; }
    public void setDailyTimeWindow(final String dailyTimeWindow) { this.dailyTimeWindow = dailyTimeWindow; }

    public String getSelfAssessment() { return selfAssessment; }
    public void setSelfAssessment(final String selfAssessment) { this.selfAssessment = selfAssessment; }

    public String getStatus() { return status; }
    public void setStatus(final String status) { this.status = status; }

    public String getAdminNote() { return adminNote; }
    public void setAdminNote(final String adminNote) { this.adminNote = adminNote; }

    public Long getApprovedBoosterId() { return approvedBoosterId; }
    public void setApprovedBoosterId(final Long approvedBoosterId) { this.approvedBoosterId = approvedBoosterId; }

    public String getReviewedBy() { return reviewedBy; }
    public void setReviewedBy(final String reviewedBy) { this.reviewedBy = reviewedBy; }

    public OffsetDateTime getReviewedAt() { return reviewedAt; }
    public void setReviewedAt(final OffsetDateTime reviewedAt) { this.reviewedAt = reviewedAt; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(final OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(final OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
