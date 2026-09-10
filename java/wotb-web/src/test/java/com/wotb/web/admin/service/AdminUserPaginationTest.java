package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.AdminUserPageDto;
import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.Test;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.List;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Admin Users 列表分页与合并数据源的单元测试（mock，无 DB / 无 Keycloak）。
 *
 * <p>核心回归点：分页权威在数据源侧，不再有「取 200 条再本地切」的伪造分页，
 * 因此第 101 个及之后的用户可以通过翻页访问。</p>
 */
class AdminUserPaginationTest {

    private final UserProfileService userProfileService = mock(UserProfileService.class);
    private final AdminUserLogPersister logPersister = mock(AdminUserLogPersister.class);
    private final KeycloakAdminUserService keycloakAdminUserService = mock(KeycloakAdminUserService.class);
    private final BoosterService boosterService = mock(BoosterService.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    /** 使用真实 mapper，锁定合并视图的字段映射语义。 */
    private final AdminUserMapper mapper = new AdminUserMapper();

    private AdminUserService service() {
        return new AdminUserService(userProfileService, mapper, logPersister,
                keycloakAdminUserService, boosterService, txManager);
    }

    @Test
    void keycloakSegmentReachesUsersBeyondTheOldHundredRowCap() {
        final List<UserRepresentation> keycloakUsers = IntStream.rangeClosed(101, 125)
                .mapToObj(index -> keycloakUser("kc-" + index))
                .toList();
        when(keycloakAdminUserService.searchUsers(null, 100, 25)).thenReturn(keycloakUsers);
        when(keycloakAdminUserService.countUsers(null)).thenReturn(1050);
        when(userProfileService.findByKeycloakUserIdIn(any()))
                .thenReturn(List.of(profile("kc-101", 100L)));

        final AdminUserPageDto result = service().searchUsers(null, null, null, 4, 25);

        // 第 5 页（0-based page=4）→ Keycloak first=100，即第 101 个用户起
        verify(keycloakAdminUserService).searchUsers(null, 100, 25);
        assertEquals(4, result.page());
        assertEquals(25, result.size());
        assertEquals(1050, result.totalItems());
        assertEquals(42, result.totalPages());
        assertEquals(25, result.items().size());
        assertEquals("kc-101", result.items().get(0).keycloakUserId());
        assertTrue(result.items().get(0).hasLocalProfile(), "本地有资料必须标记");
        assertFalse(result.items().get(0).keycloakUserMissing());
        // Keycloak-only 用户同样出现在结果里（旧 Juhe QQ cleanup 的前提）
        assertEquals("kc-125", result.items().get(24).keycloakUserId());
        assertFalse(result.items().get(24).hasLocalProfile());
    }

    @Test
    void localSegmentUsesDatabasePaginationAndFlagsOrphanBindings() {
        when(userProfileService.searchForAdministration(isNull(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(
                        List.of(profile("kc-bound", 100L), profile("kc-gone", 200L)),
                        PageRequest.of(0, 25), 120));
        when(keycloakAdminUserService.getUser("kc-bound")).thenReturn(keycloakUser("kc-bound"));
        when(keycloakAdminUserService.getUser("kc-gone")).thenReturn(null);

        final AdminUserPageDto result = service().searchUsers(null, "local", null, 0, 25);

        assertEquals(120, result.totalItems(), "总数必须来自 DB 权威分页，而不是本地伪造");
        assertEquals(5, result.totalPages());
        assertFalse(result.items().get(0).keycloakUserMissing());
        assertTrue(result.items().get(1).keycloakUserMissing(), "Keycloak 侧已不存在的绑定必须可被管理员识别");
    }

    @Test
    void idpFilterUsesTheIdentityProviderSearchPath() {
        when(keycloakAdminUserService.searchUsersByIdpAlias("juhe-qq", "old", 0, 25))
                .thenReturn(List.of());
        when(keycloakAdminUserService.countUsersByIdpAlias("juhe-qq", "old")).thenReturn(0);

        service().searchUsers("old", "keycloak", "juhe-qq", 0, 25);

        verify(keycloakAdminUserService).searchUsersByIdpAlias("juhe-qq", "old", 0, 25);
        verify(keycloakAdminUserService).countUsersByIdpAlias("juhe-qq", "old");
        verify(keycloakAdminUserService, never()).searchUsers(nullable(String.class), anyInt(), anyInt());
    }

    @Test
    void rejectsUnknownSegment() {
        final AdminBadRequestException exception = assertThrows(AdminBadRequestException.class,
                () -> service().searchUsers(null, "bogus", null, 0, 25));
        assertEquals("INVALID_USER_SEGMENT", exception.getErrorCode());
    }

    @Test
    void rejectsIdpFilterOnTheLocalSegment() {
        final AdminBadRequestException exception = assertThrows(AdminBadRequestException.class,
                () -> service().searchUsers(null, "local", "juhe-qq", 0, 25));
        assertEquals("IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT", exception.getErrorCode());
    }

    @Test
    void clampsPageSizeToTheServerMaximumAndMinimum() {
        when(keycloakAdminUserService.searchUsers(null, 0, 100)).thenReturn(List.of());
        when(keycloakAdminUserService.searchUsers(null, 0, 1)).thenReturn(List.of());
        when(keycloakAdminUserService.countUsers(null)).thenReturn(0);

        assertEquals(100, service().searchUsers(null, null, null, 0, 5000).size());
        assertEquals(1, service().searchUsers(null, null, null, 0, 0).size());
    }

    private static UserRepresentation keycloakUser(final String id) {
        final UserRepresentation user = new UserRepresentation();
        user.setId(id);
        user.setUsername(id);
        user.setEnabled(true);
        return user;
    }

    private static UserProfile profile(final String keycloakUserId, final Long wotbAccountId) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setWotbAccountId(wotbAccountId);
        return profile;
    }
}
