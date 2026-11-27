package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.repository.HundredBattleReplayEvidenceRepository;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.HallOfFameStorageException;
import com.wotb.web.replayfile.HofReplayReferenceCounter;
import com.wotb.web.replayfile.ReplayDownload;
import com.wotb.web.replayfile.ReplayHashLock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HundredReplayEvidenceServiceTest {

    private static final String SHA_A = "a".repeat(64);
    private static final String SHA_B = "b".repeat(64);

    @Mock
    HallOfFameReplayStorage storage;

    @Mock
    HundredBattleReplayEvidenceRepository repository;

    @Mock
    HundredBattleSubmissionRepository submissionRepository;

    @Mock
    HofReplayReferenceCounter hofReplayReferenceCounter;

    @Mock
    ReplayHashLock replayHashLock;

    HundredReplayEvidenceService service;

    @BeforeEach
    void setUp() {
        service = new HundredReplayEvidenceService(
                storage, repository, submissionRepository, new HundredBattleMapper(),
                hofReplayReferenceCounter, replayHashLock);
        lenient().doAnswer(invocation -> {
            ((Runnable) invocation.getArgument(1)).run();
            return null;
        }).when(replayHashLock).runWithLock(anyString(), any(Runnable.class));
    }

    private static HundredReplayEvidenceService.PendingReplay pending(final int slot, final String sha, final byte[] data) {
        return new HundredReplayEvidenceService.PendingReplay(slot, "b" + slot + ".wotbreplay", sha, data.length, "arena-" + slot, data);
    }

    private static HundredBattleReplayEvidence evidenceRow(final long id, final long submissionId, final int slot, final String sha) {
        final HundredBattleReplayEvidence row = new HundredBattleReplayEvidence();
        row.setId(id);
        row.setSubmissionId(submissionId);
        row.setSlot(slot);
        row.setOriginalFilename("b" + slot + ".wotbreplay");
        row.setSha256(sha);
        row.setFileSize(10);
        row.setArenaId("arena-" + slot);
        return row;
    }

    private static void noRefs() {
    }


    @Test
    void storeAllStoresEveryReplay() {
        when(storage.store(any(), anyString()))
                .thenReturn(new HallOfFameReplayStorage.StoreResult(true, Path.of("t")));

        service.storeAll(List.of(pending(1, SHA_A, new byte[]{1}), pending(2, SHA_B, new byte[]{2})));

        verify(storage, times(2)).store(any(), anyString());
        verify(storage, never()).delete(anyString());
    }

    @Test
    void storeAllFailureCleansUpAlreadyStoredFiles() {
        when(storage.store(any(), eq(SHA_A)))
                .thenReturn(new HallOfFameReplayStorage.StoreResult(true, Path.of("t")));
        when(storage.store(any(), eq(SHA_B)))
                .thenThrow(new HallOfFameStorageException("REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR, "boom"));
        when(repository.countBySha256(anyString())).thenReturn(0L);
        when(hofReplayReferenceCounter.countHofReferences(anyString())).thenReturn(0L);

        assertThatThrownBy(() -> service.storeAll(List.of(
                pending(1, SHA_A, new byte[]{1}), pending(2, SHA_B, new byte[]{2}))))
                .isInstanceOf(HallOfFameStorageException.class);

        verify(storage).delete(SHA_A);
        verify(storage, never()).delete(SHA_B);
    }

    @Test
    void storeAllFailureKeepsFileWhenHofStillReferences() {
        when(storage.store(any(), eq(SHA_A)))
                .thenThrow(new HallOfFameStorageException("REPLAY_STORAGE_FULL", HttpStatus.INSUFFICIENT_STORAGE, "full"));
        assertThatThrownBy(() -> service.storeAll(List.of(pending(1, SHA_A, new byte[]{1}))))
                .isInstanceOf(HallOfFameStorageException.class);
        verify(storage, never()).delete(anyString());
    }


    @Test
    void attachInsertsExactlyFiveRowsInSameTransaction() {
        service.attach(10L, List.of(
                pending(1, SHA_A, new byte[]{1}), pending(2, SHA_A, new byte[]{1}),
                pending(3, SHA_A, new byte[]{1}), pending(4, SHA_A, new byte[]{1}),
                pending(5, SHA_A, new byte[]{1})));

        verify(repository, times(5)).save(any(HundredBattleReplayEvidence.class));
        verify(repository).flush();
    }


    @Test
    void discardDeletesMetadataAndUnreferencedPhysicalFiles() {
        when(repository.findBySubmissionId(10L)).thenReturn(List.of(
                evidenceRow(1L, 10L, 1, SHA_A), evidenceRow(2L, 10L, 2, SHA_B)));
        when(repository.countBySha256(anyString())).thenReturn(0L);
        when(hofReplayReferenceCounter.countHofReferences(anyString())).thenReturn(0L);

        service.discardForSubmission(10L);

        verify(repository).deleteBySubmissionId(10L);
        verify(storage).delete(SHA_A);
        verify(storage).delete(SHA_B);
    }

    @Test
    void discardKeepsPhysicalFileStillReferencedBySingleBattleHof() {
        when(repository.findBySubmissionId(10L))
                .thenReturn(List.of(evidenceRow(1L, 10L, 1, SHA_A)));
        when(repository.countBySha256(SHA_A)).thenReturn(0L);
        when(hofReplayReferenceCounter.countHofReferences(SHA_A)).thenReturn(1L);

        service.discardForSubmission(10L);

        verify(repository).deleteBySubmissionId(10L);
        verify(storage, never()).delete(SHA_A);
    }


    @Test
    void adminListEvidenceRejectsMissingSubmission() {
        when(submissionRepository.existsById(10L)).thenReturn(false);

        assertThatThrownBy(() -> service.adminListEvidence(10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_SUBMISSION_NOT_FOUND");
                });
        verify(repository, never()).findBySubmissionIdOrderBySlotAsc(anyLong());
    }

    @Test
    void adminListEvidenceReturnsMetadataSortedBySlot() {
        when(submissionRepository.existsById(10L)).thenReturn(true);
        when(repository.findBySubmissionIdOrderBySlotAsc(10L))
                .thenReturn(List.of(evidenceRow(1L, 10L, 1, SHA_A), evidenceRow(2L, 10L, 2, SHA_B)));

        final List<HundredReplayEvidenceDto> dtos = service.adminListEvidence(10L);

        assertThat(dtos).hasSize(2);
        assertThat(dtos.get(0).slot()).isEqualTo(1);
        assertThat(dtos.get(0).originalFilename()).isEqualTo("b1.wotbreplay");
        assertThat(dtos.get(0).fileSize()).isEqualTo(10);
        assertThat(dtos.get(0).sha256()).isEqualTo(SHA_A);
        assertThat(dtos.get(0).arenaId()).isEqualTo("arena-1");
    }

    @Test
    void adminListEvidenceEmptyForLegacySubmission() {
        when(submissionRepository.existsById(10L)).thenReturn(true);
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(List.of());

        assertThat(service.adminListEvidence(10L)).isEmpty();
    }


    @Test
    void downloadEvidenceRejectsReplayNotOwnedBySubmission() {
        when(submissionRepository.existsById(10L)).thenReturn(true);
        when(repository.findBySubmissionIdAndId(10L, 99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.downloadEvidence(10L, 99L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_REPLAY_EVIDENCE_NOT_FOUND");
                });
    }

    @Test
    void downloadEvidenceReturns404WhenPhysicalFileMissing() {
        when(submissionRepository.existsById(10L)).thenReturn(true);
        when(repository.findBySubmissionIdAndId(10L, 1L)).thenReturn(Optional.of(evidenceRow(1L, 10L, 1, SHA_A)));
        when(storage.load(SHA_A)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.downloadEvidence(10L, 1L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_REPLAY_FILE_NOT_FOUND");
                });
    }

    @Test
    void downloadEvidenceReturnsOriginalBytesAndFilename(@TempDir final Path dir) throws IOException {
        final byte[] bytes = new byte[]{9, 8, 7, 6};
        final Path file = dir.resolve(SHA_A + ".wotbreplay");
        Files.write(file, bytes);
        when(submissionRepository.existsById(10L)).thenReturn(true);
        when(repository.findBySubmissionIdAndId(10L, 1L)).thenReturn(Optional.of(evidenceRow(1L, 10L, 1, SHA_A)));
        when(storage.load(SHA_A)).thenReturn(Optional.of(file));

        final ReplayDownload download = service.downloadEvidence(10L, 1L);

        assertThat(download.data()).containsExactly(bytes);
        assertThat(download.fileName()).isEqualTo("b1.wotbreplay");
    }


    private static List<HundredBattleReplayEvidence> rows(final int count) {
        final List<HundredBattleReplayEvidence> out = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            out.add(evidenceRow((long) i, 10L, i, SHA_A));
        }
        return out;
    }

    private void filesExist(final List<HundredBattleReplayEvidence> rows) {
        for (final HundredBattleReplayEvidence row : rows) {
            when(storage.load(row.getSha256())).thenReturn(Optional.of(Path.of("t")));
        }
    }

    @Test
    void approvalValidationRejectsZeroEvidenceLegacyPending() {
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(List.of());

        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, "data:image/png;base64,AAAA"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");
    }

    @Test
    void approvalValidationRejectsFourEvidence() {
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(rows(4));

        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, "data:image/png;base64,AAAA"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");
    }

    @Test
    void approvalValidationRejectsIncompleteSlots() {
        final List<HundredBattleReplayEvidence> bad = rows(5);
        bad.get(4).setSlot(4);
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(bad);

        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, "data:image/png;base64,AAAA"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");
    }

    @Test
    void approvalValidationRejectsMissingPhysicalFile() {
        final List<HundredBattleReplayEvidence> complete = rows(5);
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(complete);
        for (int i = 0; i < 4; i++) {
            when(storage.load(complete.get(i).getSha256())).thenReturn(Optional.of(Path.of("t")));
        }
        when(storage.load(complete.get(4).getSha256())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, "data:image/png;base64,AAAA"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_REPLAY_FILE_NOT_FOUND");
    }

    @Test
    void approvalValidationRejectsMissingScreenshot() {
        final List<HundredBattleReplayEvidence> complete = rows(5);
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(complete);
        filesExist(complete);

        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");
        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, "not-a-data-url"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");
    }

    @Test
    void approvalValidationPassesWithCompleteEvidence() {
        final List<HundredBattleReplayEvidence> complete = rows(5);
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(complete);
        filesExist(complete);

        service.requireCompleteEvidenceForApproval(10L, "data:image/png;base64,AAAA");

        verify(storage, never()).delete(anyString());
    }

    @Test
    void countHundredReferencesReturnsOwnCountOnly() {
        when(repository.countBySha256(SHA_A)).thenReturn(1L);
        assertThat(service.countHundredReferences(SHA_A)).isEqualTo(1L);

        when(repository.countBySha256(SHA_A)).thenReturn(0L);
        assertThat(service.countHundredReferences(SHA_A)).isZero();
    }
}
