package com.wotb.web.boost.repository;

import com.wotb.web.boost.entity.BoosterProfile;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** 打手档案仓库。 */
public interface BoosterProfileRepository extends JpaRepository<BoosterProfile, Long> {

    java.util.Optional<BoosterProfile> findByKeycloakUserId(String keycloakUserId);

    Page<BoosterProfile> findByStatus(String status, Pageable pageable);

    Page<BoosterProfile> findByAvailable(Boolean available, Pageable pageable);

    Page<BoosterProfile> findByStatusAndAvailable(String status, Boolean available, Pageable pageable);
}
