package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.AdminUserDetailDto;
import com.wotb.web.admin.dto.AdminUserListItemDto;
import com.wotb.web.admin.dto.AdminUserPageDto;
import com.wotb.web.admin.dto.DeleteUserResult;
import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.ErrorCode;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 管理员用户管理核心逻辑。
 *
 * <p>列表是 Keycloak realm users 与本地 user_profile 的合并视图，分两个 segment：</p>
 * <ul>
 *   <li>{@link #SEGMENT_KEYCLOAK}（默认）：权威源是 Keycloak，因此没有任何本地 profile 的
 *       Keycloak-only 用户也能被找到并删除（旧 Juhe QQ cleanup 的前提）。</li>
 *   <li>{@link #SEGMENT_LOCAL}：权威源是本地 user_profile，用于暴露 Keycloak 侧已不存在
 *       的孤儿绑定，管理员可批量删除其资料以释放 {@code (wotb_server, wotb_account_id)} 唯一槽位。</li>
 * </ul>
 *
 * <p>两个 segment 都使用各自的权威分页与权威总数，不做「拉一页再在内存里筛」的伪造分页。</p>
 */
@Service
public class AdminUserService {

    /** Keycloak-driven segment：以 Keycloak realm users 为权威用户列表。 */
    public static final String SEGMENT_KEYCLOAK = "keycloak";
    /** Local-profile-driven segment：以本地 user_profile 为权威用户列表。 */
    public static final String SEGMENT_LOCAL = "local";

    /** 单页上限；默认页大小由 controller 的 {@code size} 默认值决定。 */
    private static final int MAX_PAGE_SIZE = 100;
    /** 单次删除请求的 id 数上限：为无界的外部（Keycloak Admin API）调用设硬边界。 */
    private static final int MAX_DELETE_BATCH = 100;

    private final UserProfileService userProfileService;
    private final AdminUserMapper mapper;
    private final AdminUserLogPersister logPersister;
    private final KeycloakAdminUserService keycloakAdminUserService;
    private final BoosterService boosterService;
    private final TransactionTemplate transactionTemplate;

    public AdminUserService(final UserProfileService userProfileService,
                            final AdminUserMapper mapper,
                            final AdminUserLogPersister logPersister,
                            final KeycloakAdminUserService keycloakAdminUserService,
                            final BoosterService boosterService,
                            final PlatformTransactionManager transactionManager) {
        this.userProfileService = userProfileService;
        this.mapper = mapper;
        this.logPersister = logPersister;
        this.keycloakAdminUserService = keycloakAdminUserService;
        this.boosterService = boosterService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    // ── 列表（合并视图） ──────────────────────────────────────────────────

    /**
     * 分页搜索用户。
     *
     * @param query    自由文本过滤；空串按无过滤处理
     * @param segment  {@link #SEGMENT_KEYCLOAK} 或 {@link #SEGMENT_LOCAL}；空值取前者
     * @param idpAlias 仅 {@link #SEGMENT_KEYCLOAK} 支持；本地 segment 传值 → 400
     * @param page     0-based 页码
     * @param size     每页条数（1..100）
     *
     * <p>刻意不使用 {@code @Transactional}：本方法要把外部 Keycloak Admin 调用与数据库读取混在
     * 一起（local segment 每页更是 N 次调用），用一个外层事务包住会把 DB 连接一直握在手里，
     * 在高并发管理操作下耗尽连接池。每次 DB 访问各自走自己的只读事务。</p>
     */
    public AdminUserPageDto searchUsers(final String query,
                                        final String segment,
                                        final String idpAlias,
                                        final int page,
                                        final int size) {
        final String normalizedSegment = normalizeSegment(segment);
        final int effectivePage = Math.max(0, page);
        final int effectiveSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        if (SEGMENT_LOCAL.equals(normalizedSegment) && StringUtils.hasText(idpAlias)) {
            throw new AdminBadRequestException(ErrorCode.IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT.name(),
                    ErrorCode.IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT.getDefaultMessage());
        }
        return SEGMENT_LOCAL.equals(normalizedSegment)
                ? localSegment(query, effectivePage, effectiveSize)
                : keycloakSegment(query, idpAlias, effectivePage, effectiveSize);
    }

    /** Keycloak 权威分页 + 本地资料批量增强（单次 IN 查询，禁止逐用户查询）。 */
    private AdminUserPageDto keycloakSegment(final String query,
                                             final String idpAlias,
                                             final int page,
                                             final int size) {
        final boolean byIdentityProvider = StringUtils.hasText(idpAlias);
        final int first = page * size;
        final List<UserRepresentation> keycloakUsers = byIdentityProvider
                ? keycloakAdminUserService.searchUsersByIdpAlias(idpAlias.trim(), query, first, size)
                : keycloakAdminUserService.searchUsers(query, first, size);
        final long total = byIdentityProvider
                ? keycloakAdminUserService.countUsersByIdpAlias(idpAlias.trim(), query)
                : keycloakAdminUserService.countUsers(query);
        final Map<String, UserProfile> profiles = profilesByKeycloakId(
                keycloakUsers.stream().map(UserRepresentation::getId).toList());
        final List<AdminUserListItemDto> items = keycloakUsers.stream()
                .map(keycloakUser -> mapper.toListItem(keycloakUser, profiles.get(keycloakUser.getId())))
                .toList();
        return new AdminUserPageDto(items, page, size, total, totalPages(total, size));
    }

    /**
     * 本地 profile 权威分页；当页每个 profile 逐个确认 Keycloak 用户是否仍存在，以标记孤儿绑定。
     *
     * <p>代价：该 segment 每页会产生 N（≤ size）次 Keycloak Admin 调用——Keycloak 没有按 id
     * 批量查询的能力（见 docs/auth/keycloak-admin-user-search.md）。默认页大小使该代价有界。</p>
     */
    private AdminUserPageDto localSegment(final String query, final int page, final int size) {
        final Page<UserProfile> rows = userProfileService.searchForAdministration(
                query, PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        final List<AdminUserListItemDto> items = rows.getContent().stream()
                .map(profile -> mapper.toListItem(
                        keycloakAdminUserService.getUser(profile.getKeycloakUserId()), profile))
                .toList();
        return new AdminUserPageDto(items, page, size, rows.getTotalElements(), rows.getTotalPages());
    }

    private Map<String, UserProfile> profilesByKeycloakId(final List<String> keycloakUserIds) {
        return userProfileService.findByKeycloakUserIdIn(keycloakUserIds).stream()
                .collect(Collectors.toMap(
                        UserProfile::getKeycloakUserId, Function.identity(), (first, second) -> first));
    }

    private static String normalizeSegment(final String segment) {
        if (!StringUtils.hasText(segment)) {
            return SEGMENT_KEYCLOAK;
        }
        final String normalized = segment.trim().toLowerCase(Locale.ROOT);
        if (!SEGMENT_KEYCLOAK.equals(normalized) && !SEGMENT_LOCAL.equals(normalized)) {
            throw new AdminBadRequestException(ErrorCode.INVALID_USER_SEGMENT.name(),
                    ErrorCode.INVALID_USER_SEGMENT.getDefaultMessage());
        }
        return normalized;
    }

    private static int totalPages(final long total, final int size) {
        return size <= 0 ? 0 : (int) ((total + size - 1) / size);
    }

    // ── 详情 ─────────────────────────────────────────────────────────────

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

    // ── 删除 ─────────────────────────────────────────────────────────────

    /**
     * 删除用户。请求体就是 Keycloak sub 列表——删除单个用户即长度为 1 的列表，
     * 因此不存在单独的「批量删除」形态。
     *
     * <p>逐用户复用 {@link #deleteOneInternal} 的全部业务保护（self-delete 保护、打手依赖、
     * 本地资料清理、Keycloak 删除、审计日志、统一 error contract）。</p>
     *
     * <p>每个用户跑在<strong>独立事务</strong>中，因此允许 partial success：某个用户失败不会
     * 回滚其他用户已完成的删除。自调用带 {@code @Transactional} 的方法会绕过 Spring 事务代理
     * 而失去这一语义，故显式使用 {@link TransactionTemplate}。</p>
     *
     * @param requestedUserIds 目标 Keycloak sub 列表（去重、剔除空值后处理）
     * @param confirm          与删除同一业务规则的显式确认位；false 时整批拒绝
     */
    public DeleteUsersResponse deleteUsers(final List<String> requestedUserIds,
                                           final boolean confirm,
                                           final Jwt adminJwt) {
        requireConfirmation(confirm);
        final List<String> userIds = distinctUserIds(requestedUserIds);
        if (userIds.isEmpty()) {
            return new DeleteUsersResponse(0, 0, 0, List.of());
        }
        if (userIds.size() > MAX_DELETE_BATCH) {
            throw new AdminBadRequestException(ErrorCode.BULK_LIMIT_EXCEEDED.name(),
                    ErrorCode.BULK_LIMIT_EXCEEDED.getDefaultMessage());
        }

        final List<DeleteUserResult> results = new ArrayList<>(userIds.size());
        int deleted = 0;
        for (final String userId : userIds) {
            try {
                transactionTemplate.executeWithoutResult(status -> deleteOneInternal(userId, adminJwt));
                results.add(new DeleteUserResult(userId, true, null));
                deleted++;
            } catch (final AdminConflictException e) {
                results.add(new DeleteUserResult(userId, false, e.getErrorCode()));
            } catch (final AdminBadRequestException e) {
                results.add(new DeleteUserResult(userId, false, e.getErrorCode()));
            } catch (final AdminInternalException e) {
                results.add(new DeleteUserResult(userId, false, e.getErrorCode()));
            }
        }
        return new DeleteUsersResponse(userIds.size(), deleted, userIds.size() - deleted, results);
    }

    private static void requireConfirmation(final boolean confirm) {
        if (!confirm) {
            throw new AdminBadRequestException(ErrorCode.CONFIRMATION_REQUIRED.name(),
                    ErrorCode.CONFIRMATION_REQUIRED.getDefaultMessage());
        }
    }

    private static List<String> distinctUserIds(final List<String> requestedUserIds) {
        if (requestedUserIds == null) {
            return List.of();
        }
        return requestedUserIds.stream()
                .filter(StringUtils::hasText)
                .map(String::trim)
                .distinct()
                .toList();
    }

    /**
     * 删除的唯一实现：请求体里的每个 id 都走这里（单条删除就是长度为 1 的列表）。
     * 禁止任何绕过路径（直接 SQL DELETE 或裸 Keycloak Admin 调用），否则会丢掉 self-delete 保护、
     * 打手依赖处理、本地资料清理与审计日志。
     */
    private void deleteOneInternal(final String targetKeycloakUserId, final Jwt adminJwt) {
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

        try {
            keycloakAdminUserService.deleteUser(targetKeycloakUserId);
        } catch (final Exception e) {
            log.markFailedKeycloakDelete(ErrorCode.FAILED_KEYCLOAK_DELETE.name(), false, e.getMessage());
            logPersister.save(log);
            throw new AdminInternalException(ErrorCode.FAILED_KEYCLOAK_DELETE.name(),
                    ErrorCode.FAILED_KEYCLOAK_DELETE.getDefaultMessage());
        }

        log.markSuccess(localDeleted, true);
        logPersister.save(log);
    }
}
