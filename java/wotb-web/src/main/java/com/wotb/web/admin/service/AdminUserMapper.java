package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.util.Mapper;
import org.keycloak.representations.idm.FederatedIdentityRepresentation;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.stereotype.Service;

import java.util.List;

/** 管理端用户列表与详情 DTO 映射。 */
@Service
public class AdminUserMapper implements Mapper<UserProfile, AdminUserDto> {

    @Override
    public AdminUserDto toDto(final UserProfile profile) {
        return new AdminUserDto(
                profile.getKeycloakUserId(),
                profile.getId(),
                profile.getDisplayName(),
                profile.getWotbAccountId(),
                profile.getWotbNickname(),
                profile.getWotbServer(),
                null,
                null,
                profile.getCreatedAt() != null ? profile.getCreatedAt().toString() : null,
                "LOCAL_PROFILE"
        );
    }

    public AdminUserDetailDto.ProfileDto toProfileDto(final UserProfile profile) {
        final AdminUserDetailDto.ProfileDto dto = new AdminUserDetailDto.ProfileDto();
        dto.setId(profile.getId());
        dto.setDisplayName(profile.getDisplayName());
        dto.setWotbAccountId(profile.getWotbAccountId());
        dto.setWotbNickname(profile.getWotbNickname());
        dto.setWotbServer(profile.getWotbServer());
        dto.setCreatedAt(profile.getCreatedAt() != null ? profile.getCreatedAt().toString() : null);
        dto.setUpdatedAt(profile.getUpdatedAt() != null ? profile.getUpdatedAt().toString() : null);
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
