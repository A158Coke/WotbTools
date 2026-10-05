package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "tournament_evidence")
public class TournamentEvidence {
    @Id @Column(length = 36)
    public String id;
    @Column(name = "event_id", nullable = false)
    public long eventId;
    @Column(name = "round_number", nullable = false)
    public int roundNumber;
    @Column(name = "day_number", nullable = false)
    public int dayNumber;
    @Column(name = "image_hash", nullable = false, length = 64)
    public String imageHash;
    @Column(name = "content_type", nullable = false, length = 32)
    public String contentType;
    @Column(name = "created_at", nullable = false)
    public Instant createdAt;
}
