package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.BulkDeleteUserResult;
import com.wotb.web.admin.dto.BulkDeleteUsersRequest;
import com.wotb.web.admin.dto.BulkDeleteUsersResponse;
import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 批量删除用户单元测试（mock，无 DB）。
 *
 * <p>核心契约：逐用户复用单用户删除的全部业务保护，并且</p>
 * <ul>
 *   <li>partial success —— 某个用户失败不回滚其他用户已完成的删除；</li>
 *   <li>失败用户不得被部分删除（本地资料删除失败时绝不继续删 Keycloak 用户）；</li>
 *   <li>self-delete 只让该条失败，不让整个批次失败；</li>
 *   <li>缺少 confirm 时整批拒绝，不做任何删除。</li>
 * </ul>
 */
class AdminUserBulkDeleteTest {

    private static final int MAX_BULK_SIZE = 100;

    private final UserProfileService userProfileService = mock(UserProfileService.class);
    private final AdminUserMapper mapper = mock(AdminUserMapper.class);
    private final AdminUserLogPersister logPersister = mock(AdminUserLogPersister.class);
    private final KeycloakAdminUserService keycloakAdminUserService = mock(KeycloakAdminUserService.class);
    private final BoosterService boosterService = mock(BoosterService.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);

    private AdminUserService service() {
        return new AdminUserService(userProfileService, mapper, logPersister,
                keycloakAdminUserService, boosterService, txManager);
    }

    @BeforeEach
    void setUp() {
        when(logPersister.save(any(AdminUserLog.class))).thenAnswer(invocation -> invocation.getArgument(0));
        doNothing().when(boosterService).deleteByKeycloakUserId(anyString());
    }

    @Test
    void reportsPerUserResultAndNeverPartiallyDeletesTheFailedUser() {
        final UserProfile profileA = profile("kc-a");
        final UserProfile profileB = profile("kc-b");
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-a")).thenReturn(Optional.of(profileA));
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-b")).thenReturn(Optional.of(profileB));
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-c")).thenReturn(Optional.empty());
        // kc-b 的本地资料删除因依赖被拒 → 该用户必须整体失败
        doThrow(new DataIntegrityViolationException("fk"))
                .when(userProfileService).deleteForAdministration(profileB);

        final BulkDeleteUsersResponse response = service().bulkDeleteUsers(
                new BulkDeleteUsersRequest(List.of("kc-a", "kc-b", "kc-c"), true), adminJwt());

        assertEquals(3, response.requested());
        assertEquals(2, response.deleted());
        assertEquals(1, response.failed());
        assertEquals(List.of("kc-a", "kc-b", "kc-c"),
                response.results().stream().map(BulkDeleteUserResult::userId).toList());

        assertTrue(response.results().get(0).deleted());
        assertFalse(response.results().get(1).deleted());
        assertEquals("USER_HAS_DEPENDENCIES", response.results().get(1).errorCode());
        assertTrue(response.results().get(2).deleted());
        assertEquals(null, response.results().get(0).errorCode());

        // 失败用户没有被部分删除：本地删除失败后绝不继续删 Keycloak 用户
        verify(keycloakAdminUserService, never()).deleteUser("kc-b");
        // 其余用户正常完成删除（partial success 不回滚）
        verify(keycloakAdminUserService).deleteUser("kc-a");
        verify(keycloakAdminUserService).deleteUser("kc-c");
        // 每个用户一个独立事务：失败用户触发 rollback
        verify(txManager, atLeastOnce()).rollback(nullable(TransactionStatus.class));
    }

    @Test
    void rejectsSelfDeleteForThatEntryOnlyWithoutFailingTheBatch() {
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-a")).thenReturn(Optional.empty());

        final BulkDeleteUsersResponse response = service().bulkDeleteUsers(
                new BulkDeleteUsersRequest(List.of("admin-sub", "kc-a"), true), adminJwt());

        assertEquals(2, response.requested());
        assertEquals(1, response.deleted());
        assertEquals(1, response.failed());
        assertEquals("CANNOT_DELETE_SELF", response.results().get(0).errorCode());
        assertTrue(response.results().get(1).deleted());
        verify(keycloakAdminUserService, never()).deleteUser("admin-sub");
        verify(keycloakAdminUserService).deleteUser("kc-a");
    }

    @Test
    void requiresExplicitConfirmationForTheWholeBatch() {
        final AdminBadRequestException exception = assertThrows(AdminBadRequestException.class,
                () -> service().bulkDeleteUsers(new BulkDeleteUsersRequest(List.of("kc-a"), false), adminJwt()));
        assertEquals("CONFIRMATION_REQUIRED", exception.getErrorCode());
        verify(keycloakAdminUserService, never()).deleteUser(anyString());
    }

    @Test
    void enforcesBulkSizeLimit() {
        final List<String> tooMany = IntStream.rangeClosed(0, MAX_BULK_SIZE)
                .mapToObj(index -> "kc-" + index)
                .toList();
        final AdminBadRequestException exception = assertThrows(AdminBadRequestException.class,
                () -> service().bulkDeleteUsers(new BulkDeleteUsersRequest(tooMany, true), adminJwt()));
        assertEquals("BULK_LIMIT_EXCEEDED", exception.getErrorCode());
        verify(keycloakAdminUserService, never()).deleteUser(anyString());
    }

    @Test
    void deduplicatesIdsSoTheSameUserIsNotDeletedTwice() {
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-a")).thenReturn(Optional.empty());

        final BulkDeleteUsersResponse response = service().bulkDeleteUsers(
                new BulkDeleteUsersRequest(List.of("kc-a", " kc-a ", "kc-a"), true), adminJwt());

        assertEquals(1, response.requested());
        assertEquals(1, response.deleted());
        verify(keycloakAdminUserService).deleteUser("kc-a");
    }

    private static UserProfile profile(final String keycloakUserId) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setWotbAccountId(100L);
        return profile;
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("admin-sub")
                .claim("preferred_username", "admin-user")
                .build();
    }
}
