package com.wotb.web.boost.repository;

import com.wotb.web.boost.entity.BoosterApplication;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface BoosterApplicationRepository extends JpaRepository<BoosterApplication, Long> {

    List<BoosterApplication> findByKeycloakUserIdOrderByCreatedAtDesc(final String keycloakUserId);

    boolean existsByKeycloakUserIdAndStatusIn(final String keycloakUserId, final Collection<String> statuses);

    Page<BoosterApplication> findAllByOrderByCreatedAtDesc(final Pageable pageable);

    Page<BoosterApplication> findByStatusOrderByCreatedAtDesc(final String status, final Pageable pageable);

    boolean existsByApprovedBoosterId(final Long approvedBoosterId);
}
