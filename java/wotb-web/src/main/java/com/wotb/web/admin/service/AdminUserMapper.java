package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserListItemDto;
import com.wotb.web.user.service.UserProfileSnapshot;
import com.wotb.web.util.Mapper;
import org.keycloak.representations.idm.FederatedIdentityRepresentation;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.stereotype.Service;

import java.util.List;
import java.time.format.DateTimeFormatter;

/** 管理端用户列表与详情 DTO 映射。 */
@Service
public class AdminUserMapper implements Mapper<UserProfileSnapshot, AdminUserListItemDto> {

    /** 单行映射：Keycloak 用户与本地资料两侧都可为空，缺失侧即为该行的可见语义。 */
    @Override
    public AdminUserListItemDto toDto(final UserProfileSnapshot profile) {
        return toListItem(null, profile);
    }

    /**
     * 合并视图单行。
     *
     * @param keycloakUser Keycloak 用户；local segment 下用户已被删除时为 null
     * @param profile      本地资料；Keycloak-only 用户为 null
     */
    public AdminUserListItemDto toListItem(
            final UserRepresentation keycloakUser, final UserProfileSnapshot profile) {
        return new AdminUserListItemDto(
                keycloakUser != null ? keycloakUser.getId()
                        : profile != null ? profile.keycloakUserId() : null,
                keycloakUser != null ? keycloakUser.getUsername() : null,
                keycloakUser != null ? keycloakUser.getEmail() : null,
                keycloakUser != null ? Boolean.valueOf(Boolean.TRUE.equals(keycloakUser.isEnabled())) : null,
                profile != null ? profile.id() : null,
                profile != null ? profile.displayName() : null,
                profile != null ? profile.wotbAccountId() : null,
                profile != null ? profile.wotbNickname() : null,
                profile != null ? profile.wotbServer() : null,
                profile != null && profile.createdAt() != null
                        ? profile.createdAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME) : null,
                profile != null,
                profile != null && keycloakUser == null
        );
    }

    public AdminUserDetailDto.ProfileDto toProfileDto(final UserProfileSnapshot profile) {
        final AdminUserDetailDto.ProfileDto dto = new AdminUserDetailDto.ProfileDto();
        dto.setId(profile.id());
        dto.setDisplayName(profile.displayName());
        dto.setWotbAccountId(profile.wotbAccountId());
        dto.setWotbNickname(profile.wotbNickname());
        dto.setWotbServer(profile.wotbServer());
        dto.setCreatedAt(profile.createdAt() != null ? profile.createdAt().toString() : null);
        dto.setUpdatedAt(profile.updatedAt() != null ? profile.updatedAt().toString() : null);
        return dto;
    }

    public AdminUserDetailDto toDetailDto(
            final String keycloakUserId,
            final AdminUserDetailDto.ProfileDto profile,
            final AdminUserDetailDto.KeycloakDto keycloak,
            final List<String> warnings) {
        return new AdminUserDetailDto(keycloakUserId, profile, keycloak, List.copyOf(warnings));
    }

    public AdminUserDetailDto.KeycloakDto toKeycloakDto(
            final UserRepresentation user,
            final List<FederatedIdentityRepresentation> federatedIdentities) {
        final AdminUserDetailDto.KeycloakDto dto = new AdminUserDetailDto.KeycloakDto();
        dto.setId(user.getId());
        dto.setUsername(user.getUsername());
        dto.setEmail(user.getEmail());
        dto.setFirstName(user.getFirstName());
        dto.setLastName(user.getLastName());
        dto.setEnabled(Boolean.TRUE.equals(user.isEnabled()));
        dto.setFederatedIdentities(federatedIdentities == null
                ? List.of()
                : federatedIdentities.stream().map(AdminUserMapper::toFederatedIdentityDto).toList());
        return dto;
    }

    private static AdminUserDetailDto.FederatedIdentityDto toFederatedIdentityDto(
            final FederatedIdentityRepresentation identity) {
        final AdminUserDetailDto.FederatedIdentityDto dto = new AdminUserDetailDto.FederatedIdentityDto();
        dto.setIdentityProvider(identity.getIdentityProvider());
        dto.setUserId(identity.getUserId());
        dto.setUserName(identity.getUserName());
        return dto;
    }
}
