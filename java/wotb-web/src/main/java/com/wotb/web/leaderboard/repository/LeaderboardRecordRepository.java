package com.wotb.web.leaderboard.repository;

import com.wotb.web.leaderboard.entity.LeaderboardRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * 排行榜记录仓库。随 JPA 自动配置生效。
 */
public interface LeaderboardRecordRepository extends JpaRepository<LeaderboardRecord, Long> {

    /** 去重查询: 同一场 + 同一玩家最多一条。 */
    Optional<LeaderboardRecord> findByArenaIdAndAccountId(String arenaId, long accountId);

    /**
     * 原子补写 replay metadata：仅当行存在且 {@code replay_hash IS NULL} 时更新，
     * 返回受影响行数（0 或 1）。并发 attach 的唯一 winner 判定依赖该 conditional UPDATE
     * （DB 行锁保证两个不同 hash 并发时只有一个成功，绝不 last-writer-wins）。
     */
    @Modifying
    @Transactional
    @Query("""
            update LeaderboardRecord r
            set r.replayHash = :hash,
                r.replayFileName = :fileName,
                r.replaySize = :size,
                r.replayUploadedBy = :uploadedBy
            where r.id = :id and r.replayHash is null
            """)
    int attachReplayMetadata(@Param("id") long id,
                             @Param("hash") String hash,
                             @Param("fileName") String fileName,
                             @Param("size") long size,
                             @Param("uploadedBy") String uploadedBy);

    /** 全局伤害榜 (降序)。 */
    Page<LeaderboardRecord> findAllByOrderByDamageDealtDesc(Pageable pageable);

    /** 指定车辆的伤害榜 (降序)。 */
    Page<LeaderboardRecord> findByTankIdOrderByDamageDealtDesc(long tankId, Pageable pageable);

    /** 指定玩家的伤害记录 (降序)。 */
    List<LeaderboardRecord> findByAccountIdOrderByDamageDealtDesc(long accountId, Pageable pageable);
}
