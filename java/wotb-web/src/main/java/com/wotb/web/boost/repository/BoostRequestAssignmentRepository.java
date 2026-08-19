package com.wotb.web.boost.repository;

import com.wotb.web.boost.entity.BoostRequestAssignment;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/** 需求-打手分配仓库。 */
public interface BoostRequestAssignmentRepository extends JpaRepository<BoostRequestAssignment, Long> {

    Optional<BoostRequestAssignment> findByRequestIdAndUnassignedAtIsNull(final Long requestId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select assignment
            from BoostRequestAssignment assignment
            where assignment.requestId = :requestId
              and assignment.unassignedAt is null
            """)
    Optional<BoostRequestAssignment> findActiveByRequestIdForUpdate(
            @Param("requestId") final Long requestId);

    Optional<BoostRequestAssignment> findByIdAndBoosterIdAndUnassignedAtIsNull(final Long id, final Long boosterId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select assignment
            from BoostRequestAssignment assignment
            where assignment.id = :id
              and assignment.boosterId = :boosterId
              and assignment.unassignedAt is null
            """)
    Optional<BoostRequestAssignment> findActiveByIdAndBoosterIdForUpdate(
            @Param("id") final Long id,
            @Param("boosterId") final Long boosterId);

    List<BoostRequestAssignment> findByRequestIdOrderByAssignedAtDesc(final Long requestId);

    List<BoostRequestAssignment> findByBoosterIdAndUnassignedAtIsNull(final Long boosterId);

    List<BoostRequestAssignment> findByBoosterIdOrderByAssignedAtDesc(final Long boosterId);

    long countByBoosterIdAndUnassignedAtIsNull(final Long boosterId);

    boolean existsByBoosterId(final Long boosterId);
}
