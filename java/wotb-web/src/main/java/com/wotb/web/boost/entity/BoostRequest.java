package com.wotb.web.boost.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/** 陪练需求/订单。与 boost_request 的 Flyway 迁移逐列对齐。 */
@Entity
@Table(name = "boost_request")
public class BoostRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "requester_user_id", length = 64)
    private String requesterUserId;

    @Column(name = "wotb_account_id")
    private Long wotbAccountId;

    @Column(name = "player_account_id")
    private Long playerAccountId;

    @Column(name = "player_nickname", length = 100)
    private String playerNickname;

    @Column(name = "region", nullable = false, length = 32)
    private String region;

    @Column(name = "request_type", nullable = false, length = 64)
    private String requestType;

    @Column(name = "target_description", nullable = false, columnDefinition = "text")
    private String targetDescription;

    @Column(name = "budget_range", length = 64)
    private String budgetRange;

    @Column(name = "contact_type", nullable = false, length = 32)
    private String contactType;

    @Column(name = "contact_value", nullable = false, length = 255)
    private String contactValue;

    @Column(name = "available_time", columnDefinition = "text")
    private String availableTime;

    @Column(name = "remark", columnDefinition = "text")
    private String remark;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "admin_note", columnDefinition = "text")
    private String adminNote;

    @Column(name = "completion_submitted_at")
    private OffsetDateTime completionSubmittedAt;

    @Column(name = "auto_confirm_at")
    private OffsetDateTime autoConfirmAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public BoostRequest() {
        // JPA
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }

    public String getRequesterUserId() { return requesterUserId; }
    public void setRequesterUserId(final String requesterUserId) { this.requesterUserId = requesterUserId; }

    public Long getWotbAccountId() { return wotbAccountId; }
    public void setWotbAccountId(final Long wotbAccountId) { this.wotbAccountId = wotbAccountId; }

    public Long getPlayerAccountId() { return playerAccountId; }
    public void setPlayerAccountId(final Long playerAccountId) { this.playerAccountId = playerAccountId; }

    public String getPlayerNickname() { return playerNickname; }
    public void setPlayerNickname(final String playerNickname) { this.playerNickname = playerNickname; }

    public String getRegion() { return region; }
    public void setRegion(final String region) { this.region = region; }

    public String getRequestType() { return requestType; }
    public void setRequestType(final String requestType) { this.requestType = requestType; }

    public String getTargetDescription() { return targetDescription; }
    public void setTargetDescription(final String targetDescription) { this.targetDescription = targetDescription; }

    public String getBudgetRange() { return budgetRange; }
    public void setBudgetRange(final String budgetRange) { this.budgetRange = budgetRange; }

    public String getContactType() { return contactType; }
    public void setContactType(final String contactType) { this.contactType = contactType; }

    public String getContactValue() { return contactValue; }
    public void setContactValue(final String contactValue) { this.contactValue = contactValue; }

    public String getAvailableTime() { return availableTime; }
    public void setAvailableTime(final String availableTime) { this.availableTime = availableTime; }

    public String getRemark() { return remark; }
    public void setRemark(final String remark) { this.remark = remark; }

    public String getStatus() { return status; }
    public void setStatus(final String status) { this.status = status; }

    public String getAdminNote() { return adminNote; }
    public void setAdminNote(final String adminNote) { this.adminNote = adminNote; }

    public OffsetDateTime getCompletionSubmittedAt() { return completionSubmittedAt; }
    public void setCompletionSubmittedAt(final OffsetDateTime completionSubmittedAt) {
        this.completionSubmittedAt = completionSubmittedAt;
    }

    public OffsetDateTime getAutoConfirmAt() { return autoConfirmAt; }
    public void setAutoConfirmAt(final OffsetDateTime autoConfirmAt) { this.autoConfirmAt = autoConfirmAt; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(final OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(final OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
