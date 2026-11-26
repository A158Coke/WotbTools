package com.wotb.web.hundred.service;

import com.wotb.web.replayfile.HallOfFameStorageException;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HundredEvidencePersistenceTest extends HundredSubmissionTestSupport {


    @Test
    void createFailureNeverPersistsSubmission() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", duplicateArenaReplays(), facts(duplicateArenaReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        verify(repository, never()).saveAndFlush(any());
        verify(repository, never()).save(any());
    }


    @Test
    void validSubmissionStoresAndAttachesAllFiveEvidence() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));

        @SuppressWarnings("unchecked")
        final ArgumentCaptor<List<String>> hashCaptor = ArgumentCaptor.forClass(List.class);
        verify(replayHashLock).runWithLocksResult(hashCaptor.capture(), any());
        assertThat(hashCaptor.getValue()).hasSize(5);
        assertThat(hashCaptor.getValue()).isSorted();
        assertThat(hashCaptor.getValue().stream().distinct()).hasSize(5);

        verify(evidenceService).storeAll(anyList());
        @SuppressWarnings("unchecked")
        final ArgumentCaptor<List<HundredReplayEvidenceService.PendingReplay>> captor =
                ArgumentCaptor.forClass(List.class);
        verify(evidenceService).attach(eq(10L), captor.capture());
        final List<HundredReplayEvidenceService.PendingReplay> pending = captor.getValue();
        assertThat(pending).hasSize(5);
        assertThat(pending).extracting(HundredReplayEvidenceService.PendingReplay::slot)
                .containsExactly(1, 2, 3, 4, 5);
        assertThat(pending).extracting(HundredReplayEvidenceService.PendingReplay::originalFilename)
                .containsExactly("battle-0.wotbreplay", "battle-1.wotbreplay", "battle-2.wotbreplay",
                        "battle-3.wotbreplay", "battle-4.wotbreplay");
        assertThat(pending).allSatisfy(p -> {
            assertThat(p.fileSize()).isEqualTo(p.data().length);
            assertThat(p.sha256()).hasSize(64);
        });
        assertThat(pending.get(0).arenaId()).isEqualTo("a1");
        assertThat(pending.get(4).arenaId()).isEqualTo("a5");
    }

    @Test
    void validationFailureNeverStoresOrAttachesEvidence() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", duplicateArenaReplays(), facts(duplicateArenaReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        verify(evidenceService, never()).storeAll(anyList());
        verify(evidenceService, never()).attach(anyLong(), anyList());
        verify(evidenceService, never()).cleanupStoredFiles(anyList());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void storageFailureAbortsSubmissionWithoutPersisting() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        doThrow(new HallOfFameStorageException("REPLAY_STORAGE_FULL",
                org.springframework.http.HttpStatus.INSUFFICIENT_STORAGE, "disk full"))
                .when(evidenceService).storeAll(anyList());

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(HallOfFameStorageException.class);
        verify(repository, never()).saveAndFlush(any());
        verify(evidenceService, never()).attach(anyLong(), anyList());
    }

    @Test
    void pendingUniqueRaceCleansUpStoredFiles() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("uk_hundred_battle_pending_user_vehicle"));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_PENDING_EXISTS");
        verify(evidenceService).storeAll(anyList());
        verify(evidenceService).cleanupStoredFiles(anyList());
        verify(evidenceService, never()).attach(anyLong(), anyList());
    }
}
