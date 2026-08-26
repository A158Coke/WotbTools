package com.wotb.web.mark3.service;

import com.wotb.web.mark3.entity.Mark3ReplayEvidence;
import com.wotb.web.mark3.repository.Mark3ReplayEvidenceRepository;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 三环 evidence 的 5 文件门禁与独立 namespace 清理契约。 */
@ExtendWith(MockitoExtension.class)
class Mark3ReplayEvidenceServiceTest {

    private static final String SHA_A = "a".repeat(64);
    private static final String SHA_B = "b".repeat(64);

    @Mock
    Mark3ReplayStorage storage;

    @Mock
    Mark3ReplayEvidenceRepository repository;

    @Mock
    Mark3SubmissionRepository submissionRepository;

    @Mock
    com.wotb.web.replayfile.ReplayHashLock replayHashLock;

    Mark3ReplayEvidenceService service;

    @BeforeEach
    void setUp() {
        service = new Mark3ReplayEvidenceService(
                storage, repository, submissionRepository, new Mark3Mapper(), replayHashLock);
        lenient().doAnswer(invocation -> {
            ((Runnable) invocation.getArgument(1)).run();
            return null;
        }).when(replayHashLock).runWithLock(anyString(), any(Runnable.class));
    }

    @Test
    void attachWritesExactlyFiveRows() {
        service.attach(10L, List.of(
                pending(1, SHA_A), pending(2, SHA_A), pending(3, SHA_A), pending(4, SHA_A), pending(5, SHA_A)));

        verify(repository, times(5)).save(any(Mark3ReplayEvidence.class));
        verify(repository).flush();
    }

    @Test
    void completeEvidenceRequiresFiveFilesAndOneOrTwoScreenshots() {
        final List<Mark3ReplayEvidence> rows = rows();
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(rows);
        rows.forEach(row -> when(storage.load(row.getSha256())).thenReturn(Optional.of(Path.of("stored"))));

        service.requireCompleteEvidenceForApproval(10L, List.of("data:image/png;base64,AAAA"));
        service.requireCompleteEvidenceForApproval(10L, List.of(
                "data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB"));

        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, List.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MARK3_INCOMPLETE_REVIEW_EVIDENCE");
        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, List.of(
                "data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB", "data:image/gif;base64,CCCC")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MARK3_INCOMPLETE_REVIEW_EVIDENCE");
    }

    @Test
    void discardCleansOnlyUnreferencedFileInMark3Namespace() {
        when(repository.findBySubmissionId(10L)).thenReturn(List.of(
                evidence(1L, 10L, 1, SHA_A), evidence(2L, 10L, 2, SHA_B)));
        when(repository.countBySha256(SHA_A)).thenReturn(0L);
        when(repository.countBySha256(SHA_B)).thenReturn(1L);

        service.discardForSubmission(10L);

        verify(repository).deleteBySubmissionId(10L);
        verify(storage).delete(SHA_A);
        verify(storage, never()).delete(SHA_B);
    }

    @Test
    void missingStoredFileBlocksApprovalWithoutClearingEvidence() {
        final List<Mark3ReplayEvidence> rows = rows();
        when(repository.findBySubmissionIdOrderBySlotAsc(10L)).thenReturn(rows);
        for (int index = 0; index < 4; index++) {
            when(storage.load(rows.get(index).getSha256())).thenReturn(Optional.of(Path.of("stored")));
        }
        when(storage.load(rows.get(4).getSha256())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.requireCompleteEvidenceForApproval(10L, List.of("data:image/png;base64,AAAA")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MARK3_REPLAY_FILE_NOT_FOUND");
        verify(repository, never()).deleteBySubmissionId(10L);
    }

    private static Mark3ReplayEvidenceService.PendingReplay pending(final int slot, final String sha) {
        return new Mark3ReplayEvidenceService.PendingReplay(
                slot, "battle-" + slot + ".wotbreplay", sha, 1L, "arena-" + slot, new byte[]{1});
    }

    private static Mark3ReplayEvidence evidence(final long id, final long submissionId, final int slot, final String sha) {
        final Mark3ReplayEvidence row = new Mark3ReplayEvidence();
        row.setId(id);
        row.setSubmissionId(submissionId);
        row.setSlot(slot);
        row.setOriginalFilename("battle-" + slot + ".wotbreplay");
        row.setSha256(sha);
        row.setFileSize(1L);
        row.setArenaId("arena-" + slot);
        return row;
    }

    private static List<Mark3ReplayEvidence> rows() {
        return List.of(
                evidence(1L, 10L, 1, SHA_A), evidence(2L, 10L, 2, SHA_B),
                evidence(3L, 10L, 3, "c".repeat(64)), evidence(4L, 10L, 4, "d".repeat(64)),
                evidence(5L, 10L, 5, "e".repeat(64)));
    }
}
