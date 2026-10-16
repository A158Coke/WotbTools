package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.List;

/** The permanent singleton row is also the lock when the default is disabled. */
@Entity
@Table(name = "tournament_default_rules")
public class TournamentDefaultRules {
    @Id public Long id = 1L;
    @Column(nullable = false) public long version;
    @Column(nullable = false) public boolean active;
    @Column(name = "source_event_id") public Long sourceEventId;
    @Column(name = "source_label", nullable = false, length = 100) public String sourceLabel = "";
    @Column(name = "updated_at") public Instant updatedAt;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    public List<TournamentSnapshot.RuleRound> rounds = List.of();
}
