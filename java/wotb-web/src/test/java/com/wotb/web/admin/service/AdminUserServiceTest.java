package com.wotb.web.admin.service;

import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
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

        assertThrows(AdminConflictException.class,
                () -> service.deleteUser("target", true, adminJwt()));

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

        service.deleteUser("target", true, adminJwt());

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

        final AdminConflictException error = assertThrows(AdminConflictException.class,
                () -> service.deleteUser("target", true, adminJwt()));

        assertEquals("BOOSTER_HAS_DEPENDENCIES", error.getErrorCode());
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

        final AdminInternalException error = assertThrows(AdminInternalException.class,
                () -> service.deleteUser("target", true, adminJwt()));

        assertEquals("FAILED_LOCAL_DELETE", error.getErrorCode());
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
        return new AdminUserService(
                userProfileService,
                new AdminUserMapper(),
                logPersister,
                keycloakService,
                boosterService
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
