package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AdminUserServiceTest {

    @Test
    void databaseConstraintFailureDoesNotDeleteKeycloakUser() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final BoosterService boosterService = mock(BoosterService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("target"))
                .thenReturn(Optional.of(profile));
        doThrow(new DataIntegrityViolationException("foreign key"))
                .when(userProfileService).deleteForAdministration(profile);
        final AdminUserService service = service(userProfileService, logPersister, keycloakService, boosterService);

        final DeleteUsersResponse response = service.deleteUsers(List.of("target"), true, adminJwt());

        // 列表端点逐条捕获失败并写进 results（partial success），因此不抛异常
        assertEquals(1, response.failed());
        assertEquals("USER_HAS_DEPENDENCIES", response.results().getFirst().errorCode());
        verifyNoInteractions(keycloakService);
    }

    @Test
    void deletesBoosterBeforeLocalAndKeycloakUsers() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final BoosterService boosterService = mock(BoosterService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("target"))
                .thenReturn(Optional.of(profile));
        final AdminUserService service = service(userProfileService, logPersister, keycloakService, boosterService);

        service.deleteUsers(List.of("target"), true, adminJwt());

        final InOrder order = inOrder(boosterService, userProfileService, keycloakService);
        order.verify(boosterService).deleteByKeycloakUserId("target");
        order.verify(userProfileService).deleteForAdministration(profile);
        order.verify(keycloakService).deleteUser("target");
    }

    @Test
    void boosterDependenciesBlockUserAndKeycloakDeletion() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final BoosterService boosterService = mock(BoosterService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("target"))
                .thenReturn(Optional.of(profile));
        doThrow(new IllegalStateException("BOOSTER_HAS_DEPENDENCIES"))
                .when(boosterService).deleteByKeycloakUserId("target");
        final AdminUserService service = service(userProfileService, logPersister, keycloakService, boosterService);

        final DeleteUsersResponse response = service.deleteUsers(List.of("target"), true, adminJwt());

        assertEquals(1, response.failed());
        assertEquals("BOOSTER_HAS_DEPENDENCIES", response.results().getFirst().errorCode());
        verify(userProfileService, never()).deleteForAdministration(any());
        verifyNoInteractions(keycloakService);
        final ArgumentCaptor<AdminUserLog> logCaptor = ArgumentCaptor.forClass(AdminUserLog.class);
        final InOrder auditOrder = inOrder(logPersister, boosterService);
        auditOrder.verify(logPersister).save(any(AdminUserLog.class));
        auditOrder.verify(boosterService).deleteByKeycloakUserId("target");
        auditOrder.verify(logPersister).save(logCaptor.capture());
        final AdminUserLog failedLog = logCaptor.getValue();
        assertEquals("FAILED_LOCAL_DELETE", failedLog.getStatus());
        assertEquals("BOOSTER_HAS_DEPENDENCIES", failedLog.getErrorCode());
    }

    @Test
    void boosterCleanupFailureIsAuditedAndBlocksUserDeletion() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final BoosterService boosterService = mock(BoosterService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("target"))
                .thenReturn(Optional.of(profile));
        doThrow(new IllegalStateException("KEYCLOAK_UNAVAILABLE"))
                .when(boosterService).deleteByKeycloakUserId("target");
        final AdminUserService service = service(userProfileService, logPersister, keycloakService, boosterService);

        final DeleteUsersResponse response = service.deleteUsers(List.of("target"), true, adminJwt());

        assertEquals(1, response.failed());
        assertEquals("FAILED_LOCAL_DELETE", response.results().getFirst().errorCode());
        verify(userProfileService, never()).deleteForAdministration(any());
        verifyNoInteractions(keycloakService);
        final ArgumentCaptor<AdminUserLog> logCaptor = ArgumentCaptor.forClass(AdminUserLog.class);
        final InOrder auditOrder = inOrder(logPersister, boosterService);
        auditOrder.verify(logPersister).save(any(AdminUserLog.class));
        auditOrder.verify(boosterService).deleteByKeycloakUserId("target");
        auditOrder.verify(logPersister).save(logCaptor.capture());
        final AdminUserLog failedLog = logCaptor.getValue();
        assertEquals("FAILED_LOCAL_DELETE", failedLog.getStatus());
        assertEquals("FAILED_LOCAL_DELETE", failedLog.getErrorCode());
    }

    private static AdminUserService service(
            final UserProfileService userProfileService,
            final AdminUserLogPersister logPersister,
            final KeycloakAdminUserService keycloakService,
            final BoosterService boosterService) {
        // 第 6 参数（PlatformTransactionManager）只被 deleteUsers 使用；本用例走的删除路径不触碰它。
        return new AdminUserService(
                userProfileService,
                new AdminUserMapper(),
                logPersister,
                keycloakService,
                boosterService,
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
