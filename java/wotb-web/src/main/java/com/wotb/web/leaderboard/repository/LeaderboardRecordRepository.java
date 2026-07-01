package com.wotb.web.leaderboard.repository;

import com.wotb.web.leaderboard.entity.LeaderboardRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 排行榜记录仓库。随 JPA 自动配置生效。
 */
public interface LeaderboardRecordRepository extends JpaRepository<LeaderboardRecord, Long> {

    /** 去重查询: 同一场 + 同一玩家最多一条。 */
    Optional<LeaderboardRecord> findByArenaIdAndAccountId(String arenaId, long accountId);

    /** 全局伤害榜 (降序)。 */
    Page<LeaderboardRecord> findAllByOrderByDamageDealtDesc(Pageable pageable);

    /** 指定车辆的伤害榜 (降序)。 */
    Page<LeaderboardRecord> findByTankIdOrderByDamageDealtDesc(long tankId, Pageable pageable);

    /** 指定玩家的伤害记录 (降序)。 */
    List<LeaderboardRecord> findByAccountIdOrderByDamageDealtDesc(long accountId, Pageable pageable);
}
