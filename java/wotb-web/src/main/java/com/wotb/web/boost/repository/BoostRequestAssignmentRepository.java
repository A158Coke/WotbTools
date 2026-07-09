package com.wotb.web.boost.repository;

import com.wotb.web.boost.entity.BoostRequestAssignment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/** 需求-打手分配仓库。 */
public interface BoostRequestAssignmentRepository extends JpaRepository<BoostRequestAssignment, Long> {

    Optional<BoostRequestAssignment> findByRequestIdAndUnassignedAtIsNull(Long requestId);

    Optional<BoostRequestAssignment> findByIdAndBoosterIdAndUnassignedAtIsNull(Long id, Long boosterId);

    List<BoostRequestAssignment> findByRequestIdOrderByAssignedAtDesc(Long requestId);

    List<BoostRequestAssignment> findByBoosterIdAndUnassignedAtIsNull(Long boosterId);

    List<BoostRequestAssignment> findByBoosterIdOrderByAssignedAtDesc(Long boosterId);

    long countByBoosterIdAndUnassignedAtIsNull(Long boosterId);
}
