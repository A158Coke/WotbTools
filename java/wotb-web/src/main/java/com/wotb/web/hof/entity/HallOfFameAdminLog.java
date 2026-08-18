package com.wotb.web.hof.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * 名人堂管理操作审计（只读）。第一版只记录 DELETE_ENTRY；
 * 因 record hard delete 后原记录已不存在，快照必须完整落库（不能只存 record_id FK）。
 * 与删除记录同一事务（audit 失败 → 记录不删；记录删除失败 → 无假审计）。
 */
@Entity
@Table(name = "hall_of_fame_admin_log")
public class HallOfFameAdminLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "action", nullable = false, length = 32)
    private String action = "DELETE_ENTRY";

    @Column(name = "record_id", nullable = false)
    private long recordId;

    @Column(name = "arena_id", nullable = false, length = 32)
    private String arenaId;

    @Column(name = "account_id", nullable = false)
    private long accountId;

    @Column(name = "nickname", nullable = false, length = 100)
    private String nickname;

    @Column(name = "tank_id", nullable = false)
    private long tankId;

    @Column(name = "tank_name", nullable = false, length = 100)
    private String tankName;

    @Column(name = "damage_dealt", nullable = false)
    private int damageDealt;

    @Column(name = "battle_type", nullable = false, length = 16)
    private String battleType;

    @Column(name = "arena_bonus_type", nullable = false)
    private int arenaBonusType;

    @Column(name = "replay_hash", length = 64)
    private String replayHash;

    @Column(name = "admin_keycloak_user_id", nullable = false, length = 64)
    private String adminKeycloakUserId;

    @Column(name = "admin_username", length = 128)
    private String adminUsername;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public HallOfFameAdminLog() {
        // JPA
    }

    /** DELETE_ENTRY 审计快照（record 删除前完整拷贝 authoritative facts）。 */
    public static HallOfFameAdminLog deleteEntry(final HallOfFameRecord r,
                                                 final String adminSub,
                                                 final String adminUsername) {
        final HallOfFameAdminLog log = new HallOfFameAdminLog();
        log.action = "DELETE_ENTRY";
        log.recordId = r.getId();
        log.arenaId = r.getArenaId();
        log.accountId = r.getAccountId();
        log.nickname = r.getNickname();
        log.tankId = r.getTankId();
        log.tankName = r.getTankName();
        log.damageDealt = r.getDamageDealt();
        log.battleType = r.getBattleType();
        log.arenaBonusType = r.getArenaBonusType();
        log.replayHash = r.getReplayHash();
        log.adminKeycloakUserId = adminSub;
        log.adminUsername = adminUsername;
        return log;
    }

    public Long getId() {
        return id;
    }

    public String getAction() {
        return action;
    }

    public long getRecordId() {
        return recordId;
    }

    public String getArenaId() {
        return arenaId;
    }

    public long getAccountId() {
        return accountId;
    }

    public String getNickname() {
        return nickname;
    }

    public long getTankId() {
        return tankId;
    }

    public String getTankName() {
        return tankName;
    }

    public int getDamageDealt() {
        return damageDealt;
    }

    public String getBattleType() {
        return battleType;
    }

    public int getArenaBonusType() {
        return arenaBonusType;
    }

    public String getReplayHash() {
        return replayHash;
    }

    public String getAdminKeycloakUserId() {
        return adminKeycloakUserId;
    }

    public String getAdminUsername() {
        return adminUsername;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }
}
