package com.wotb.web.creator.entity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;

@Entity
@Table(name = "creator")
public class Creator {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(nullable = false)
    public long version;
    @Column(nullable = false, length = 100)
    public String name;
    @Column(length = 2000)
    public String description;
    @Column(nullable = false, length = 8)
    public String type = "UP";
    @Column(name = "bilibili_uid", nullable = false, length = 20)
    public String externalId;
    @Column(name = "level_id")
    public Long levelId;
    @Column(name = "avatar_id", length = 36, unique = true)
    public String avatarId;
    @Column(nullable = false)
    public int stars = 3;
    @Column(name = "created_at", nullable = false)
    public Instant createdAt;
    @ElementCollection
    @CollectionTable(name = "creator_category_link", joinColumns = @JoinColumn(name = "creator_id"))
    @Column(name = "category_id", nullable = false)
    public Set<Long> categoryIds = new LinkedHashSet<>();
}
