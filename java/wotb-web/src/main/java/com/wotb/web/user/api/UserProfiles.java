package com.wotb.web.user.api;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** 用户模块供其它业务域使用的有限契约，不暴露 HTTP DTO 或持久化实体。 */
public interface UserProfiles {

    Optional<UserProfileSnapshot> findSnapshotByKeycloakUserId(String keycloakUserId);

    Optional<WotbAccountIdentity> currentWotbIdentity(String keycloakUserId);

    boolean hasTrustedWargamingIdentity();

    /** 按当前可信 WG 登录身份同步资料；失败沿用用户模块的错误语义。 */
    void synchronizeFromLogin(String keycloakUserId);

    /** 使用既有资料行锁，供管理删除与换绑串行化。 */
    Optional<UserProfileSnapshot> findSnapshotByKeycloakUserIdForUpdate(String keycloakUserId);

    Page<UserProfileSnapshot> searchForAdministration(String query, Pageable pageable);

    List<UserProfileSnapshot> findByKeycloakUserIdIn(Collection<String> keycloakUserIds);

    /** 删除并 flush 本地资料，使约束异常在管理端补偿范围内暴露。 */
    void deleteForAdministration(String keycloakUserId);
}
