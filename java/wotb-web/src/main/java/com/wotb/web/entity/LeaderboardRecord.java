package com.wotb.web.entity;

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
 * 排行榜单场成绩。列结构与 Flyway V1__init_leaderboard.sql 逐列对齐
 * (ddl-auto=validate, 改任一列必须同步迁移)。
 */
@Entity
@Table(name = "leaderboard_record",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_leaderboard_record_arena_player",
                columnNames = {"arena_id", "account_id"}))
public class LeaderboardRecord {

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

    @Column(name = "damage_dealt", nullable = false)
    private int damageDealt;

    @Column(name = "map_name", length = 100)
    private String mapName;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public LeaderboardRecord() {
        // JPA / service 组装
    }

    public Long getId() {
        return id;
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

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }
}
