package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.List;

@Entity
@Table(name = "tournament_rule")
public class TournamentRule {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "event_id", nullable = false)
    public long eventId;
    @Column(name = "round_number", nullable = false)
    public int roundNumber;
    @Column(name = "rules_version", nullable = false)
    public long rulesVersion;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "days", nullable = false, columnDefinition = "jsonb")
    public List<TournamentSnapshot.RuleDay> days;
}
