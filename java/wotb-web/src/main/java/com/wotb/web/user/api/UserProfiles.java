package com.wotb.web.user.api;

import org.springframework.data.domain.Page;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface UserProfiles {

    Optional<UserProfileSnapshot> findSnapshotByKeycloakUserId(String keycloakUserId);

    Optional<WotbAccountIdentity> currentWotbIdentity(String keycloakUserId);

    boolean hasTrustedWargamingIdentity();

    void synchronizeFromLogin(String keycloakUserId);

    Optional<UserProfileSnapshot> findSnapshotByKeycloakUserIdForUpdate(String keycloakUserId);

    Page<UserProfileSnapshot> searchForAdministration(String query, int page, int size);

    List<UserProfileSnapshot> findByKeycloakUserIdIn(Collection<String> keycloakUserIds);

    void deleteForAdministration(String keycloakUserId);
}
