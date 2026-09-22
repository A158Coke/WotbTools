package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AdminUserServiceTest {

    @Test
    void databaseConstraintFailureDoesNotDeleteKeycloakUser() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("target"))
                .thenReturn(Optional.of(profile));
        doThrow(new DataIntegrityViolationException("foreign key"))
                .when(userProfileService).deleteForAdministration(profile);
        final AdminUserService service = service(userProfileService, logPersister, keycloakService);

        final DeleteUsersResponse response = service.deleteUsers(List.of("target"), true, adminJwt());

        // 列表端点逐条捕获失败并写进 results（partial success），因此不抛异常
        assertEquals(1, response.failed());
        assertEquals("USER_HAS_DEPENDENCIES", response.results().getFirst().errorCode());
        verifyNoInteractions(keycloakService);
    }

    @Test
    void deletesLocalProfileBeforeKeycloakUser() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("target"))
                .thenReturn(Optional.of(profile));
        final AdminUserService service = service(userProfileService, logPersister, keycloakService);

        service.deleteUsers(List.of("target"), true, adminJwt());

        final InOrder order = inOrder(userProfileService, keycloakService);
        order.verify(userProfileService).deleteForAdministration(profile);
        order.verify(keycloakService).deleteUser("target");
    }

    private static AdminUserService service(
            final UserProfileService userProfileService,
            final AdminUserLogPersister logPersister,
            final KeycloakAdminUserService keycloakService) {
        // 第 5 参数（PlatformTransactionManager）只被 deleteUsers 使用；本用例走的删除路径不触碰它。
        return new AdminUserService(
                userProfileService,
                new AdminUserMapper(),
                logPersister,
                keycloakService,
                mock(PlatformTransactionManager.class)
        );
    }

    private static AdminUserLogPersister logPersister() {
        final AdminUserLogPersister persister = mock(AdminUserLogPersister.class);
        when(persister.save(any(AdminUserLog.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        return persister;
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("admin")
                .claim("preferred_username", "root")
                .build();
    }
}
