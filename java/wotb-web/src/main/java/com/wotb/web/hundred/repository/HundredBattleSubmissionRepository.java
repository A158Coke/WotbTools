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

public interface HundredBattleSubmissionRepository extends JpaRepository<HundredBattleSubmission, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from HundredBattleSubmission s where s.id = :id")
    Optional<HundredBattleSubmission> findByIdForUpdate(@Param("id") long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select s from HundredBattleSubmission s
            where s.wotbServer = :wotbServer and s.wotbAccountId = :wotbAccountId
              and s.vehicleId = :vehicleId and s.status = 'CURRENT'
            """)
    Optional<HundredBattleSubmission> findCurrentForUpdate(
            @Param("wotbServer") String wotbServer,
            @Param("wotbAccountId") long wotbAccountId,
            @Param("vehicleId") long vehicleId);

    Optional<HundredBattleSubmission> findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
            String wotbServer, long wotbAccountId, long vehicleId, String status);

    boolean existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
            String wotbServer, long wotbAccountId, long vehicleId, String status);

    Page<HundredBattleSubmission> findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
            long vehicleId, String status, Pageable pageable);

    List<HundredBattleSubmission> findTop10ByStatusAndApprovedAverageDamageIsNotNullOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
            String status);

    @Query("""
            select distinct s.vehicleId from HundredBattleSubmission s
            where s.status = 'CURRENT' and s.approvedAverageDamage is not null
            """)
    List<Long> findDistinctCurrentVehicleIds();

    @Query("""
            select s from HundredBattleSubmission s
            where s.status = 'CURRENT' and s.approvedAverageDamage is not null
              and s.vehicleId in :vehicleIds
            order by s.approvedAverageDamage desc, s.approvedAt asc, s.id asc
            """)
    List<HundredBattleSubmission> findTopCurrentByVehicleIds(
            @Param("vehicleIds") Collection<Long> vehicleIds, Pageable pageable);

    @Query("""
            select s.approvedAverageDamage, count(s) from HundredBattleSubmission s
            where s.vehicleId = :vehicleId and s.status = 'CURRENT' and s.approvedAverageDamage is not null
            group by s.approvedAverageDamage
            """)
    List<Object[]> countCurrentGroupedByDamage(@Param("vehicleId") long vehicleId);

    @Query("""
            select s.approvedAverageDamage, count(s) from HundredBattleSubmission s
            where s.status = 'CURRENT' and s.approvedAverageDamage is not null
            group by s.approvedAverageDamage
            """)
    List<Object[]> countAllCurrentGroupedByDamage();

    @Query("""
            select s.approvedAverageDamage, count(s) from HundredBattleSubmission s
            where s.status = 'CURRENT' and s.approvedAverageDamage is not null
              and s.vehicleId in :vehicleIds
            group by s.approvedAverageDamage
            """)
    List<Object[]> countCurrentGroupedByDamageForVehicles(
            @Param("vehicleIds") Collection<Long> vehicleIds);

    @Query("select distinct s.vehicleId from HundredBattleSubmission s")
    List<Long> findDistinctVehicleIds();

    @Query("""
            select s from HundredBattleSubmission s
            where (:status is null or s.status = :status)
            order by s.submittedAt desc
            """)
    Page<HundredBattleSubmission> searchAdmin(@Param("status") String status, Pageable pageable);

    @Query("""
            select s from HundredBattleSubmission s
            where (:status is null or s.status = :status)
              and s.vehicleId in :vehicleIds
            order by s.submittedAt desc
            """)
    Page<HundredBattleSubmission> searchAdminByVehicleIds(
            @Param("status") String status,
            @Param("vehicleIds") Collection<Long> vehicleIds,
            Pageable pageable);

    List<HundredBattleSubmission> findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
            String wotbServer, long wotbAccountId, Collection<String> statuses);
}
