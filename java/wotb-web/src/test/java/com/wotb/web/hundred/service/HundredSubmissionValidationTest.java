package com.wotb.web.hundred.service;

import com.wotb.core.model.Battle;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.testsupport.ReplayFactsJson;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.multipart.MultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HundredSubmissionValidationTest extends HundredSubmissionTestSupport {


    @Test
    void validSubmissionCreatesPendingWithFrozenSnapshot() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));

        final ArgumentCaptor<HundredBattleSubmission> captor =
                ArgumentCaptor.forClass(HundredBattleSubmission.class);
        verify(repository).saveAndFlush(captor.capture());
        final HundredBattleSubmission s = captor.getValue();
        assertThat(s.getStatus()).isEqualTo("PENDING");
        assertThat(s.getWotbServer()).isEqualTo(WOTB_SERVER);
        assertThat(s.getWotbAccountId()).isEqualTo(GAME_ID);
        assertThat(s.getVehicleId()).isEqualTo(TIER10_VEHICLE);
        assertThat(s.getVehicleName()).isEqualTo("Progetto 65");
        assertThat(s.getNicknameSnapshot()).isEqualTo("PlayerOne");
        assertThat(s.getClaimedAverageDamage()).isEqualTo(4200);
        assertThat(s.getClaimedBattleCount()).isEqualTo(136);
        assertThat(s.getProofScreenshot()).isEqualTo("data:image/png;base64,AAAA");
        assertThat(s.isReplayParseOk()).isTrue();
        assertThat(s.isReplayGameIdMatch()).isTrue();
        assertThat(s.isReplayVehicleMatch()).isTrue();
        assertThat(s.isReplayDistinctBattles()).isTrue();
    }

    @Test
    void rejectsWhenReplayCapacityIsOccupiedBeforeReadingOrPersistingEvidence() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        final List<MultipartFile> files = fiveReplays();
        final List<String> replayFacts = facts(files);
        final List<MultipartFile> observedFiles = files.stream()
                .map(file -> (MultipartFile) spy(file))
                .toList();
        final ReplayCapacityLimiter singlePermitLimiter = new ReplayCapacityLimiter(1);
        final HundredBattleSubmissionService limitedService = new HundredBattleSubmissionService(
                repository, new HundredBattleMapper(), userProfileService, evidenceService,
                singlePermitLimiter, replayHashLock, transactionManager);

        assertThatThrownBy(() -> singlePermitLimiter.execute(() -> limitedService.createSubmission(
                USER, TIER10_VEHICLE, 4200, 136, "data:image/png;base64,AAAA", observedFiles, replayFacts)))
                .isInstanceOf(ReplayBusyException.class)
                .hasMessage("REPLAY_BUSY");

        for (final MultipartFile file : observedFiles) {
            verify(file, never()).getBytes();
        }
        verify(evidenceService, never()).storeAll(anyList());
        verify(evidenceService, never()).attach(anyLong(), anyList());
        verify(evidenceService, never()).cleanupStoredFiles(anyList());
        verify(repository, never()).saveAndFlush(any());
        verify(transactionManager, never()).getTransaction(any());
        verify(replayHashLock, never()).runWithLocksResult(anyList(), any());
        verify(repository, never()).findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                anyString(), anyLong(), anyLong(), anyString());
    }

    @Test
    void trustedWgUserCanSubmitBeforeVisitingProfilePage() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER))
                .thenReturn(Optional.empty(), Optional.of(profile()));
        when(userProfileService.hasTrustedWargamingIdentity()).thenReturn(true);

        final var result = service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));

        assertThat(result.status()).isEqualTo("PENDING");

        verify(userProfileService).synchronizeFromLogin(USER);
        verify(userProfileService, org.mockito.Mockito.times(2)).findSnapshotByKeycloakUserId(USER);
        verify(repository).saveAndFlush(any());
    }

    @Test
    void nonWgUserWithoutProfileStillGetsProfileNotFound() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.empty());
        when(userProfileService.hasTrustedWargamingIdentity()).thenReturn(false);

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("PROFILE_NOT_FOUND");

        verify(userProfileService, never()).synchronizeFromLogin(anyString());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void existingProfileDoesNotTriggerLoginSynchronization() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        final var result = service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));

        assertThat(result.status()).isEqualTo("PENDING");
        verify(userProfileService, never()).hasTrustedWargamingIdentity();
        verify(userProfileService, never()).synchronizeFromLogin(anyString());
    }

    @Test
    void loginSynchronizationFailureKeepsItsErrorAndStopsSubmission() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.empty());
        when(userProfileService.hasTrustedWargamingIdentity()).thenReturn(true);
        doThrow(new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED"))
                .when(userProfileService).synchronizeFromLogin(USER);

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("WOTB_ACCOUNT_ALREADY_USED");
        verify(userProfileService).findSnapshotByKeycloakUserId(USER);
        verify(repository, never()).saveAndFlush(any());
        verify(evidenceService, never()).storeAll(anyList());
    }

    @Test
    void rejectsWhenProfileMissingGameId() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profileWithoutGameId()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_PROFILE_GAME_ID_REQUIRED");
    }

    @Test
    void rejectsWhenProfileMissingNickname() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profileWithoutNickname()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_PROFILE_NICKNAME_REQUIRED");
    }

    @Test
    void rejectsInvalidClaimValues() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 0, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_INVALID_CLAIM");
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, -1,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_INVALID_CLAIM");
    }

    @Test
    void rejectsNonTierXVehicle() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER7_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_NON_TIER_X");
    }

    @Test
    void rejectsUnknownVehicle() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, 999999L, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_NON_TIER_X");
    }

    @Test
    void rejectsMissingScreenshot() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "  ", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("PROOF_SCREENSHOT_REQUIRED");
    }

    @Test
    void rejectsInvalidScreenshotData() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "not-a-data-url", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("INVALID_IMAGE_DATA");
    }

    @Test
    void rejectsOversizedScreenshot() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        final String huge = "data:image/png;base64," + "x".repeat(5_500_000);
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                huge, fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("IMAGE_TOO_LARGE");
    }

    @Test
    void rejectsReplayCountBelowFive() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", replays(3), facts(replays(3))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_COUNT");
    }

    @Test
    void rejectsReplayCountAboveFive() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", replays(7), facts(replays(7))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_COUNT");
    }

    @Test
    void rejectsMissingReplayFacts() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("REPLAY_FACTS_COUNT_MISMATCH");
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("REPLAY_FACTS_COUNT_MISMATCH");
        verify(repository, never()).saveAndFlush(any());
        verify(evidenceService, never()).storeAll(anyList());
    }

    @Test
    void rejectsReplayFactsCountMismatch() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(replays(4, "a1", "a2", "a3", "a4"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("REPLAY_FACTS_COUNT_MISMATCH");
        verify(repository, never()).saveAndFlush(any());
        verify(evidenceService, never()).storeAll(anyList());
    }

    @Test
    void rejectsInvalidReplayFacts() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), invalidFacts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("INVALID_REPLAY_FACTS");
        final List<String> oneBroken = new ArrayList<>(facts(fiveReplays()));
        final Battle noTeam = battle("a3");
        noTeam.players.getFirst().team = 0;
        oneBroken.set(2, ReplayFactsJson.of(noTeam));
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), oneBroken))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("INVALID_REPLAY_FACTS");
        verify(repository, never()).saveAndFlush(any());
        verify(evidenceService, never()).storeAll(anyList());
    }

    @Test
    void rejectsWrongGameIdInReplay() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(),
                sameFacts(fiveReplays(), battle("a1", 999L, TIER10_VEHICLE))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_GAME_ID_MISMATCH");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsWrongVehicleInReplay() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(),
                sameFacts(fiveReplays(), battle("a1", GAME_ID, 999L))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_VEHICLE_MISMATCH");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsDuplicateBattleAmongFiveReplays() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        final List<MultipartFile> files = replays(5, "a1", "a2", "a2", "a3", "a4");
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", files, facts(files)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        verify(repository, never()).saveAndFlush(any());
    }


    @Test
    void rejectsWhenSameUserSameVehicleAlreadyPending() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "PENDING"))
                .thenReturn(true);

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_PENDING_EXISTS");
        verify(repository, never()).saveAndFlush(any());
    }
}
