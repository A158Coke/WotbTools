package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;

/** Independent broadcast catalogue; deliberately unrelated to points events. */
@Entity
@Table(name = "tournament_broadcast_season")
public class BroadcastSeason {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(nullable = false, length = 16)
    public String server;
    @Column(nullable = false)
    public int year;
    @Column(name = "name_zh", nullable = false, length = 100)
    public String nameZh;
    @Column(name = "name_en", nullable = false, length = 100)
    public String nameEn;
    @Column(name = "name_ru", length = 100)
    public String nameRu;
    @Column(name = "start_date")
    public LocalDate startDate;
    @Column(name = "created_at", nullable = false)
    public Instant createdAt;
    @Column(nullable = false)
    public long version;
}
