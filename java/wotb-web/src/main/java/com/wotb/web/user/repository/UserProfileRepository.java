package com.wotb.web.user.repository;

import com.wotb.web.user.entity.UserProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/** 用户资料仓库。 */
public interface UserProfileRepository extends JpaRepository<UserProfile, Long> {

    Optional<UserProfile> findByKeycloakUserId(String keycloakUserId);

    boolean existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
            String wotbServer, Long wotbAccountId, String keycloakUserId);
}
