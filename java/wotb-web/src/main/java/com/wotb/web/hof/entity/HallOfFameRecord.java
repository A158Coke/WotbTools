package com.wotb.web.hof.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * 名人堂单场成绩。列结构与 Flyway V1__init_leaderboard.sql → V16__rename_leaderboard_to_hall_of_fame.sql
 * 逐列对齐（ddl-auto=validate, 改任一列必须同步迁移）。
 * 成绩唯一 creation authority 是 .wotbreplay → ReplayParser → authoritative facts；admin 不可人工修改。
 */
@Entity
@Table(name = "hall_of_fame_record",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_hall_of_fame_record_arena_player",
                columnNames = {"arena_id", "account_id"}))
public class HallOfFameRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "arena_id", nullable = false, length = 32)
    private String arenaId;

    @Column(name = "tank_id", nullable = false)
    private long tankId;

    @Column(name = "tank_name", nullable = false, length = 100)
    private String tankName;

    @Column(name = "account_id", nullable = false)
    private long accountId;

    @Column(name = "nickname", nullable = false, length = 100)
    private String nickname;

    /**
     * 业务归一战斗模式：RANDOM / RATING（VARCHAR + CHECK，非 PG ENUM）。
     */
    @Column(name = "battle_type", nullable = false, length = 16)
    private String battleType;

    /**
     * replay 解析出的 authoritative raw arenaBonusType（protocol provenance / 调试 / 未来扩展）。
     */
    @Column(name = "arena_bonus_type", nullable = false)
    private int arenaBonusType;

    @Column(name = "damage_dealt", nullable = false)
    private int damageDealt;

    @Column(name = "map_name", length = 100)
    private String mapName;

    @Column(name = "version", length = 32)
    private String version;

    @Column(name = "battle_time")
    private OffsetDateTime battleTime;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "replay_hash", length = 64)
    private String replayHash;

    @Column(name = "replay_file_name", length = 255)
    private String replayFileName;

    @Column(name = "replay_size")
    private Long replaySize;

    @Column(name = "replay_uploaded_by", length = 255)
    private String replayUploadedBy;

    public HallOfFameRecord() {
        // JPA / service 组装
    }

    public Long getId() {
        return id;
    }

    public void setId(final Long id) {
        this.id = id;
    }

    public String getArenaId() {
        return arenaId;
    }

    public void setArenaId(final String arenaId) {
        this.arenaId = arenaId;
    }

    public long getTankId() {
        return tankId;
    }

    public void setTankId(final long tankId) {
        this.tankId = tankId;
    }

    public String getTankName() {
        return tankName;
    }

    public void setTankName(final String tankName) {
        this.tankName = tankName;
    }

    public long getAccountId() {
        return accountId;
    }

    public void setAccountId(final long accountId) {
        this.accountId = accountId;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(final String nickname) {
        this.nickname = nickname;
    }

    public String getBattleType() {
        return battleType;
    }

    public void setBattleType(final String battleType) {
        this.battleType = battleType;
    }

    public int getArenaBonusType() {
        return arenaBonusType;
    }

    public void setArenaBonusType(final int arenaBonusType) {
        this.arenaBonusType = arenaBonusType;
    }

    public int getDamageDealt() {
        return damageDealt;
    }

    public void setDamageDealt(final int damageDealt) {
        this.damageDealt = damageDealt;
    }

    public String getMapName() {
        return mapName;
    }

    public void setMapName(final String mapName) {
        this.mapName = mapName;
    }

    public String getVersion() {
        return version;
    }

    public void setVersion(final String version) {
        this.version = version;
    }

    public OffsetDateTime getBattleTime() {
        return battleTime;
    }

    public void setBattleTime(final OffsetDateTime battleTime) {
        this.battleTime = battleTime;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public String getReplayHash() {
        return replayHash;
    }

    public void setReplayHash(final String replayHash) {
        this.replayHash = replayHash;
    }

    public String getReplayFileName() {
        return replayFileName;
    }

    public void setReplayFileName(final String replayFileName) {
        this.replayFileName = replayFileName;
    }

    public Long getReplaySize() {
        return replaySize;
    }

    public void setReplaySize(final Long replaySize) {
        this.replaySize = replaySize;
    }

    public String getReplayUploadedBy() {
        return replayUploadedBy;
    }

    public void setReplayUploadedBy(final String replayUploadedBy) {
        this.replayUploadedBy = replayUploadedBy;
    }
}