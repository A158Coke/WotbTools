package com.wotb.web.creator.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(name = "creator_favorite", uniqueConstraints = @UniqueConstraint(columnNames = {"creator_id", "keycloak_subject"}))
public class CreatorFavorite {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(name = "creator_id", nullable = false)
    public long creatorId;
    @Column(name = "keycloak_subject", nullable = false, length = 64)
    public String subject;
    @Column(nullable = false)
    public boolean active;
}
