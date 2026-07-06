package com.wotb.web.boost.repository;

import com.wotb.web.boost.entity.BoosterProfile;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 打手档案仓库。 */
public interface BoosterProfileRepository extends JpaRepository<BoosterProfile, Long> {

    java.util.Optional<BoosterProfile> findByKeycloakUserId(String keycloakUserId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from BoosterProfile b where b.id = :id")
    java.util.Optional<BoosterProfile> findByIdForUpdate(@Param("id") Long id);

    Page<BoosterProfile> findByStatus(String status, Pageable pageable);

    Page<BoosterProfile> findByAvailable(Boolean available, Pageable pageable);

    Page<BoosterProfile> findByStatusAndAvailable(String status, Boolean available, Pageable pageable);
}
