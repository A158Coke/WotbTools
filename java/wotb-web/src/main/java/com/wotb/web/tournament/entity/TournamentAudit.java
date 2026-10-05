package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.Map;
import java.time.Instant;

@Entity
@Table(name = "tournament_audit")
public class TournamentAudit {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "event_id", nullable = false)
    public long eventId;
    @Column(name = "round_number", nullable = true)
    public Integer roundNumber;
    @Column(name = "day_number", nullable = true)
    public Integer dayNumber;
    @Column(name = "action", nullable = false, length = 32)
    public String action;
    @Column(name = "actor", nullable = false, length = 64)
    public String actor;
    @Column(name = "reason", nullable = true, length = 500)
    public String reason;
    @Column(name = "created_at", nullable = false)
    public Instant createdAt;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_state", nullable = false, columnDefinition = "jsonb")
    public Map<String, Object> beforeState;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_state", nullable = false, columnDefinition = "jsonb")
    public Map<String, Object> afterState;
}
