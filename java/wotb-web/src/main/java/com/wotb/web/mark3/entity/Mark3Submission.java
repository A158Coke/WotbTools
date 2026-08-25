package com.wotb.web.mark3.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/**
 * 名人堂「三环」人工审核 submission。创建时冻结身份与申报成绩；管理员只能 approve/reject/delete，
 * approve 将 claimed 快照原样冻结为 approved，绝不接收改分数据。
 *
 * <p>列结构与 Flyway V21 逐列对齐。partial unique index 在数据库层保证同一 user + vehicle
 * 最多一个 active PENDING/CURRENT，CURRENT 因而不可被后续申请替代。</p>
 */
@Entity
@Table(name = "mark3_submission")
public class Mark3Submission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_keycloak_id", nullable = false, length = 64)
    private String userKeycloakId;

    @Column(name = "vehicle_id", nullable = false)
    private long vehicleId;

    @Column(name = "vehicle_name", nullable = false, length = 100)
    private String vehicleName;

    @Column(name = "game_account_id_snapshot", nullable = false)
    private long gameAccountIdSnapshot;

    @Column(name = "nickname_snapshot", nullable = false, length = 100)
    private String nicknameSnapshot;

    @Column(name = "claimed_battle_count", nullable = false)
    private int claimedBattleCount;

    @Column(name = "claimed_average_damage", nullable = false)
    private int claimedAverageDamage;

    @Column(name = "claimed_win_rate", nullable = false, precision = 5, scale = 2)
    private BigDecimal claimedWinRate;

    @Column(name = "approved_battle_count")
    private Integer approvedBattleCount;

    @Column(name = "approved_average_damage")
    private Integer approvedAverageDamage;

    @Column(name = "approved_win_rate", precision = 5, scale = 2)
    private BigDecimal approvedWinRate;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "proof_screenshot_first", columnDefinition = "text")
    private String proofScreenshotFirst;

    @Column(name = "proof_screenshot_second", columnDefinition = "text")
    private String proofScreenshotSecond;

    @Column(name = "replay_parse_ok", nullable = false)
    private boolean replayParseOk = true;

    @Column(name = "replay_game_id_match", nullable = false)
    private boolean replayGameIdMatch = true;

    @Column(name = "replay_vehicle_match", nullable = false)
    private boolean replayVehicleMatch = true;

    @Column(name = "replay_distinct_battles", nullable = false)
    private boolean replayDistinctBattles = true;

    @CreationTimestamp
    @Column(name = "submitted_at", nullable = false)
    private OffsetDateTime submittedAt;

    @Column(name = "approved_at")
    private OffsetDateTime approvedAt;

    @Column(name = "approved_by", length = 64)
    private String approvedBy;

    @Column(name = "rejected_at")
    private OffsetDateTime rejectedAt;

    @Column(name = "rejected_by", length = 64)
    private String rejectedBy;

    @Column(name = "reject_reason", length = 64)
    private String rejectReason;

    @Column(name = "reject_reason_text", length = 500)
    private String rejectReasonText;

    @Column(name = "cancelled_at")
    private OffsetDateTime cancelledAt;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    @Column(name = "deleted_by", length = 64)
    private String deletedBy;

    @Column(name = "delete_reason", length = 64)
    private String deleteReason;

    @Column(name = "delete_reason_text", length = 500)
    private String deleteReasonText;

    public Mark3Submission() {
        // JPA / service assembly
    }

    public Long getId() { return id; }
    public void setId(final Long value) { this.id = value; }
    public String getUserKeycloakId() { return userKeycloakId; }
    public void setUserKeycloakId(final String value) { this.userKeycloakId = value; }
    public long getVehicleId() { return vehicleId; }
    public void setVehicleId(final long value) { this.vehicleId = value; }
    public String getVehicleName() { return vehicleName; }
    public void setVehicleName(final String value) { this.vehicleName = value; }
    public long getGameAccountIdSnapshot() { return gameAccountIdSnapshot; }
    public void setGameAccountIdSnapshot(final long value) { this.gameAccountIdSnapshot = value; }
    public String getNicknameSnapshot() { return nicknameSnapshot; }
    public void setNicknameSnapshot(final String value) { this.nicknameSnapshot = value; }
    public int getClaimedBattleCount() { return claimedBattleCount; }
    public void setClaimedBattleCount(final int value) { this.claimedBattleCount = value; }
    public int getClaimedAverageDamage() { return claimedAverageDamage; }
    public void setClaimedAverageDamage(final int value) { this.claimedAverageDamage = value; }
    public BigDecimal getClaimedWinRate() { return claimedWinRate; }
    public void setClaimedWinRate(final BigDecimal value) { this.claimedWinRate = value; }
    public Integer getApprovedBattleCount() { return approvedBattleCount; }
    public void setApprovedBattleCount(final Integer value) { this.approvedBattleCount = value; }
    public Integer getApprovedAverageDamage() { return approvedAverageDamage; }
    public void setApprovedAverageDamage(final Integer value) { this.approvedAverageDamage = value; }
    public BigDecimal getApprovedWinRate() { return approvedWinRate; }
    public void setApprovedWinRate(final BigDecimal value) { this.approvedWinRate = value; }
    public String getStatus() { return status; }
    public void setStatus(final String value) { this.status = value; }
    public String getProofScreenshotFirst() { return proofScreenshotFirst; }
    public void setProofScreenshotFirst(final String value) { this.proofScreenshotFirst = value; }
    public String getProofScreenshotSecond() { return proofScreenshotSecond; }
    public void setProofScreenshotSecond(final String value) { this.proofScreenshotSecond = value; }
    public boolean isReplayParseOk() { return replayParseOk; }
    public void setReplayParseOk(final boolean value) { this.replayParseOk = value; }
    public boolean isReplayGameIdMatch() { return replayGameIdMatch; }
    public void setReplayGameIdMatch(final boolean value) { this.replayGameIdMatch = value; }
    public boolean isReplayVehicleMatch() { return replayVehicleMatch; }
    public void setReplayVehicleMatch(final boolean value) { this.replayVehicleMatch = value; }
    public boolean isReplayDistinctBattles() { return replayDistinctBattles; }
    public void setReplayDistinctBattles(final boolean value) { this.replayDistinctBattles = value; }
    public OffsetDateTime getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(final OffsetDateTime value) { this.submittedAt = value; }
    public OffsetDateTime getApprovedAt() { return approvedAt; }
    public void setApprovedAt(final OffsetDateTime value) { this.approvedAt = value; }
    public String getApprovedBy() { return approvedBy; }
    public void setApprovedBy(final String value) { this.approvedBy = value; }
    public OffsetDateTime getRejectedAt() { return rejectedAt; }
    public void setRejectedAt(final OffsetDateTime value) { this.rejectedAt = value; }
    public String getRejectedBy() { return rejectedBy; }
    public void setRejectedBy(final String value) { this.rejectedBy = value; }
    public String getRejectReason() { return rejectReason; }
    public void setRejectReason(final String value) { this.rejectReason = value; }
    public String getRejectReasonText() { return rejectReasonText; }
    public void setRejectReasonText(final String value) { this.rejectReasonText = value; }
    public OffsetDateTime getCancelledAt() { return cancelledAt; }
    public void setCancelledAt(final OffsetDateTime value) { this.cancelledAt = value; }
    public OffsetDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(final OffsetDateTime value) { this.deletedAt = value; }
    public String getDeletedBy() { return deletedBy; }
    public void setDeletedBy(final String value) { this.deletedBy = value; }
    public String getDeleteReason() { return deleteReason; }
    public void setDeleteReason(final String value) { this.deleteReason = value; }
    public String getDeleteReasonText() { return deleteReasonText; }
    public void setDeleteReasonText(final String value) { this.deleteReasonText = value; }
}
