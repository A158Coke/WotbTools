package com.wotb.web.admin.service;

import com.wotb.web.admin.dto.DeleteUserResult;
import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.UserProfileSnapshot;
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminUserDeleteTest {

    private static final int MAX_DELETE_BATCH = 100;

    private final UserProfiles userProfileService = mock(UserProfiles.class);
    private final AdminUserMapper mapper = mock(AdminUserMapper.class);
    private final AdminUserLogPersister logPersister = mock(AdminUserLogPersister.class);
    private final KeycloakAdminUserService keycloakAdminUserService = mock(KeycloakAdminUserService.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);

    private AdminUserService service() {
        return new AdminUserService(userProfileService, mapper, logPersister,
                keycloakAdminUserService, txManager);
    }

    @BeforeEach
    void setUp() {
        when(logPersister.save(any(AdminUserLog.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void deletingASingleUserIsJustAListOfSizeOne() {
        when(userProfileService.findSnapshotByKeycloakUserIdForUpdate("kc-a")).thenReturn(Optional.empty());

        final DeleteUsersResponse response = service().deleteUsers(List.of("kc-a"), true, adminJwt());

        assertEquals(1, response.requested());
        assertEquals(1, response.deleted());
        assertEquals(0, response.failed());
        assertEquals(List.of("kc-a"), response.results().stream().map(DeleteUserResult::userId).toList());
        assertTrue(response.results().getFirst().deleted());
        verify(keycloakAdminUserService).deleteUser("kc-a");
    }

    @Test
    void reportsPerUserResultAndNeverPartiallyDeletesTheFailedUser() {
        final UserProfileSnapshot profileA = profile("kc-a");
        final UserProfileSnapshot profileB = profile("kc-b");
        when(userProfileService.findSnapshotByKeycloakUserIdForUpdate("kc-a")).thenReturn(Optional.of(profileA));
        when(userProfileService.findSnapshotByKeycloakUserIdForUpdate("kc-b")).thenReturn(Optional.of(profileB));
        when(userProfileService.findSnapshotByKeycloakUserIdForUpdate("kc-c")).thenReturn(Optional.empty());
        doThrow(new DataIntegrityViolationException("fk"))
                .when(userProfileService).deleteForAdministration("kc-b");

        final DeleteUsersResponse response = service().deleteUsers(
                List.of("kc-a", "kc-b", "kc-c"), true, adminJwt());

        assertEquals(3, response.requested());
        assertEquals(2, response.deleted());
        assertEquals(1, response.failed());
        assertEquals(List.of("kc-a", "kc-b", "kc-c"),
                response.results().stream().map(DeleteUserResult::userId).toList());

        assertTrue(response.results().get(0).deleted());
        assertFalse(response.results().get(1).deleted());
        assertEquals("USER_HAS_DEPENDENCIES", response.results().get(1).errorCode());
        assertTrue(response.results().get(2).deleted());
        assertNull(response.results().get(0).errorCode());

        verify(keycloakAdminUserService, never()).deleteUser("kc-b");
        verify(keycloakAdminUserService).deleteUser("kc-a");
        verify(keycloakAdminUserService).deleteUser("kc-c");
        verify(txManager, atLeastOnce()).rollback(nullable(TransactionStatus.class));
    }

    @Test
    void rejectsSelfDeleteForThatEntryOnlyWithoutFailingTheRequest() {
        when(userProfileService.findSnapshotByKeycloakUserIdForUpdate("kc-a")).thenReturn(Optional.empty());

        final DeleteUsersResponse response = service().deleteUsers(
                List.of("admin-sub", "kc-a"), true, adminJwt());

        assertEquals(2, response.requested());
        assertEquals(1, response.deleted());
        assertEquals(1, response.failed());
        assertEquals("CANNOT_DELETE_SELF", response.results().get(0).errorCode());
        assertTrue(response.results().get(1).deleted());
        verify(keycloakAdminUserService, never()).deleteUser("admin-sub");
        verify(keycloakAdminUserService).deleteUser("kc-a");
    }

    @Test
    void requiresExplicitConfirmationForTheWholeRequest() {
        final AdminBadRequestException exception = assertThrows(AdminBadRequestException.class,
                () -> service().deleteUsers(List.of("kc-a"), false, adminJwt()));
        assertEquals("CONFIRMATION_REQUIRED", exception.getErrorCode());
        verify(keycloakAdminUserService, never()).deleteUser(anyString());
    }

    @Test
    void enforcesThePerRequestIdLimit() {
        final List<String> tooMany = IntStream.rangeClosed(0, MAX_DELETE_BATCH)
                .mapToObj(index -> "kc-" + index)
                .toList();
        final AdminBadRequestException exception = assertThrows(AdminBadRequestException.class,
                () -> service().deleteUsers(tooMany, true, adminJwt()));
        assertEquals("BULK_LIMIT_EXCEEDED", exception.getErrorCode());
        verify(keycloakAdminUserService, never()).deleteUser(anyString());
    }

    @Test
    void deduplicatesIdsSoTheSameUserIsNotDeletedTwice() {
        when(userProfileService.findSnapshotByKeycloakUserIdForUpdate("kc-a")).thenReturn(Optional.empty());

        final DeleteUsersResponse response = service().deleteUsers(
                List.of("kc-a", " kc-a ", "kc-a"), true, adminJwt());

        assertEquals(1, response.requested());
        assertEquals(1, response.deleted());
        verify(keycloakAdminUserService).deleteUser("kc-a");
    }

    private static UserProfileSnapshot profile(final String keycloakUserId) {
        return new UserProfileSnapshot(1L, keycloakUserId, null, 100L,
                null, null, null, null);
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("admin-sub")
                .claim("preferred_username", "admin-user")
                .build();
    }
}
