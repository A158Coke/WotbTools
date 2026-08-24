package com.wotb.web.mark3.repository;

import com.wotb.web.mark3.entity.Mark3Submission;
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

/** 三环 submission 仓库；终态迁移采用行锁，active 唯一性由 V21 partial unique index 保证。 */
public interface Mark3SubmissionRepository extends JpaRepository<Mark3Submission, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Mark3Submission s where s.id = :id")
    Optional<Mark3Submission> findByIdForUpdate(@Param("id") long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select s from Mark3Submission s
            where s.userKeycloakId = :userId and s.vehicleId = :vehicleId and s.status = 'CURRENT'
            """)
    Optional<Mark3Submission> findCurrentForUpdate(
            @Param("userId") String userId, @Param("vehicleId") long vehicleId);

    boolean existsByUserKeycloakIdAndVehicleIdAndStatus(
            String userKeycloakId, long vehicleId, String status);

    Page<Mark3Submission> findByVehicleIdAndStatusOrderByApprovedBattleCountAscApprovedAtAscIdAsc(
            long vehicleId, String status, Pageable pageable);

    List<Mark3Submission> findTop10ByStatusAndApprovedBattleCountIsNotNullOrderByApprovedBattleCountAscApprovedAtAscIdAsc(
            String status);

    @Query("""
            select distinct s.vehicleId from Mark3Submission s
            where s.status = 'CURRENT' and s.approvedBattleCount is not null
            """)
    List<Long> findDistinctCurrentVehicleIds();

    @Query("""
            select s from Mark3Submission s
            where s.status = 'CURRENT' and s.approvedBattleCount is not null
              and s.vehicleId in :vehicleIds
            order by s.approvedBattleCount asc, s.approvedAt asc, s.id asc
            """)
    List<Mark3Submission> findTopCurrentByVehicleIds(
            @Param("vehicleIds") Collection<Long> vehicleIds, Pageable pageable);

    @Query("""
            select s.approvedBattleCount, count(s) from Mark3Submission s
            where s.vehicleId = :vehicleId and s.status = 'CURRENT' and s.approvedBattleCount is not null
            group by s.approvedBattleCount
            """)
    List<Object[]> countCurrentGroupedByBattleCount(@Param("vehicleId") long vehicleId);

    @Query("""
            select s.approvedBattleCount, count(s) from Mark3Submission s
            where s.status = 'CURRENT' and s.approvedBattleCount is not null
            group by s.approvedBattleCount
            """)
    List<Object[]> countAllCurrentGroupedByBattleCount();

    @Query("""
            select s.approvedBattleCount, count(s) from Mark3Submission s
            where s.status = 'CURRENT' and s.approvedBattleCount is not null
              and s.vehicleId in :vehicleIds
            group by s.approvedBattleCount
            """)
    List<Object[]> countCurrentGroupedByBattleCountForVehicles(
            @Param("vehicleIds") Collection<Long> vehicleIds);

    @Query("select distinct s.vehicleId from Mark3Submission s")
    List<Long> findDistinctVehicleIds();

    @Query("""
            select s from Mark3Submission s
            where (:status is null or s.status = :status)
            order by s.submittedAt desc
            """)
    Page<Mark3Submission> searchAdmin(@Param("status") String status, Pageable pageable);

    @Query("""
            select s from Mark3Submission s
            where (:status is null or s.status = :status)
              and s.vehicleId in :vehicleIds
            order by s.submittedAt desc
            """)
    Page<Mark3Submission> searchAdminByVehicleIds(
            @Param("status") String status,
            @Param("vehicleIds") Collection<Long> vehicleIds,
            Pageable pageable);

    List<Mark3Submission> findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc(
            String userKeycloakId, Collection<String> statuses);
}
