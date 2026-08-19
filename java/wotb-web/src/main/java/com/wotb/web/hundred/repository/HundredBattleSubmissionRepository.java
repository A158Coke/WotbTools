package com.wotb.web.hundred.repository;

import com.wotb.web.hundred.entity.HundredBattleSubmission;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * 名人堂「百场」submission 仓库。
 * user + vehicle 的 PENDING / CURRENT 唯一性由 V18 的 partial unique index 在 DB 层强制；
 * 终态迁移（APPROVE/REJECT/CANCEL/DELETE）通过 {@link #findByIdForUpdate} 行锁 + 状态复核串行化。
 */
public interface HundredBattleSubmissionRepository extends JpaRepository<HundredBattleSubmission, Long> {

    /**
     * 行锁读取（终态迁移前调用，与并发 APPROVE/REJECT/CANCEL 串行化）。
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from HundredBattleSubmission s where s.id = :id")
    Optional<HundredBattleSubmission> findByIdForUpdate(@Param("id") long id);

    /**
     * 行锁读取当前 CURRENT（approve 时重新读取并比较 approvedAverageDamage）。
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select s from HundredBattleSubmission s
            where s.userKeycloakId = :userId and s.vehicleId = :vehicleId and s.status = 'CURRENT'
            """)
    Optional<HundredBattleSubmission> findCurrentForUpdate(
            @Param("userId") String userId, @Param("vehicleId") long vehicleId);

    Optional<HundredBattleSubmission> findByUserKeycloakIdAndVehicleIdAndStatus(
            String userKeycloakId, long vehicleId, String status);

    boolean existsByUserKeycloakIdAndVehicleIdAndStatus(
            String userKeycloakId, long vehicleId, String status);

    /**
     * 公开排行榜：vehicle 独立排行，competition ranking 的稳定排序。
     */
    Page<HundredBattleSubmission> findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
            long vehicleId, String status, Pageable pageable);

    /**
     * 竞争排名：全部 CURRENT 按 approved_average_damage 分组计数（服务端前缀和计算 rank）。
     */
    @Query("""
            select s.approvedAverageDamage, count(s) from HundredBattleSubmission s
            where s.vehicleId = :vehicleId and s.status = 'CURRENT' and s.approvedAverageDamage is not null
            group by s.approvedAverageDamage
            """)
    List<Object[]> countCurrentGroupedByDamage(@Param("vehicleId") long vehicleId);

    /**
     * 竞争排名辅助：严格高于指定伤害的 CURRENT 数量（rank = 1 + count）。
     */
    @Query("""
            select count(s) from HundredBattleSubmission s
            where s.vehicleId = :vehicleId and s.status = 'CURRENT' and s.approvedAverageDamage > :damage
            """)
    long countHigherDamage(@Param("vehicleId") long vehicleId, @Param("damage") int damage);

    /**
     * 管理后台列表：按状态过滤（null = 全部），submitted_at 倒序。
     */
    @Query("""
            select s from HundredBattleSubmission s
            where (:status is null or s.status = :status)
            order by s.submittedAt desc
            """)
    Page<HundredBattleSubmission> searchAdmin(@Param("status") String status, Pageable pageable);

    /**
     * 个人中心：指定状态集合（CURRENT / PENDING / REJECTED 等）。
     */
    List<HundredBattleSubmission> findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc(
            String userKeycloakId, Collection<String> statuses);
}