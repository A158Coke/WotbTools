package com.wotb.web.news.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "news_archive")
public class NewsArchive {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) public Long id;
    @Column(nullable = false, length = 16) public String source;
    @Column(nullable = false, length = 80) public String version;
    @Column(nullable = false, length = 300) public String title;
    @Column(nullable = false, length = 16) public String status;
    @Column(nullable = false) public long revision;
    @Column(name = "created_at", nullable = false) public Instant createdAt;
    @Column(name = "reviewed_by", nullable = false, length = 255) public String reviewedBy;
    @Column(name = "published_at") public Instant publishedAt;
    @Column(name = "attempt_token", length = 36) public String attemptToken;
    @Column(name = "lease_until") public Instant leaseUntil;
    @Column(name = "error_code", length = 80) public String errorCode;
    @ManyToMany
    @JoinTable(name = "news_archive_category", joinColumns = @JoinColumn(name = "archive_id"),
            inverseJoinColumns = @JoinColumn(name = "category_id"))
    @OrderBy("id ASC")
    public List<NewsCategory> categories = new ArrayList<>();
}
