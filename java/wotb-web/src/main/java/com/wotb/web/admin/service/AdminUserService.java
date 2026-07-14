package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.AdminDeleteUserResponse;
import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserDto;
import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.util.ErrorCode;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 管理员用户管理核心逻辑。
 */
@Service
public class AdminUserService {

    private final UserProfileService userProfileService;
    private final AdminUserMapper mapper;
    private final AdminUserLogPersister logPersister;
    private final KeycloakAdminUserService keycloakAdminUserService;
    private final BoosterService boosterService;

    public AdminUserService(final UserProfileService userProfileService,
                            final AdminUserMapper mapper,
                            final AdminUserLogPersister logPersister,
                            final KeycloakAdminUserService keycloakAdminUserService,
                            final BoosterService boosterService) {
        this.userProfileService = userProfileService;
        this.mapper = mapper;
        this.logPersister = logPersister;
        this.keycloakAdminUserService = keycloakAdminUserService;
        this.boosterService = boosterService;
    }

    /**
     * 搜索用户（本地 user_profile）。
     */
    @Transactional(readOnly = true)
    public List<AdminUserDto> searchUsers(final String query, final int limit) {
        return userProfileService.searchForAdministration(query, limit).stream()
                .map(mapper::toDto)
                .toList();
    }

    /**
     * 获取用户详情（本地 profile + Keycloak 信息）。
     */
    @Transactional(readOnly = true)
    public AdminUserDetailDto getUser(final String keycloakUserId) {
        final Optional<UserProfile> profileOpt = userProfileService
                .findEntityByKeycloakUserId(keycloakUserId);

        final AdminUserDetailDto.ProfileDto profileDto;
        profileDto = profileOpt.map(mapper::toProfileDto).orElse(null);

        final var kcUser = keycloakAdminUserService.getUser(keycloakUserId);
        final AdminUserDetailDto.KeycloakDto keycloakDto;
        final List<String> warnings = new ArrayList<>();

        if (kcUser != null) {
            keycloakDto = mapper.toKeycloakDto(
                    kcUser,
                    keycloakAdminUserService.getFederatedIdentities(keycloakUserId)
            );
        } else {
            keycloakDto = null;
            warnings.add(ErrorCode.KEYCLOAK_USER_NOT_FOUND.name());
        }

        return mapper.toDetailDto(keycloakUserId, profileDto, keycloakDto, warnings);
    }

    /** 删除用户：先 flush 本地删除，再删 Keycloak；外部调用失败会回滚本地事务。 */
    @Transactional
    public AdminDeleteUserResponse deleteUser(final String targetKeycloakUserId,
                                              final boolean confirm,
                                              final Jwt adminJwt) {
        if (!confirm) {
            throw new AdminBadRequestException(ErrorCode.CONFIRMATION_REQUIRED.name(),
                    ErrorCode.CONFIRMATION_REQUIRED.getDefaultMessage());
        }

        final String adminKeycloakUserId = adminJwt.getSubject();
        final String adminUsername = adminJwt.getClaimAsString("preferred_username");

        if (targetKeycloakUserId.equals(adminKeycloakUserId)) {
            throw new AdminConflictException(ErrorCode.CANNOT_DELETE_SELF.name(),
                    ErrorCode.CANNOT_DELETE_SELF.getDefaultMessage());
        }

        final Optional<UserProfile> profileOpt = userProfileService
                .findEntityByKeycloakUserIdForUpdate(targetKeycloakUserId);
        final UserProfile profile = profileOpt.orElse(null);
        final AdminUserLog log = logPersister.save(
                AdminUserLog.started(targetKeycloakUserId, profile,
                        adminKeycloakUserId, adminUsername));

        // 如有打手档案，先尝试删除（存在订单分配历史时阻断用户删除）。
        try {
            boosterService.deleteByKeycloakUserId(targetKeycloakUserId);
        } catch (final RuntimeException e) {
            if (e instanceof IllegalStateException
                    && "BOOSTER_HAS_DEPENDENCIES".equals(e.getMessage())) {
                log.markFailedLocalDelete(ErrorCode.BOOSTER_HAS_DEPENDENCIES.name(), e.getMessage());
                logPersister.save(log);
                throw new AdminConflictException(ErrorCode.BOOSTER_HAS_DEPENDENCIES.name(),
                        ErrorCode.BOOSTER_HAS_DEPENDENCIES.getDefaultMessage());
            }
            log.markFailedLocalDelete(ErrorCode.FAILED_LOCAL_DELETE.name(), e.getMessage());
            logPersister.save(log);
            throw new AdminInternalException(ErrorCode.FAILED_LOCAL_DELETE.name(),
                    ErrorCode.FAILED_LOCAL_DELETE.getDefaultMessage());
        }

        boolean localDeleted = false;

        // 先验证并 flush 本地删除，避免数据库约束失败后才删除 Keycloak 用户。
        if (profile != null) {
            try {
                userProfileService.deleteForAdministration(profile);
                localDeleted = true;
            } catch (final DataIntegrityViolationException e) {
                log.markFailedLocalDelete(ErrorCode.USER_HAS_DEPENDENCIES.name(), e.getMessage());
                logPersister.save(log);
                throw new AdminConflictException(ErrorCode.USER_HAS_DEPENDENCIES.name(),
                        ErrorCode.USER_HAS_DEPENDENCIES.getDefaultMessage());
            } catch (final Exception e) {
                log.markFailedLocalDelete(ErrorCode.FAILED_LOCAL_DELETE.name(), e.getMessage());
                logPersister.save(log);
                throw new AdminInternalException(ErrorCode.FAILED_LOCAL_DELETE.name(),
                        ErrorCode.FAILED_LOCAL_DELETE.getDefaultMessage());
            }
        }

        final boolean keycloakDeleted;
        try {
            keycloakAdminUserService.deleteUser(targetKeycloakUserId);
            keycloakDeleted = true;
        } catch (final Exception e) {
            log.markFailedKeycloakDelete(ErrorCode.FAILED_KEYCLOAK_DELETE.name(), false, e.getMessage());
            logPersister.save(log);
            throw new AdminInternalException(ErrorCode.FAILED_KEYCLOAK_DELETE.name(),
                    ErrorCode.FAILED_KEYCLOAK_DELETE.getDefaultMessage());
        }

        log.markSuccess(localDeleted, keycloakDeleted);
        logPersister.save(log);

        return new AdminDeleteUserResponse(true, targetKeycloakUserId, localDeleted, keycloakDeleted);
    }
}
