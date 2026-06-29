package com.wotb.web.boost.repository;

import com.wotb.web.boost.entity.BoostRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/** 陪练需求仓库。 */
public interface BoostRequestRepository extends JpaRepository<BoostRequest, Long> {

    List<BoostRequest> findByRequesterUserIdOrderByCreatedAtDesc(String requesterUserId);

    Optional<BoostRequest> findByIdAndRequesterUserId(Long id, String requesterUserId);

    Page<BoostRequest> findByStatus(String status, Pageable pageable);
}
