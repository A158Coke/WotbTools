package com.wotb.web.boost.repository;

import com.wotb.web.boost.dto.BoosterApplicationSummaryDto;
import com.wotb.web.boost.entity.BoosterApplication;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface BoosterApplicationRepository extends JpaRepository<BoosterApplication, Long> {

    @Query("""
            select new com.wotb.web.boost.dto.BoosterApplicationSummaryDto(
                application.id,
                application.wotbAccountId,
                application.wotbNickname,
                application.requestedLevel,
                application.qq,
                application.availabilityTier,
                application.status,
                application.adminNote,
                application.approvedBoosterId,
                application.createdAt
            )
            from BoosterApplication application
            where application.keycloakUserId = :keycloakUserId
            order by application.createdAt desc
            """)
    List<BoosterApplicationSummaryDto> findSummariesByKeycloakUserId(
            @Param("keycloakUserId") final String keycloakUserId);

    boolean existsByKeycloakUserIdAndStatusIn(final String keycloakUserId, final Collection<String> statuses);

    @Query(value = """
            select new com.wotb.web.boost.dto.BoosterApplicationSummaryDto(
                application.id,
                application.wotbAccountId,
                application.wotbNickname,
                application.requestedLevel,
                application.qq,
                application.availabilityTier,
                application.status,
                application.adminNote,
                application.approvedBoosterId,
                application.createdAt
            )
            from BoosterApplication application
            order by application.createdAt desc
            """,
            countQuery = "select count(application) from BoosterApplication application")
    Page<BoosterApplicationSummaryDto> findAllSummaries(final Pageable pageable);

    @Query(value = """
            select new com.wotb.web.boost.dto.BoosterApplicationSummaryDto(
                application.id,
                application.wotbAccountId,
                application.wotbNickname,
                application.requestedLevel,
                application.qq,
                application.availabilityTier,
                application.status,
                application.adminNote,
                application.approvedBoosterId,
                application.createdAt
            )
            from BoosterApplication application
            where application.status = :status
            order by application.createdAt desc
            """,
            countQuery = """
                    select count(application)
                    from BoosterApplication application
                    where application.status = :status
                    """)
    Page<BoosterApplicationSummaryDto> findSummariesByStatus(
            @Param("status") final String status,
            final Pageable pageable);

    List<BoosterApplication> findByApprovedBoosterId(final Long approvedBoosterId);
}
