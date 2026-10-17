package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "tournament_broadcast_category")
public class BroadcastCategory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "season_id", nullable = false)
    public long seasonId;
    @Column(nullable = false, length = 24)
    public String type;
}
