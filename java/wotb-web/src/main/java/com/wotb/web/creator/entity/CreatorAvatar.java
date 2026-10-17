package com.wotb.web.creator.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "creator_avatar")
public class CreatorAvatar {
    @Id @Column(length = 36)
    public String id;
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
    @Column(name = "last_cleanup_attempt_at")
    public Instant lastCleanupAttemptAt;
}
