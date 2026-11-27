package com.wotb.web.user.repository;

import com.wotb.web.user.entity.UserProfile;
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

public interface UserProfileRepository extends JpaRepository<UserProfile, Long> {

    Optional<UserProfile> findByKeycloakUserId(String keycloakUserId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserProfile u where u.keycloakUserId = :keycloakUserId")
    Optional<UserProfile> findByKeycloakUserIdForUpdate(
            @Param("keycloakUserId") String keycloakUserId);

    boolean existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
            String wotbServer, Long wotbAccountId, String keycloakUserId);

    List<UserProfile> findByKeycloakUserIdIn(Collection<String> keycloakUserIds);

    @Query("SELECT u FROM UserProfile u WHERE "
            + "LOWER(u.keycloakUserId) LIKE LOWER(CONCAT('%', :query, '%')) "
            + "OR LOWER(u.displayName) LIKE LOWER(CONCAT('%', :query, '%')) "
            + "OR LOWER(u.wotbNickname) LIKE LOWER(CONCAT('%', :query, '%')) "
            + "OR CAST(u.wotbAccountId AS text) LIKE CONCAT('%', :query, '%')")
    Page<UserProfile> searchAdminUsers(@Param("query") String query, Pageable pageable);
}
