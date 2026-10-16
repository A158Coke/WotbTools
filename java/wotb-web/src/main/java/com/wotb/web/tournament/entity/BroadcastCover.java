package com.wotb.web.tournament.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.DynamicUpdate;
import java.time.Instant;

@Entity
@Table(name = "tournament_broadcast_cover")
// PUT/cleanup lock only this row. Updating status must not reacquire a parent-season FK lock.
@DynamicUpdate
public class BroadcastCover {
    @Id @Column(length = 36)
    public String id;
    @Column(name = "season_id")
    public Long seasonId;
    @Column(name = "object_key", nullable = false, length = 512, unique = true)
    public String objectKey;
    @Column(nullable = false, length = 16)
    public String status;
    @Column(name = "content_type", nullable = false, length = 32)
    public String contentType;
    @Column(nullable = false)
    public long size;
    @Column(nullable = false, length = 64)
    public String hash;
    @Column(name = "created_at", nullable = false)
    public Instant createdAt;
    @Column(name = "unreferenced_at")
    public Instant unreferencedAt;
}
