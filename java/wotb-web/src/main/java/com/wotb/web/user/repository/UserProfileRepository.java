package com.wotb.web.user.repository;

import com.wotb.web.user.entity.UserProfile;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/** 用户资料仓库。 */
public interface UserProfileRepository extends JpaRepository<UserProfile, Long> {

    Optional<UserProfile> findByKeycloakUserId(String keycloakUserId);

    boolean existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
            String wotbServer, Long wotbAccountId, String keycloakUserId);

    /** 管理员搜索用户：按 keycloakUserId / displayName / wotbNickname / wotbAccountId 模糊匹配。 */
    @Query("SELECT u FROM UserProfile u WHERE "
            + "LOWER(u.keycloakUserId) LIKE LOWER(CONCAT('%', :query, '%')) "
            + "OR LOWER(u.displayName) LIKE LOWER(CONCAT('%', :query, '%')) "
            + "OR LOWER(u.wotbNickname) LIKE LOWER(CONCAT('%', :query, '%')) "
            + "OR CAST(u.wotbAccountId AS text) LIKE CONCAT('%', :query, '%')")
    List<UserProfile> searchAdminUsers(@Param("query") String query, Pageable pageable);
}
