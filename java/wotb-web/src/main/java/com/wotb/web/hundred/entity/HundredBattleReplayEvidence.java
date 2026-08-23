package com.wotb.web.hundred.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * 名人堂「百场」回放审核证据：PENDING submission 的原始 5 个 {@code .wotbreplay} 元数据。
 *
 * <p>物理文件由 {@code HallOfFameReplayStorage} 内容寻址存储（{baseDir}/{sha256}.wotbreplay），
 * 本实体只保存 metadata。originalFilename 仅用于展示 / Content-Disposition，绝不参与文件路径；
 * sha256 即存储 key（服务端生成）。submission + slot 唯一（一个 submission 恰好 5 行由
 * {@code HundredBattleSubmissionService.createSubmission} 单事务保证）。</p>
 *
 * <p>生命周期：submission 终态（APPROVE/REJECT/CANCEL/DELETE）同事务删除本表行，commit 后
 * best-effort 清理物理文件（跨表引用计数：hall_of_fame_record + 本表均无引用才删；失败仅 WARN
 * 保留 orphan）。旧 PENDING（本功能上线前创建）无本表行 → 审核 UI 明确提示原始回放不可用。</p>
 *
 * <p>列结构与 Flyway V19__create_hundred_battle_replay_evidence.sql 逐列对齐（ddl-auto=validate）。
 * 不使用 @ManyToOne：本实体以 submission_id 标量 + 显式查询与 submission 保持独立生命周期，
 * 避免 JPA 关联带来的意外级联行为。</p>
 */
@Entity
@Table(name = "hundred_battle_replay_evidence")
public class HundredBattleReplayEvidence {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 所属百场 submission（FK → hundred_battle_submission.id，ON DELETE RESTRICT）。 */
    @Column(name = "submission_id", nullable = false)
    private long submissionId;

    /** 回放序号 1..5（submission + slot 唯一）。 */
    @Column(name = "slot", nullable = false)
    private int slot;

    /** 用户原始文件名（仅展示 / Content-Disposition；不参与路径）。 */
    @Column(name = "original_filename", nullable = false, length = 255)
    private String originalFilename;

    /** SHA-256 内容寻址 key（= 物理文件名 {sha256}.wotbreplay）。 */
    @Column(name = "sha256", nullable = false, length = 64)
    private String sha256;

    /** 原始回放字节数。 */
    @Column(name = "file_size", nullable = false)
    private long fileSize;

    /** 该回放对应的战斗 arenaId（机器校验结果，审核 debug 价值）。 */
    @Column(name = "arena_id", nullable = false, length = 64)
    private String arenaId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public HundredBattleReplayEvidence() {
        // JPA / service 组装
    }

    public Long getId() { return id; }
    public void setId(final Long id) { this.id = id; }
    public long getSubmissionId() { return submissionId; }
    public void setSubmissionId(final long submissionId) { this.submissionId = submissionId; }
    public int getSlot() { return slot; }
    public void setSlot(final int slot) { this.slot = slot; }
    public String getOriginalFilename() { return originalFilename; }
    public void setOriginalFilename(final String originalFilename) { this.originalFilename = originalFilename; }
    public String getSha256() { return sha256; }
    public void setSha256(final String sha256) { this.sha256 = sha256; }
    public long getFileSize() { return fileSize; }
    public void setFileSize(final long fileSize) { this.fileSize = fileSize; }
    public String getArenaId() { return arenaId; }
    public void setArenaId(final String arenaId) { this.arenaId = arenaId; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(final OffsetDateTime createdAt) { this.createdAt = createdAt; }
}
