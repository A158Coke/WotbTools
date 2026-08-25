package com.wotb.web.mark3.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/** 三环 PENDING 审核的原始回放 evidence metadata；物理文件由 mark3 独立命名空间保存。 */
@Entity
@Table(name = "mark3_replay_evidence")
public class Mark3ReplayEvidence {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "submission_id", nullable = false)
    private long submissionId;

    @Column(name = "slot", nullable = false)
    private int slot;

    @Column(name = "original_filename", nullable = false, length = 255)
    private String originalFilename;

    @Column(name = "sha256", nullable = false, length = 64)
    private String sha256;

    @Column(name = "file_size", nullable = false)
    private long fileSize;

    @Column(name = "arena_id", nullable = false, length = 64)
    private String arenaId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public Mark3ReplayEvidence() {
        // JPA / service assembly
    }

    public Long getId() { return id; }
    public void setId(final Long value) { this.id = value; }
    public long getSubmissionId() { return submissionId; }
    public void setSubmissionId(final long value) { this.submissionId = value; }
    public int getSlot() { return slot; }
    public void setSlot(final int value) { this.slot = value; }
    public String getOriginalFilename() { return originalFilename; }
    public void setOriginalFilename(final String value) { this.originalFilename = value; }
    public String getSha256() { return sha256; }
    public void setSha256(final String value) { this.sha256 = value; }
    public long getFileSize() { return fileSize; }
    public void setFileSize(final long value) { this.fileSize = value; }
    public String getArenaId() { return arenaId; }
    public void setArenaId(final String value) { this.arenaId = value; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(final OffsetDateTime value) { this.createdAt = value; }
}
