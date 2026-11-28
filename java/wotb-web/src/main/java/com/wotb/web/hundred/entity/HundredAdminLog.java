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
 * 名人堂「百场」管理员删除审计（只读）。
 * submission 物理删除后原行不存在，快照必须完整落库（不能只存 submission_id FK）；
 * 与删除同一事务（audit 失败 → submission 不删；submission 删除失败 → 无假审计）。
 * 记录的是删除前的原始状态，不伪造 DELETED 状态。
 */
@Entity
@Table(name = "hundred_admin_log")
public class HundredAdminLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "action", nullable = false, length = 32)
    private String action = "DELETE_SUBMISSION";

    @Column(name = "submission_id", nullable = false)
    private long submissionId;

    @Column(name = "original_status", nullable = false, length = 16)
    private String originalStatus;

    @Column(name = "wotb_server", nullable = false, length = 16)
    private String wotbServer;

    @Column(name = "wotb_account_id", nullable = false)
    private long wotbAccountId;

    @Column(name = "vehicle_id", nullable = false)
    private long vehicleId;

    @Column(name = "vehicle_name", nullable = false, length = 100)
    private String vehicleName;

    @Column(name = "nickname_snapshot", nullable = false, length = 100)
    private String nicknameSnapshot;

    @Column(name = "claimed_average_damage", nullable = false)
    private int claimedAverageDamage;

    @Column(name = "claimed_battle_count", nullable = false)
    private int claimedBattleCount;

    @Column(name = "approved_average_damage")
    private Integer approvedAverageDamage;

    @Column(name = "approved_battle_count")
    private Integer approvedBattleCount;

    @Column(name = "had_proof_screenshot", nullable = false)
    private boolean hadProofScreenshot;

    @Column(name = "admin_keycloak_user_id", nullable = false, length = 64)
    private String adminKeycloakUserId;

    @Column(name = "admin_username", length = 128)
    private String adminUsername;

    @Column(name = "delete_reason", nullable = false, length = 64)
    private String deleteReason;

    @Column(name = "delete_reason_text", length = 500)
    private String deleteReasonText;

    /** V50 之前的软删除墓碑历史（仅原 status='DELETED' 的行有值），随物理删除独立留存。 */
    @Column(name = "previous_deleted_at")
    private OffsetDateTime previousDeletedAt;

    @Column(name = "previous_deleted_by", length = 64)
    private String previousDeletedBy;

    @Column(name = "previous_delete_reason", length = 64)
    private String previousDeleteReason;

    @Column(name = "previous_delete_reason_text", length = 500)
    private String previousDeleteReasonText;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public HundredAdminLog() {
        // JPA
    }

    /** DELETE_SUBMISSION 审计快照（submission 物理删除前完整拷贝 authoritative facts）。 */
    public static HundredAdminLog deleteSubmission(final HundredBattleSubmission s,
                                                   final String adminKeycloakUserId,
                                                   final String adminUsername,
                                                   final String deleteReason,
                                                   final String deleteReasonText) {
        final HundredAdminLog log = new HundredAdminLog();
        log.action = "DELETE_SUBMISSION";
        log.submissionId = s.getId();
        log.originalStatus = s.getStatus();
        log.wotbServer = s.getWotbServer();
        log.wotbAccountId = s.getWotbAccountId();
        log.vehicleId = s.getVehicleId();
        log.vehicleName = s.getVehicleName();
        log.nicknameSnapshot = s.getNicknameSnapshot();
        log.claimedAverageDamage = s.getClaimedAverageDamage();
        log.claimedBattleCount = s.getClaimedBattleCount();
        log.approvedAverageDamage = s.getApprovedAverageDamage();
        log.approvedBattleCount = s.getApprovedBattleCount();
        log.hadProofScreenshot = s.getProofScreenshot() != null;
        log.adminKeycloakUserId = adminKeycloakUserId;
        log.adminUsername = adminUsername;
        log.deleteReason = deleteReason;
        log.deleteReasonText = deleteReasonText;
        // V50 之前的软删除墓碑：原软删事件的操作者/时间/原因必须随快照独立留存，不能只留本次物理删除事件
        log.previousDeletedAt = s.getDeletedAt();
        log.previousDeletedBy = s.getDeletedBy();
        log.previousDeleteReason = s.getDeleteReason();
        log.previousDeleteReasonText = s.getDeleteReasonText();
        return log;
    }

    public Long getId() { return id; }

    public String getAction() { return action; }

    public long getSubmissionId() { return submissionId; }

    public String getOriginalStatus() { return originalStatus; }

    public String getWotbServer() { return wotbServer; }

    public long getWotbAccountId() { return wotbAccountId; }

    public long getVehicleId() { return vehicleId; }

    public String getVehicleName() { return vehicleName; }

    public String getNicknameSnapshot() { return nicknameSnapshot; }

    public int getClaimedAverageDamage() { return claimedAverageDamage; }

    public int getClaimedBattleCount() { return claimedBattleCount; }

    public Integer getApprovedAverageDamage() { return approvedAverageDamage; }

    public Integer getApprovedBattleCount() { return approvedBattleCount; }

    public boolean isHadProofScreenshot() { return hadProofScreenshot; }

    public String getAdminKeycloakUserId() { return adminKeycloakUserId; }

    public String getAdminUsername() { return adminUsername; }

    public String getDeleteReason() { return deleteReason; }

    public String getDeleteReasonText() { return deleteReasonText; }

    public OffsetDateTime getPreviousDeletedAt() { return previousDeletedAt; }

    public String getPreviousDeletedBy() { return previousDeletedBy; }

    public String getPreviousDeleteReason() { return previousDeleteReason; }

    public String getPreviousDeleteReasonText() { return previousDeleteReasonText; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
}
