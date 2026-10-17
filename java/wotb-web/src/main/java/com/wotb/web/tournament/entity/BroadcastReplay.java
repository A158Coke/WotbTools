package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

@Entity
@Table(name = "tournament_broadcast_replay")
public class BroadcastReplay {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "node_id", nullable = false)
    public long nodeId;
    @Column(nullable = false, length = 200)
    public String title;
    @Column(nullable = false, length = 2048)
    public String url;
    @Column(name = "match_date", nullable = false)
    public LocalDate matchDate;
    @Column(name = "match_starts_at")
    public Instant matchStartsAt;
    @Column(name = "day_number", nullable = false)
    public int dayNumber;
    // Read boundary for pre-v2 labels; v2 transport never exposes this archive.
    @Column(name = "legacy_group_label", length = 100)
    public String legacyGroupLabel;
    @Column(name = "group_number")
    public Integer groupNumber;
    @Column(length = 16)
    public String bracket;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    public List<String> teams;
    @Column(nullable = false, length = 16)
    public String perspective;
    @Column(name = "cover_id", length = 36)
    public String coverId;
    @Column(name = "created_at", nullable = false)
    public Instant createdAt;
}
