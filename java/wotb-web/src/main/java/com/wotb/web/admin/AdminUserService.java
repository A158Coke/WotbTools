package com.wotb.web.admin;

import com.wotb.web.admin.dto.AdminDeleteUserResponse;
import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserDto;
import com.wotb.web.dto.ErrorCodes;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 管理员用户管理核心逻辑。
 */
@Service
public class AdminUserService {

    private final UserProfileRepository userProfileRepository;
    private final AdminUserLogPersister logPersister;
    private final KeycloakAdminUserService keycloakAdminUserService;

    public AdminUserService(final UserProfileRepository userProfileRepository,
                            final AdminUserLogPersister logPersister,
                            final KeycloakAdminUserService keycloakAdminUserService) {
        this.userProfileRepository = userProfileRepository;
        this.logPersister = logPersister;
        this.keycloakAdminUserService = keycloakAdminUserService;
    }

    /**
     * 搜索用户（本地 user_profile）。
     */
    @Transactional(readOnly = true)
    public List<AdminUserDto> searchUsers(final String query, final int limit) {
        final int effectiveLimit = Math.clamp(limit, 1, 100);
        final List<UserProfile> profiles;

        if (!StringUtils.hasText(query)) {
            profiles = userProfileRepository.findAll(
                    PageRequest.of(0, effectiveLimit, Sort.by(Sort.Direction.DESC, "createdAt")))
                    .getContent();
        } else {
            profiles = userProfileRepository.searchAdminUsers(query,
                    PageRequest.of(0, effectiveLimit));
        }

        return profiles.stream().map(this::toAdminUserDto).toList();
    }

    /**
     * 获取用户详情（本地 profile + Keycloak 信息）。
     */
    @Transactional(readOnly = true)
    public AdminUserDetailDto getUser(final String keycloakUserId) {
        final Optional<UserProfile> profileOpt = userProfileRepository
                .findByKeycloakUserId(keycloakUserId);

        final AdminUserDetailDto.ProfileDto profileDto;
        profileDto = profileOpt.map(this::toProfileDto).orElse(null);

        final var kcUser = keycloakAdminUserService.getUser(keycloakUserId);
        final AdminUserDetailDto.KeycloakDto keycloakDto;
        final List<String> warnings = new ArrayList<>();

        if (kcUser != null) {
            keycloakDto = toKeycloakDto(kcUser, keycloakUserId);
        } else {
            keycloakDto = null;
            warnings.add(ErrorCodes.KEYCLOAK_USER_NOT_FOUND);
        }

        return new AdminUserDetailDto(keycloakUserId, profileDto, keycloakDto,
                warnings);
    }

    /**
     * 删除用户：先删 Keycloak，再删本地 user_profile。
     * Keycloak 删除成功后本地删除失败 → orphan profile，需人工补删。
     */
    @Transactional
    public AdminDeleteUserResponse deleteUser(final String targetKeycloakUserId,
                                              final boolean confirm,
                                              final Jwt adminJwt) {
        if (!confirm) {
            throw new AdminBadRequestException(ErrorCodes.CONFIRMATION_REQUIRED,
                    ErrorCodes.message(ErrorCodes.CONFIRMATION_REQUIRED));
        }

        final String adminKeycloakUserId = adminJwt.getSubject();
        final String adminUsername = adminJwt.getClaimAsString("preferred_username");

        if (targetKeycloakUserId.equals(adminKeycloakUserId)) {
            throw new AdminConflictException(ErrorCodes.CANNOT_DELETE_SELF,
                    ErrorCodes.message(ErrorCodes.CANNOT_DELETE_SELF));
        }

        final Optional<UserProfile> profileOpt = userProfileRepository
                .findByKeycloakUserId(targetKeycloakUserId);
        final UserProfile profile = profileOpt.orElse(null);

        final AdminUserLog log = logPersister.save(
                AdminUserLog.started(targetKeycloakUserId, profile,
                        adminKeycloakUserId, adminUsername));

        boolean localDeleted = false;
        boolean keycloakDeleted = false;

        // 第一步：删除 Keycloak 用户
        try {
            keycloakAdminUserService.deleteUser(targetKeycloakUserId);
            keycloakDeleted = true;
        } catch (final Exception e) {
            log.markFailedKeycloakDelete(ErrorCodes.FAILED_KEYCLOAK_DELETE, false, e.getMessage());
            logPersister.save(log);
            throw new AdminInternalException(ErrorCodes.FAILED_KEYCLOAK_DELETE,
                    ErrorCodes.message(ErrorCodes.FAILED_KEYCLOAK_DELETE));
        }

        // 第二步：删除本地 user_profile
        if (profile != null) {
            try {
                userProfileRepository.delete(profile);
                localDeleted = true;
            } catch (final DataIntegrityViolationException e) {
                log.markFailedLocalDelete(ErrorCodes.USER_HAS_DEPENDENCIES, e.getMessage());
                logPersister.save(log);
                throw new AdminConflictException(ErrorCodes.USER_HAS_DEPENDENCIES,
                        ErrorCodes.message(ErrorCodes.USER_HAS_DEPENDENCIES));
            } catch (final Exception e) {
                log.markFailedLocalDelete(ErrorCodes.FAILED_LOCAL_DELETE, e.getMessage());
                logPersister.save(log);
                throw new AdminInternalException(ErrorCodes.FAILED_LOCAL_DELETE,
                        ErrorCodes.message(ErrorCodes.FAILED_LOCAL_DELETE));
            }
        }

        log.markSuccess(localDeleted, keycloakDeleted);
        logPersister.save(log);

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
                null, null,
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
            final UserRepresentation kcUser,
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
