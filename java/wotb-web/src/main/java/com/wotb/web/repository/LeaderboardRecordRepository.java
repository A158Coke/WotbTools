package com.wotb.web.repository;

import com.wotb.web.entity.LeaderboardRecord;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 排行榜记录仓库。仅在 postgres profile 下随 JPA 自动配置生效;
 * 默认/离线 profile 排除了 JPA, 此接口不会被实例化。
 */
public interface LeaderboardRecordRepository extends JpaRepository<LeaderboardRecord, Long> {

    /** 去重查询: 同一场 + 同一玩家最多一条。 */
    Optional<LeaderboardRecord> findByArenaIdAndAccountId(String arenaId, long accountId);

    /** 全局伤害榜 (降序)。 */
    List<LeaderboardRecord> findAllByOrderByDamageDealtDesc(Pageable pageable);

    /** 指定车辆的伤害榜 (降序)。 */
    List<LeaderboardRecord> findByTankIdOrderByDamageDealtDesc(long tankId, Pageable pageable);
}
