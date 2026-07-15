package com.wotb.web.boost.repository;

import com.wotb.web.boost.entity.BoostRequest;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

/** 陪练需求仓库。 */
public interface BoostRequestRepository extends JpaRepository<BoostRequest, Long> {

    List<BoostRequest> findByRequesterUserIdOrderByCreatedAtDesc(final String requesterUserId);

    Optional<BoostRequest> findByIdAndRequesterUserId(final Long id, final String requesterUserId);

    Page<BoostRequest> findByStatus(final String status, final Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select request from BoostRequest request where request.id = :id")
    Optional<BoostRequest> findByIdForUpdate(@Param("id") final Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select request
            from BoostRequest request
            where request.id = :id
              and request.requesterUserId = :requesterUserId
            """)
    Optional<BoostRequest> findByIdAndRequesterUserIdForUpdate(
            @Param("id") final Long id,
            @Param("requesterUserId") final String requesterUserId);

    @Query("""
            select request.id
            from BoostRequest request
            where request.status = :status
              and request.autoConfirmAt is not null
              and request.autoConfirmAt <= :now
            order by request.autoConfirmAt, request.id
            """)
    List<Long> findDueAutoConfirmIds(@Param("status") final String status,
                                     @Param("now") final OffsetDateTime now,
                                     final Pageable pageable);
}
