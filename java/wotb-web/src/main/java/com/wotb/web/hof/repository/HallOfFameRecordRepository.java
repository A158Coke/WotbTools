package com.wotb.web.hof.repository;

import com.wotb.web.hof.entity.HallOfFameRecord;
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
 * 名人堂记录仓库。随 JPA 自动配置生效。
 */
public interface HallOfFameRecordRepository extends JpaRepository<HallOfFameRecord, Long> {

    /** 去重查询: 同一场 + 同一玩家最多一条。 */
    Optional<HallOfFameRecord> findByArenaIdAndAccountId(String arenaId, long accountId);

    /**
     * 原子补写 replay metadata：仅当行存在且 {@code replay_hash IS NULL} 时更新，
     * 返回受影响行数（0 或 1）。并发 attach 的唯一 winner 判定依赖该 conditional UPDATE
     * （DB 行锁保证两个不同 hash 并发时只有一个成功，绝不 last-writer-wins）。
     */
    @Modifying
    @Transactional
    @Query("""
            update HallOfFameRecord r
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

    /**
     * 统一公开查询（All / Random / Rating × 全部坦克 / 指定坦克 × 昵称模糊）。
     * deterministic ordering：damage DESC → battle type 优先 RATING > RANDOM → battleTime ASC
     * NULLS LAST → createdAt ASC → id ASC。null 参数视为不过滤。
     */
    @Query("""
            select r from HallOfFameRecord r
            where (:battleType is null or r.battleType = :battleType)
              and (:tankId is null or r.tankId = :tankId)
              and (:nickname is null or lower(r.nickname) like :nickname)
            order by r.damageDealt desc,
                     case r.battleType when 'RATING' then 0 else 1 end asc,
                     r.battleTime asc nulls last,
                     r.createdAt asc,
                     r.id asc
            """)
    Page<HallOfFameRecord> search(@Param("battleType") String battleType,
                                  @Param("tankId") Long tankId,
                                  @Param("nickname") String nicknamePattern,
                                  Pageable pageable);

    /** 管理后台搜索：nickname / accountId / uploadedBy / battleType / tankId / replayAvailable。 */
    @Query("""
            select r from HallOfFameRecord r
            where (:nickname is null or lower(r.nickname) like :nickname)
              and (:accountId is null or r.accountId = :accountId)
              and (:uploadedBy is null or r.replayUploadedBy = :uploadedBy)
              and (:battleType is null or r.battleType = :battleType)
              and (:tankId is null or r.tankId = :tankId)
              and (:replayAvailable is null
                   or (:replayAvailable = true and r.replayHash is not null)
                   or (:replayAvailable = false and r.replayHash is null))
            """)
    Page<HallOfFameRecord> adminSearch(@Param("nickname") String nickname,
                                       @Param("accountId") Long accountId,
                                       @Param("uploadedBy") String uploadedBy,
                                       @Param("battleType") String battleType,
                                       @Param("tankId") Long tankId,
                                       @Param("replayAvailable") Boolean replayAvailable,
                                       Pageable pageable);

    /** 管理筛选车辆：只返回当前名人堂实际存在的车辆，避免无结果选项。 */
    @Query("""
            select r.tankId as tankId, min(r.tankName) as tankName
            from HallOfFameRecord r
            group by r.tankId
            order by min(r.tankName), r.tankId
            """)
    List<HofAdminVehicleProjection> findAdminVehicleOptions();

    /** 引用计数：物理文件清理前确认是否仍有记录引用该 hash。 */
    long countByReplayHash(String replayHash);

    /** 指定玩家的伤害记录 (降序，个人中心 flat 列表)。 */
    List<HallOfFameRecord> findByAccountIdOrderByDamageDealtDesc(long accountId, Pageable pageable);
}
