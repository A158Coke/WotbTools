package com.wotb.web.boost.service;

import com.wotb.web.admin.service.KeycloakAdminUserService;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
import com.wotb.web.boost.repository.BoosterProfileRepository;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.AssertionsForClassTypes.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BoosterServiceTest {

    @Mock
    BoosterProfileRepository boosterRepository;

    @Mock
    BoosterMapper mapper;

    @Mock
    UserProfileService userProfileService;

    @Mock
    KeycloakAdminUserService keycloakAdminUserService;

    @Mock
    BoostRequestAssignmentRepository assignmentRepository;

    @Mock
    BoosterApplicationRepository applicationRepository;

    BoosterService service;

    @BeforeEach
    void setUp() {
        service = new BoosterService(
                boosterRepository,
                mapper,
                userProfileService,
                keycloakAdminUserService,
                assignmentRepository,
                applicationRepository
        );
    }

    @Test
    void shouldRejectDuplicateKeycloakUserId() {
        when(userProfileService.findEntityByKeycloakUserIdForUpdate(eq("kc-user-1")))
                .thenReturn(Optional.of(profile("kc-user-1")));
        when(boosterRepository.findByKeycloakUserId(eq("kc-user-1")))
                .thenReturn(Optional.of(booster(8L, "kc-user-1")));

        assertThatThrownBy(() -> service.create("TestBooster", "ELITE",
                "kc-user-1", true, "ACTIVE",
                "QQ", "123", "medium tanks", "professional"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("ALREADY_BOOSTER");

        verifyNoInteractions(keycloakAdminUserService);
    }

    @Test
    void shouldRejectWhenUserProfileNotFound() {
        when(userProfileService.findEntityByKeycloakUserIdForUpdate(eq("kc-unknown")))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.create("TestBooster", "ELITE",
                "kc-unknown", true, "ACTIVE",
                "QQ", "123", "medium tanks", "professional"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("USER_PROFILE_NOT_FOUND");

        verifyNoInteractions(keycloakAdminUserService);
    }

    @Test
    void shouldRejectEmptyNickname() {
        assertThatThrownBy(() -> service.create("", "ELITE",
                null, true, "ACTIVE",
                "QQ", "123", null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("BOOSTER_NICKNAME_REQUIRED");
    }

    @Test
    void shouldRejectNullLevel() {
        assertThatThrownBy(() -> service.create("TestBooster", null,
                null, true, "ACTIVE",
                "QQ", "123", null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("BOOSTER_LEVEL_REQUIRED");
    }

    @Test
    void shouldRejectInvalidLevel() {
        assertThatThrownBy(() -> service.create("TestBooster", "GOD",
                null, true, "ACTIVE",
                "QQ", "123", null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("UNKNOWN_BOOSTER_LEVEL");
    }

    @Test
    void shouldPersistBoosterBeforeAssigningRole() {
        final BoosterDto expected = dto(7L, "kc-new", true);
        when(userProfileService.findEntityByKeycloakUserIdForUpdate(eq("kc-new")))
                .thenReturn(Optional.of(profile("kc-new")));
        when(boosterRepository.findByKeycloakUserId(eq("kc-new"))).thenReturn(Optional.empty());
        when(keycloakAdminUserService.hasRealmRole("kc-new", "booster")).thenReturn(false);
        when(boosterRepository.saveAndFlush(any())).thenAnswer(invocation -> {
            final BoosterProfile booster = invocation.getArgument(0);
            booster.setId(7L);
            return booster;
        });
        when(mapper.toDto(any())).thenReturn(expected);

        final BoosterDto result = service.create("TestBooster", "ELITE",
                "kc-new", true, "ACTIVE",
                "QQ", "123", "medium tanks", "professional");

        final InOrder inOrder = inOrder(keycloakAdminUserService, boosterRepository);
        inOrder.verify(boosterRepository).saveAndFlush(any());
        inOrder.verify(keycloakAdminUserService).addRealmRole("kc-new", "booster");
        assertThat(result).isSameAs(expected);
    }

    @Test
    void shouldNotChangeRoleWhenCreatePersistenceFails() {
        when(userProfileService.findEntityByKeycloakUserIdForUpdate(eq("kc-new")))
                .thenReturn(Optional.of(profile("kc-new")));
        when(boosterRepository.findByKeycloakUserId(eq("kc-new"))).thenReturn(Optional.empty());
        when(boosterRepository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("duplicate"));

        assertThatThrownBy(() -> service.create("TestBooster", "ELITE",
                "kc-new", true, "ACTIVE",
                "QQ", "123", null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("ALREADY_BOOSTER");

        verify(boosterRepository).saveAndFlush(any());
        verifyNoInteractions(keycloakAdminUserService);
    }

    @Test
    void shouldPreservePreexistingRoleWhenCreatingProfile() {
        when(userProfileService.findEntityByKeycloakUserIdForUpdate(eq("kc-new")))
                .thenReturn(Optional.of(profile("kc-new")));
        when(boosterRepository.findByKeycloakUserId(eq("kc-new"))).thenReturn(Optional.empty());
        when(keycloakAdminUserService.hasRealmRole("kc-new", "booster")).thenReturn(true);
        when(boosterRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(mapper.toDto(any())).thenReturn(dto(7L, "kc-new", true));

        service.create("TestBooster", "ELITE",
                "kc-new", true, "ACTIVE",
                "QQ", "123", null, null);

        verify(keycloakAdminUserService, never()).addRealmRole(any(), any());
        verify(keycloakAdminUserService, never()).removeRealmRole(any(), any());
    }

    @Test
    void shouldRemoveNewRoleWhenOuterApprovalTransactionRollsBack() {
        when(userProfileService.findEntityByKeycloakUserIdForUpdate(eq("kc-new")))
                .thenReturn(Optional.of(profile("kc-new")));
        when(boosterRepository.findByKeycloakUserId(eq("kc-new"))).thenReturn(Optional.empty());
        when(keycloakAdminUserService.hasRealmRole("kc-new", "booster")).thenReturn(false);
        when(boosterRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(mapper.toDto(any())).thenReturn(dto(7L, "kc-new", true));

        TransactionSynchronizationManager.initSynchronization();
        try {
            service.create("TestBooster", "ELITE", "kc-new", true, "ACTIVE",
                    "QQ", "123", null, null);

            TransactionSynchronizationManager.getSynchronizations().forEach(synchronization ->
                    synchronization.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK)
            );
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        verify(keycloakAdminUserService).removeRealmRole("kc-new", "booster");
    }

    @Test
    void shouldRejectNullAvailabilityToggle() {
        assertThatThrownBy(() -> service.setAvailability(7L, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("BOOSTER_AVAILABILITY_REQUIRED");
    }

    @Test
    void shouldUpdateAvailabilityForExistingBooster() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        booster.setAvailable(true);
        booster.setUpdatedAt(OffsetDateTime.parse("2026-07-01T00:00:00Z"));
        final BoosterDto dto = dto(7L, "kc-booster", false);
        when(boosterRepository.findById(eq(7L))).thenReturn(Optional.of(booster));
        when(boosterRepository.saveAndFlush(eq(booster))).thenReturn(booster);
        when(mapper.toDto(eq(booster))).thenReturn(dto);

        final BoosterDto result = service.setAvailability(7L, false);

        assertThat(result.available()).isFalse();
        assertThat(booster.getAvailable()).isFalse();
        verify(boosterRepository).saveAndFlush(eq(booster));
    }

    @Test
    void shouldRejectDeleteBeforeChangingRoleWhenDependenciesExist() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        when(assignmentRepository.existsByBoosterId(7L)).thenReturn(true);

        assertThatThrownBy(() -> service.deleteById(7L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("BOOSTER_HAS_DEPENDENCIES");

        verifyNoInteractions(keycloakAdminUserService);
        verifyNoInteractions(applicationRepository);
        verify(boosterRepository, never()).delete(any());
    }

    @Test
    void shouldClearApprovedApplicationRefWhenDeletingBooster() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        final BoosterApplication application = applicationWithRef(7L);
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        when(assignmentRepository.existsByBoosterId(7L)).thenReturn(false);
        when(applicationRepository.findByApprovedBoosterId(7L))
                .thenReturn(List.of(application));
        when(keycloakAdminUserService.hasRealmRole("kc-booster", "booster")).thenReturn(true);

        service.deleteById(7L);

        final InOrder inOrder = inOrder(applicationRepository, boosterRepository, keycloakAdminUserService);
        inOrder.verify(applicationRepository).findByApprovedBoosterId(7L);
        inOrder.verify(applicationRepository).flush();
        inOrder.verify(boosterRepository).delete(booster);
        inOrder.verify(boosterRepository).flush();
        inOrder.verify(keycloakAdminUserService).removeRealmRole("kc-booster", "booster");
        assertThat(application.getApprovedBoosterId()).isNull();
        assertThat(application.getUpdatedAt()).isNotNull();
    }

    @Test
    void shouldDeleteByKeycloakUserIdUsingLockedLookup() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findByKeycloakUserIdForUpdate("kc-booster"))
                .thenReturn(Optional.of(booster));

        service.deleteByKeycloakUserId("  kc-booster  ");

        verify(boosterRepository).findByKeycloakUserIdForUpdate("kc-booster");
        verify(boosterRepository).delete(booster);
        verify(boosterRepository).flush();
        verify(boosterRepository, never()).findByIdForUpdate(any());
    }

    @Test
    void shouldDoNothingWhenKeycloakUserHasNoBooster() {
        when(boosterRepository.findByKeycloakUserIdForUpdate("kc-user"))
                .thenReturn(Optional.empty());

        service.deleteByKeycloakUserId("kc-user");

        verifyNoInteractions(applicationRepository, keycloakAdminUserService);
        verify(boosterRepository, never()).delete(any());
    }

    @Test
    void shouldMapApplicationFlushFailureBeforeDeletingBooster() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        doThrow(new DataIntegrityViolationException("application foreign key"))
                .when(applicationRepository).flush();

        assertThatThrownBy(() -> service.deleteById(7L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("BOOSTER_HAS_DEPENDENCIES");

        verify(boosterRepository, never()).delete(any());
        verify(boosterRepository, never()).flush();
        verifyNoInteractions(keycloakAdminUserService);
    }

    @Test
    void shouldNotChangeRoleWhenDeleteFlushFails() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        doThrow(new DataIntegrityViolationException("foreign key"))
                .when(boosterRepository).flush();

        assertThatThrownBy(() -> service.deleteById(7L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("BOOSTER_HAS_DEPENDENCIES");

        verify(boosterRepository).delete(booster);
        verify(boosterRepository).flush();
        verifyNoInteractions(keycloakAdminUserService);
    }

    @Test
    void shouldDeleteProfileBeforeRemovingRole() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        when(keycloakAdminUserService.hasRealmRole("kc-booster", "booster")).thenReturn(true);

        service.deleteById(7L);

        final InOrder inOrder = inOrder(boosterRepository, applicationRepository, keycloakAdminUserService);
        inOrder.verify(boosterRepository).findByIdForUpdate(7L);
        inOrder.verify(applicationRepository).findByApprovedBoosterId(7L);
        inOrder.verify(applicationRepository).flush();
        inOrder.verify(boosterRepository).delete(booster);
        inOrder.verify(boosterRepository).flush();
        inOrder.verify(keycloakAdminUserService).removeRealmRole("kc-booster", "booster");
    }

    @Test
    void shouldDeleteProfileWhenKeycloakUserIsAlreadyMissing() {
        final BoosterProfile booster = booster(7L, "kc-missing");
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        when(keycloakAdminUserService.hasRealmRole("kc-missing", "booster"))
                .thenThrow(new IllegalArgumentException("KEYCLOAK_USER_NOT_FOUND"));

        service.deleteById(7L);

        verify(boosterRepository).delete(booster);
        verify(boosterRepository).flush();
        verify(keycloakAdminUserService, never()).removeRealmRole(any(), any());
    }

    @Test
    void shouldDeleteProfileWhenKeycloakUserDisappearsBeforeRoleRemoval() {
        final BoosterProfile booster = booster(7L, "kc-missing");
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        when(keycloakAdminUserService.hasRealmRole("kc-missing", "booster")).thenReturn(true);
        doThrow(new IllegalArgumentException("KEYCLOAK_USER_OR_ROLE_NOT_FOUND"))
                .when(keycloakAdminUserService).removeRealmRole("kc-missing", "booster");

        service.deleteById(7L);

        verify(boosterRepository).delete(booster);
        verify(boosterRepository).flush();
        verify(keycloakAdminUserService).removeRealmRole("kc-missing", "booster");
    }

    @Test
    void shouldRestoreRemovedRoleWhenDeleteTransactionRollsBack() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findByIdForUpdate(7L)).thenReturn(Optional.of(booster));
        when(keycloakAdminUserService.hasRealmRole("kc-booster", "booster")).thenReturn(true);

        TransactionSynchronizationManager.initSynchronization();
        try {
            service.deleteById(7L);

            TransactionSynchronizationManager.getSynchronizations().forEach(synchronization ->
                    synchronization.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK)
            );
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        verify(keycloakAdminUserService).addRealmRole("kc-booster", "booster");
    }

    @Test
    void shouldMoveRolesWhenRebindingBooster() {
        final BoosterProfile booster = booster(7L, "kc-old");
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-new"))
                .thenReturn(Optional.of(profile("kc-new")));
        when(boosterRepository.findByKeycloakUserId("kc-new")).thenReturn(Optional.empty());
        when(keycloakAdminUserService.hasRealmRole("kc-new", "booster")).thenReturn(false);
        when(keycloakAdminUserService.hasRealmRole("kc-old", "booster")).thenReturn(true);
        when(boosterRepository.saveAndFlush(booster)).thenReturn(booster);
        when(mapper.toDto(booster)).thenReturn(dto(7L, "kc-new", true));

        service.update(7L, null, null, "kc-new", null,
                null, null, null, null, null);

        final InOrder inOrder = inOrder(keycloakAdminUserService, boosterRepository);
        inOrder.verify(boosterRepository).saveAndFlush(booster);
        inOrder.verify(keycloakAdminUserService).addRealmRole("kc-new", "booster");
        inOrder.verify(keycloakAdminUserService).removeRealmRole("kc-old", "booster");
        assertThat(booster.getKeycloakUserId()).isEqualTo("kc-new");
    }

    @Test
    void shouldNotChangeRolesWhenRebindPersistenceFails() {
        final BoosterProfile booster = booster(7L, "kc-old");
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-new"))
                .thenReturn(Optional.of(profile("kc-new")));
        when(boosterRepository.findByKeycloakUserId("kc-new")).thenReturn(Optional.empty());
        when(boosterRepository.saveAndFlush(booster))
                .thenThrow(new DataIntegrityViolationException("duplicate"));

        assertThatThrownBy(() -> service.update(7L, null, null, "kc-new", null,
                null, null, null, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("ALREADY_BOOSTER");

        verify(boosterRepository).saveAndFlush(booster);
        verifyNoInteractions(keycloakAdminUserService);
    }

    @Test
    void shouldRestoreBothRolesWhenMapperFailsAfterRebind() {
        final BoosterProfile booster = booster(7L, "kc-old");
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
        when(userProfileService.findEntityByKeycloakUserIdForUpdate("kc-new"))
                .thenReturn(Optional.of(profile("kc-new")));
        when(boosterRepository.findByKeycloakUserId("kc-new")).thenReturn(Optional.empty());
        when(keycloakAdminUserService.hasRealmRole("kc-new", "booster")).thenReturn(false);
        when(keycloakAdminUserService.hasRealmRole("kc-old", "booster")).thenReturn(true);
        when(boosterRepository.saveAndFlush(booster)).thenReturn(booster);
        when(mapper.toDto(booster)).thenThrow(new IllegalStateException("MAPPER_FAILURE"));

        assertThatThrownBy(() -> service.update(7L, null, null, "kc-new", null,
                null, null, null, null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MAPPER_FAILURE");

        final InOrder inOrder = inOrder(keycloakAdminUserService, boosterRepository);
        inOrder.verify(boosterRepository).saveAndFlush(booster);
        inOrder.verify(keycloakAdminUserService).addRealmRole("kc-new", "booster");
        inOrder.verify(keycloakAdminUserService).removeRealmRole("kc-old", "booster");
        inOrder.verify(keycloakAdminUserService).addRealmRole("kc-old", "booster");
        inOrder.verify(keycloakAdminUserService).removeRealmRole("kc-new", "booster");
    }

    private static BoosterProfile booster(final Long id, final String keycloakUserId) {
        final BoosterProfile booster = new BoosterProfile();
        booster.setId(id);
        booster.setNickname("booster");
        booster.setLevel("ELITE");
        booster.setKeycloakUserId(keycloakUserId);
        booster.setAvailable(true);
        booster.setStatus("ACTIVE");
        return booster;
    }

    private static UserProfile profile(final String keycloakUserId) {
        final UserProfile profile = new UserProfile();
        profile.setId(11L);
        profile.setKeycloakUserId(keycloakUserId);
        profile.setDisplayName("Display");
        profile.setUsername("username");
        return profile;
    }

    private static BoosterApplication applicationWithRef(final Long boosterId) {
        final BoosterApplication app = new BoosterApplication();
        app.setId(100L);
        app.setApprovedBoosterId(boosterId);
        return app;
    }

    private static BoosterDto dto(final Long id, final String keycloakUserId, final boolean available) {
        return new BoosterDto(
                id, "booster", "ELITE", keycloakUserId,
                available, "ACTIVE", null, null, null, null,
                0, null, OffsetDateTime.parse("2026-07-09T00:00:00Z")
        );
    }
}
