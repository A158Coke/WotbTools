package com.wotb.web.news.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Durable object reservation survives archive deletion and interrupted uploads. */
@Entity
@Table(name = "news_image")
public class NewsImage {
    @Id public String id;
    @Column(nullable = false) public long archiveId;
    @Column(nullable = false) public String sourceImageId;
    @Column(nullable = false, columnDefinition = "text") public String sourceUrl;
    @Column(nullable = false) public String objectKey;
    @Column(nullable = false) public String status;
    public String contentType;
    public String imageHash;
    public Long sizeBytes;
    @Column(nullable = false) public Instant createdAt;
    public Instant unreferencedAt;
}
