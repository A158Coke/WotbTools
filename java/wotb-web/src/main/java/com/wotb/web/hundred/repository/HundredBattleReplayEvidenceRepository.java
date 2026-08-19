package com.wotb.web.hundred.repository;

import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 名人堂「百场」回放审核证据仓库。
 * 生命周期：submission 终态同事务删除；sha256 引用计数用于 commit 后物理文件清理。
 */
public interface HundredBattleReplayEvidenceRepository extends JpaRepository<HundredBattleReplayEvidence, Long> {

    /**
     * 管理后台 evidence 列表：按 slot 升序。
     */
    List<HundredBattleReplayEvidence> findBySubmissionIdOrderBySlotAsc(long submissionId);

    /**
     * 下载用：replayId 必须同时属于 submissionId（ownership 校验）。
     */
    Optional<HundredBattleReplayEvidence> findBySubmissionIdAndId(long submissionId, long id);

    /**
     * 终态清理：同事务删除该 submission 全部 evidence 行。
     */
    List<HundredBattleReplayEvidence> findBySubmissionId(long submissionId);

    /**
     * 物理文件清理引用计数：本表剩余引用数。
     */
    long countBySha256(String sha256);

    /**
     * 终态事务内删除 evidence 行（与状态迁移同事务，失败整体回滚）。
     */
    void deleteBySubmissionId(long submissionId);
}
