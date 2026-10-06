package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "tournament_clan")
public class TournamentClan {
    @Column(name = "historical_published", nullable = false)
    public boolean historicalPublished;
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "event_id", nullable = false)
    public long eventId;
    @Column(name = "clan_tag", nullable = false, length = 32)
    public String clanTag;
}
