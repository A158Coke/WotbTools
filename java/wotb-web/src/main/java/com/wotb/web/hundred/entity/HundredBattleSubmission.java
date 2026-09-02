package com.wotb.web.hundred.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * 名人堂「百场」成绩 submission。单表承载完整生命周期（PENDING/CURRENT/SUPERSEDED/REJECTED/
 * CANCELLED/DELETED），创建瞬间冻结身份与成绩快照；claimed 与 approved 两套数据同时保留，
 * 排行榜只读取 approved*。
 *
 * <p>列结构与 Flyway V18 + V20 逐列对齐（ddl-auto=validate，改任一列必须同步迁移）。
 * user + vehicle 的 PENDING/CURRENT 唯一性由 partial unique index 在数据库层强制
 * （本实体不声明 @UniqueConstraint，避免 Hibernate validate 与 partial index 冲突）。</p>
 */
@Entity
@Table(name = "hundred_battle_submission")
public class HundredBattleSubmission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** WotBTools 用户（Keycloak sub）。 */
    @Column(name = "user_keycloak_id", nullable = false, length = 64)
    private String userKeycloakId;

    /** authoritative vehicleId（Tier X）。 */
    @Column(name = "vehicle_id", nullable = false)
    private long vehicleId;

    /** 车辆显示名快照（仅展示，不参与业务匹配）。 */
    @Column(name = "vehicle_name", nullable = false, length = 100)
    private String vehicleName;

    /** 创建瞬间冻结的 gameId（Profile 后续修改不影响本快照）。 */
    @Column(name = "game_account_id_snapshot", nullable = false)
    private long gameAccountIdSnapshot;

    /** 创建瞬间冻结的昵称快照（排行榜展示审核通过时的 nickname snapshot）。 */
    @Column(name = "nickname_snapshot", nullable = false, length = 100)
    private String nicknameSnapshot;

    @Column(name = "claimed_average_damage", nullable = false)
    private int claimedAverageDamage;

    @Column(name = "claimed_battle_count", nullable = false)
    private int claimedBattleCount;

    /** 管理员最终确认值（排行榜只读这两列；approve 前为 null）。 */
    @Column(name = "approved_average_damage")
    private Integer approvedAverageDamage;

    @Column(name = "approved_battle_count")
    private Integer approvedBattleCount;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    /** 临时私有审核资产：base64 data URL；终态事务内清空，不永久保存。 */
    @Column(name = "proof_screenshot", columnDefinition = "text")
    private String proofScreenshot;

    /** 机器验证结果（创建时全部为 true；仅作 admin 审核页展示与审计）。 */
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

    public HundredBattleSubmission() {
        // JPA / service 组装
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }
    public String getUserKeycloakId() { return userKeycloakId; }
    public void setUserKeycloakId(final String userKeycloakId) { this.userKeycloakId = userKeycloakId; }
    public long getVehicleId() { return vehicleId; }
    public void setVehicleId(final long vehicleId) { this.vehicleId = vehicleId; }
    public String getVehicleName() { return vehicleName; }
    public void setVehicleName(final String vehicleName) { this.vehicleName = vehicleName; }
    public long getGameAccountIdSnapshot() { return gameAccountIdSnapshot; }
    public void setGameAccountIdSnapshot(final long gameAccountIdSnapshot) { this.gameAccountIdSnapshot = gameAccountIdSnapshot; }
    public String getNicknameSnapshot() { return nicknameSnapshot; }
    public void setNicknameSnapshot(final String nicknameSnapshot) { this.nicknameSnapshot = nicknameSnapshot; }
    public int getClaimedAverageDamage() { return claimedAverageDamage; }
    public void setClaimedAverageDamage(final int claimedAverageDamage) { this.claimedAverageDamage = claimedAverageDamage; }
    public int getClaimedBattleCount() { return claimedBattleCount; }
    public void setClaimedBattleCount(final int claimedBattleCount) { this.claimedBattleCount = claimedBattleCount; }
    public Integer getApprovedAverageDamage() { return approvedAverageDamage; }
    public void setApprovedAverageDamage(final Integer approvedAverageDamage) { this.approvedAverageDamage = approvedAverageDamage; }
    public Integer getApprovedBattleCount() { return approvedBattleCount; }
    public void setApprovedBattleCount(final Integer approvedBattleCount) { this.approvedBattleCount = approvedBattleCount; }
    public String getStatus() { return status; }
    public void setStatus(final String status) { this.status = status; }
    public String getProofScreenshot() { return proofScreenshot; }
    public void setProofScreenshot(final String proofScreenshot) { this.proofScreenshot = proofScreenshot; }
    public boolean isReplayParseOk() { return replayParseOk; }
    public void setReplayParseOk(final boolean replayParseOk) { this.replayParseOk = replayParseOk; }
    public boolean isReplayGameIdMatch() { return replayGameIdMatch; }
    public void setReplayGameIdMatch(final boolean replayGameIdMatch) { this.replayGameIdMatch = replayGameIdMatch; }
    public boolean isReplayVehicleMatch() { return replayVehicleMatch; }
    public void setReplayVehicleMatch(final boolean replayVehicleMatch) { this.replayVehicleMatch = replayVehicleMatch; }
    public boolean isReplayDistinctBattles() { return replayDistinctBattles; }
    public void setReplayDistinctBattles(final boolean replayDistinctBattles) { this.replayDistinctBattles = replayDistinctBattles; }
    public OffsetDateTime getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(final OffsetDateTime submittedAt) { this.submittedAt = submittedAt; }
    public OffsetDateTime getApprovedAt() { return approvedAt; }
    public void setApprovedAt(final OffsetDateTime approvedAt) { this.approvedAt = approvedAt; }
    public String getApprovedBy() { return approvedBy; }
    public void setApprovedBy(final String approvedBy) { this.approvedBy = approvedBy; }
    public OffsetDateTime getRejectedAt() { return rejectedAt; }
    public void setRejectedAt(final OffsetDateTime rejectedAt) { this.rejectedAt = rejectedAt; }
    public String getRejectedBy() { return rejectedBy; }
    public void setRejectedBy(final String rejectedBy) { this.rejectedBy = rejectedBy; }
    public String getRejectReason() { return rejectReason; }
    public void setRejectReason(final String rejectReason) { this.rejectReason = rejectReason; }
    public String getRejectReasonText() { return rejectReasonText; }
    public void setRejectReasonText(final String rejectReasonText) { this.rejectReasonText = rejectReasonText; }
    public OffsetDateTime getCancelledAt() { return cancelledAt; }
    public void setCancelledAt(final OffsetDateTime cancelledAt) { this.cancelledAt = cancelledAt; }
    public OffsetDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(final OffsetDateTime deletedAt) { this.deletedAt = deletedAt; }
    public String getDeletedBy() { return deletedBy; }
    public void setDeletedBy(final String deletedBy) { this.deletedBy = deletedBy; }
    public String getDeleteReason() { return deleteReason; }
    public void setDeleteReason(final String deleteReason) { this.deleteReason = deleteReason; }
    public String getDeleteReasonText() { return deleteReasonText; }
    public void setDeleteReasonText(final String deleteReasonText) { this.deleteReasonText = deleteReasonText; }
}
