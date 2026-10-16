package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "tournament_broadcast_node")
public class BroadcastNode {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "category_id", nullable = false)
    public long categoryId;
    @Column(name = "root_key", nullable = false)
    public int rootKey;
    @Column(name = "round_number")
    public Integer roundNumber;
    @Column(length = 16)
    public String format;
}
