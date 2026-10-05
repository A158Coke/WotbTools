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
import java.util.Set;
import java.time.Instant;

@Entity
@Table(name = "tournament_day")
public class TournamentDay {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "event_id", nullable = false)
    public long eventId;
    @Column(name = "round_number", nullable = false)
    public int roundNumber;
    @Column(name = "day_number", nullable = false)
    public int dayNumber;
    @Column(name = "expected_group_count", nullable = true)
    public Integer expectedGroupCount;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "draft_groups", nullable = true, columnDefinition = "jsonb")
    public List<TournamentSnapshot.Group> draftGroups;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "published_groups", nullable = true, columnDefinition = "jsonb")
    public List<TournamentSnapshot.Group> publishedGroups;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "cleared_clans", nullable = false, columnDefinition = "jsonb")
    public Set<String> clearedClans;
    @Column(name = "correction", nullable = false)
    public boolean correction;
    @Column(name = "correction_reason", nullable = true, length = 500)
    public String correctionReason;
    @Column(name = "correction_started_at", nullable = true)
    public Instant correctionStartedAt;
    @Column(name = "version", nullable = false)
    public long version;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "publication_keys", nullable = false, columnDefinition = "jsonb")
    public Set<String> publicationKeys;
}
