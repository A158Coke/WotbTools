package com.wotb.web.admin;

import com.wotb.web.admin.dto.AdminDeleteUserResponse;
import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** 管理员用户管理核心逻辑。 */
@Service
public class AdminUserService {

    private final UserProfileRepository userProfileRepository;
    private final AdminUserDeletionLogRepository deletionLogRepository;
    private final KeycloakAdminUserService keycloakAdminUserService;

    public AdminUserService(final UserProfileRepository userProfileRepository,
                            final AdminUserDeletionLogRepository deletionLogRepository,
                            final KeycloakAdminUserService keycloakAdminUserService) {
        this.userProfileRepository = userProfileRepository;
        this.deletionLogRepository = deletionLogRepository;
        this.keycloakAdminUserService = keycloakAdminUserService;
    }

    /** 搜索用户（本地 user_profile + 可选扩展 Keycloak 信息）。 */
    @Transactional(readOnly = true)
    public List<AdminUserDto> searchUsers(final String query, final int limit) {
        final int effectiveLimit = Math.min(Math.max(limit, 1), 100);
        final List<UserProfile> profiles;

        if (query == null || query.isBlank()) {
            profiles = userProfileRepository.findAll(
                    org.springframework.data.domain.PageRequest.of(0, effectiveLimit,
                            org.springframework.data.domain.Sort.by(
                                    org.springframework.data.domain.Sort.Direction.DESC, "createdAt")))
                    .getContent();
        } else {
            profiles = userProfileRepository.searchAdminUsers(query,
                    org.springframework.data.domain.PageRequest.of(0, effectiveLimit));
        }

        final List<AdminUserDto> result = new ArrayList<>();
        for (final UserProfile profile : profiles) {
            result.add(toAdminUserDto(profile));
        }
        return result;
    }

    /** 获取用户详情（本地 profile + Keycloak 信息）。 */
    @Transactional(readOnly = true)
    public AdminUserDetailDto getUser(final String keycloakUserId) {
        final Optional<UserProfile> profileOpt = userProfileRepository
                .findByKeycloakUserId(keycloakUserId);

        final AdminUserDetailDto.ProfileDto profileDto;
        if (profileOpt.isPresent()) {
            final UserProfile profile = profileOpt.get();
            profileDto = toProfileDto(profile);
        } else {
            profileDto = null;
        }

        final var kcUser = keycloakAdminUserService.getUser(keycloakUserId);
        final AdminUserDetailDto.KeycloakDto keycloakDto;
        final List<String> warnings = new ArrayList<>();

        if (kcUser != null) {
            keycloakDto = toKeycloakDto(kcUser, keycloakUserId);
        } else {
            keycloakDto = null;
            warnings.add("KEYCLOAK_USER_NOT_FOUND");
        }

        return new AdminUserDetailDto(keycloakUserId, profileDto, keycloakDto, warnings.isEmpty() ? null : warnings);
    }

    /** 删除用户：先删本地 user_profile，再删 Keycloak 用户。 */
    @Transactional
    public AdminDeleteUserResponse deleteUser(final String targetKeycloakUserId,
                                              final boolean confirm,
                                              final Jwt adminJwt) {
        if (!confirm) {
            throw new AdminBadRequestException("CONFIRMATION_REQUIRED",
                    "Deletion requires confirm=true.");
        }

        final String adminKeycloakUserId = adminJwt.getSubject();
        final String adminUsername = adminJwt.getClaimAsString("preferred_username");

        if (targetKeycloakUserId.equals(adminKeycloakUserId)) {
            throw new AdminConflictException("CANNOT_DELETE_SELF",
                    "You cannot delete your own admin account.");
        }

        final Optional<UserProfile> profileOpt = userProfileRepository
                .findByKeycloakUserId(targetKeycloakUserId);
        final UserProfile profile = profileOpt.orElse(null);

        final AdminUserDeletionLog log = deletionLogRepository.save(
                AdminUserDeletionLog.started(targetKeycloakUserId, profile,
                        adminKeycloakUserId, adminUsername));

        boolean localDeleted = false;
        boolean keycloakDeleted = false;

        // 第一步：删除本地 user_profile
        if (profile != null) {
            try {
                userProfileRepository.delete(profile);
                localDeleted = true;
            } catch (final DataIntegrityViolationException e) {
                log.markFailedLocalDelete("USER_HAS_DEPENDENCIES", e.getMessage());
                deletionLogRepository.save(log);
                throw new AdminConflictException("USER_HAS_DEPENDENCIES",
                        "User has related records and cannot be deleted directly.");
            } catch (final Exception e) {
                log.markFailedLocalDelete("FAILED_LOCAL_DELETE", e.getMessage());
                deletionLogRepository.save(log);
                throw new AdminInternalException("FAILED_LOCAL_DELETE",
                        "Local user profile could not be deleted.");
            }
        }

        // 第二步：删除 Keycloak 用户
        try {
            keycloakAdminUserService.deleteUser(targetKeycloakUserId);
            keycloakDeleted = true;
        } catch (final Exception e) {
            log.markFailedKeycloakDelete(localDeleted, e.getMessage());
            deletionLogRepository.save(log);
            throw new AdminInternalException("FAILED_KEYCLOAK_DELETE",
                    "Local profile was deleted, but Keycloak user deletion failed.");
        }

        log.markSuccess(localDeleted, keycloakDeleted);
        deletionLogRepository.save(log);

        return new AdminDeleteUserResponse(true, targetKeycloakUserId, localDeleted, keycloakDeleted);
    }

    // ── DTO 转换 ─────────────────────────────────────────────────────

    private AdminUserDto toAdminUserDto(final UserProfile profile) {
        return new AdminUserDto(
                profile.getKeycloakUserId(),
                profile.getId(),
                profile.getDisplayName(),
                profile.getWotbAccountId(),
                profile.getWotbNickname(),
                profile.getWotbServer(),
                null, // keycloakUsername — MVP 阶段不额外查 KC API
                null, // keycloakEmail
                profile.getCreatedAt() != null ? profile.getCreatedAt().toString() : null,
                "LOCAL_PROFILE"
        );
    }

    private AdminUserDetailDto.ProfileDto toProfileDto(final UserProfile profile) {
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

    private AdminUserDetailDto.KeycloakDto toKeycloakDto(
            final org.keycloak.representations.idm.UserRepresentation kcUser,
            final String keycloakUserId) {
        final AdminUserDetailDto.KeycloakDto dto = new AdminUserDetailDto.KeycloakDto();
        dto.setId(kcUser.getId());
        dto.setUsername(kcUser.getUsername());
        dto.setEmail(kcUser.getEmail());
        dto.setFirstName(kcUser.getFirstName());
        dto.setLastName(kcUser.getLastName());
        dto.setEnabled(kcUser.isEnabled() != null && kcUser.isEnabled());

        final var federatedIdentities = keycloakAdminUserService.getFederatedIdentities(keycloakUserId);
        final List<AdminUserDetailDto.FederatedIdentityDto> fiDtos = new ArrayList<>();
        for (final var fi : federatedIdentities) {
            final AdminUserDetailDto.FederatedIdentityDto fiDto = new AdminUserDetailDto.FederatedIdentityDto();
            fiDto.setIdentityProvider(fi.getIdentityProvider());
            fiDto.setUserId(fi.getUserId());
            fiDto.setUserName(fi.getUserName());
            fiDtos.add(fiDto);
        }
        dto.setFederatedIdentities(fiDtos);
        return dto;
    }
}
