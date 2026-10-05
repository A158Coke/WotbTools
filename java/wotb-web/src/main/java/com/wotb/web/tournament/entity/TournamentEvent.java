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
@Table(name = "tournament_event")
public class TournamentEvent {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "year", nullable = false)
    public int year;
    @Column(name = "region", nullable = false, length = 16)
    public String region;
    @Column(name = "season", nullable = false, length = 16)
    public String season;
    @Column(name = "round_count", nullable = false)
    public int roundCount;
    @Column(name = "days_per_round", nullable = false)
    public int daysPerRound;
    @Column(name = "config_locked", nullable = false)
    public boolean configLocked;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "day_labels", nullable = false, columnDefinition = "jsonb")
    public List<String> dayLabels;
    @Column(name = "version", nullable = false)
    public long version;
}
