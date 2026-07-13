package com.wotb.web.boost.service;

import com.wotb.web.admin.service.KeycloakAdminUserService;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
import com.wotb.web.boost.repository.BoosterProfileRepository;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.user.dto.UserProfileDto;
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
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
        when(userProfileService.findByKeycloakUserId(eq("kc-user-1")))
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
        when(userProfileService.findByKeycloakUserId(eq("kc-unknown"))).thenReturn(Optional.empty());

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
        when(userProfileService.findByKeycloakUserId(eq("kc-new")))
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
        when(userProfileService.findByKeycloakUserId(eq("kc-new")))
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
        when(userProfileService.findByKeycloakUserId(eq("kc-new")))
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
        when(userProfileService.findByKeycloakUserId(eq("kc-new")))
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
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
        when(assignmentRepository.existsByBoosterId(7L)).thenReturn(true);

        assertThatThrownBy(() -> service.deleteById(7L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("BOOSTER_HAS_DEPENDENCIES");

        verifyNoInteractions(keycloakAdminUserService);
        verify(boosterRepository, never()).delete(any());
    }

    @Test
    void shouldRejectDeleteWhenApprovedApplicationReferencesBooster() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
        when(applicationRepository.existsByApprovedBoosterId(7L)).thenReturn(true);

        assertThatThrownBy(() -> service.deleteById(7L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("BOOSTER_HAS_DEPENDENCIES");

        verifyNoInteractions(keycloakAdminUserService);
        verify(boosterRepository, never()).delete(any());
    }

    @Test
    void shouldNotChangeRoleWhenDeletePersistenceFails() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
        doThrow(new DataIntegrityViolationException("foreign key"))
                .when(boosterRepository).delete(booster);

        assertThatThrownBy(() -> service.deleteById(7L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("BOOSTER_HAS_DEPENDENCIES");

        verify(boosterRepository).delete(booster);
        verifyNoInteractions(keycloakAdminUserService);
    }

    @Test
    void shouldDeleteProfileBeforeRemovingRole() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
        when(keycloakAdminUserService.hasRealmRole("kc-booster", "booster")).thenReturn(true);

        service.deleteById(7L);

        final InOrder inOrder = inOrder(boosterRepository, keycloakAdminUserService);
        inOrder.verify(boosterRepository).delete(booster);
        inOrder.verify(boosterRepository).flush();
        inOrder.verify(keycloakAdminUserService).removeRealmRole("kc-booster", "booster");
    }

    @Test
    void shouldRestoreRemovedRoleWhenDeleteTransactionRollsBack() {
        final BoosterProfile booster = booster(7L, "kc-booster");
        when(boosterRepository.findById(7L)).thenReturn(Optional.of(booster));
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
        when(userProfileService.findByKeycloakUserId("kc-new"))
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
        when(userProfileService.findByKeycloakUserId("kc-new"))
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
        when(userProfileService.findByKeycloakUserId("kc-new"))
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

    private static UserProfileDto profile(final String keycloakUserId) {
        return new UserProfileDto(11L, keycloakUserId, "Display", "username",
                1001L, "Player", "CN");
    }

    private static BoosterDto dto(final Long id, final String keycloakUserId, final boolean available) {
        return new BoosterDto(
                id, "booster", "ELITE", keycloakUserId,
                available, "ACTIVE", null, null, null, null,
                0, null, OffsetDateTime.parse("2026-07-09T00:00:00Z")
        );
    }
}
