package com.wotb.web.admin.service;

import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AdminUserServiceTest {

    @Test
    void flushesLocalDeleteBeforeDeletingKeycloakUser() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserId("target"))
                .thenReturn(Optional.of(profile));
        final AdminUserService service = service(userProfileService, logPersister, keycloakService);

        service.deleteUser("target", true, adminJwt());

        final InOrder order = inOrder(userProfileService, keycloakService);
        order.verify(userProfileService).deleteForAdministration(profile);
        order.verify(keycloakService).deleteUser("target");
    }

    @Test
    void databaseConstraintFailureDoesNotDeleteKeycloakUser() {
        final UserProfileService userProfileService = mock(UserProfileService.class);
        final KeycloakAdminUserService keycloakService = mock(KeycloakAdminUserService.class);
        final AdminUserLogPersister logPersister = logPersister();
        final UserProfile profile = new UserProfile();
        when(userProfileService.findEntityByKeycloakUserId("target"))
                .thenReturn(Optional.of(profile));
        doThrow(new DataIntegrityViolationException("foreign key"))
                .when(userProfileService).deleteForAdministration(profile);
        final AdminUserService service = service(userProfileService, logPersister, keycloakService);

        assertThrows(AdminConflictException.class,
                () -> service.deleteUser("target", true, adminJwt()));

        verifyNoInteractions(keycloakService);
    }

    private static AdminUserService service(
            final UserProfileService userProfileService,
            final AdminUserLogPersister logPersister,
            final KeycloakAdminUserService keycloakService) {
        return new AdminUserService(
                userProfileService,
                new AdminUserMapper(),
                logPersister,
                keycloakService
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
