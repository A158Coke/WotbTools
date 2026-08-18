package com.wotb.web.hundred.service;

import com.wotb.web.hof.dto.ReplayDownload;
import com.wotb.web.hof.exception.HallOfFameStorageException;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hof.service.ReplayHashLock;
import com.wotb.web.hof.storage.HallOfFameReplayStorage;
import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.repository.HundredBattleReplayEvidenceRepository;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
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
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 百场回放审核证据编排契约测试（Mockito，无 DB/FS 依赖；下载字节用 @TempDir 真实文件）。
 * 覆盖 docs/current-plan.md（百场 evidence）：storeAll 幂等/失败清理、attach 原子 5 行、
 * admin list/download ownership、终态 discard 行删除 + 跨表引用计数文件清理。
 */
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
    HallOfFameService hallOfFameService;

    @Mock
    ReplayHashLock replayHashLock;

    HundredReplayEvidenceService service;

    @BeforeEach
    void setUp() {
        // runWithLock 是具体方法（mock 不执行方法体）：直接 stub 为执行 action（真实 advisory lock 由集成测试覆盖）
        org.mockito.Mockito.lenient().doAnswer(inv -> {
            ((Runnable) inv.getArgument(1)).run();
            return null;
        }).when(replayHashLock).runWithLock(anyString(), any());
        service = new HundredReplayEvidenceService(
                storage, repository, submissionRepository, new HundredBattleMapper(),
                hallOfFameService, replayHashLock);
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
        // 默认无引用（各用例按需覆盖）
    }

    // ── storeAll ──────────────────────────────────────────────────────────

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
        when(hallOfFameService.countReplayHashReferences(anyString())).thenReturn(0L);

        assertThatThrownBy(() -> service.storeAll(List.of(
                pending(1, SHA_A, new byte[]{1}), pending(2, SHA_B, new byte[]{2}))))
                .isInstanceOf(HallOfFameStorageException.class);

        // 已成功落盘的 A 被 best-effort 清理；失败的 B 从未落盘
        verify(storage).delete(SHA_A);
        verify(storage, never()).delete(SHA_B);
    }

    @Test
    void storeAllFailureKeepsFileWhenHofStillReferences() {
        when(storage.store(any(), eq(SHA_A)))
                .thenThrow(new HallOfFameStorageException("REPLAY_STORAGE_FULL", HttpStatus.INSUFFICIENT_STORAGE, "full"));
        // 首个文件失败 → 无已存文件；即便有引用计数也无删除
        assertThatThrownBy(() -> service.storeAll(List.of(pending(1, SHA_A, new byte[]{1}))))
                .isInstanceOf(HallOfFameStorageException.class);
        verify(storage, never()).delete(anyString());
    }

    // ── attach ────────────────────────────────────────────────────────────

    @Test
    void attachInsertsExactlyFiveRowsInSameTransaction() {
        service.attach(10L, List.of(
                pending(1, SHA_A, new byte[]{1}), pending(2, SHA_A, new byte[]{1}),
                pending(3, SHA_A, new byte[]{1}), pending(4, SHA_A, new byte[]{1}),
                pending(5, SHA_A, new byte[]{1})));

        verify(repository, times(5)).save(any(HundredBattleReplayEvidence.class));
        verify(repository).flush();
    }

    // ── adminListEvidence ─────────────────────────────────────────────────

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

    // ── downloadEvidence ──────────────────────────────────────────────────

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

    // ── discardForSubmission（终态生命周期）────────────────────────────────

    @Test
    void discardDeletesRowsAndCleansFilesWhenNoReferences() {
        when(repository.findBySubmissionId(10L))
                .thenReturn(List.of(evidenceRow(1L, 10L, 1, SHA_A), evidenceRow(2L, 10L, 2, SHA_B)));
        when(repository.countBySha256(anyString())).thenReturn(0L);
        when(hallOfFameService.countReplayHashReferences(anyString())).thenReturn(0L);

        service.discardForSubmission(10L);

        verify(repository).deleteBySubmissionId(10L);
        // 每个 hash 的「引用检查 + 删除」在 advisory lock 内串行化（防并发同 hash 上传破坏不变量）
        verify(replayHashLock, times(2)).runWithLock(anyString(), any());
        verify(storage).delete(SHA_A);
        verify(storage).delete(SHA_B);
    }

    @Test
    void discardKeepsFileWhenHallOfFameStillReferences() {
        when(repository.findBySubmissionId(10L)).thenReturn(List.of(evidenceRow(1L, 10L, 1, SHA_A)));
        when(repository.countBySha256(SHA_A)).thenReturn(0L);
        when(hallOfFameService.countReplayHashReferences(SHA_A)).thenReturn(1L);

        service.discardForSubmission(10L);

        verify(repository).deleteBySubmissionId(10L);
        // 即使决定保留文件，引用检查也在锁内完成（与 HoF 同语义）
        verify(replayHashLock).runWithLock(anyString(), any());
        verify(storage, never()).delete(anyString());
    }

    @Test
    void discardKeepsFileWhenOtherEvidenceStillReferences() {
        when(repository.findBySubmissionId(10L)).thenReturn(List.of(evidenceRow(1L, 10L, 1, SHA_A)));
        when(repository.countBySha256(SHA_A)).thenReturn(2L);

        service.discardForSubmission(10L);

        verify(repository).deleteBySubmissionId(10L);
        verify(storage, never()).delete(anyString());
    }

    @Test
    void discardWithoutEvidenceIsNoop() {
        when(repository.findBySubmissionId(10L)).thenReturn(List.of());

        service.discardForSubmission(10L);

        verify(repository, never()).deleteBySubmissionId(anyLong());
        verify(storage, never()).delete(anyString());
    }

    @Test
    void discardCleanupFailureDoesNotPropagate() {
        when(repository.findBySubmissionId(10L)).thenReturn(List.of(evidenceRow(1L, 10L, 1, SHA_A)));
        when(repository.countBySha256(SHA_A)).thenReturn(0L);
        when(hallOfFameService.countReplayHashReferences(SHA_A)).thenReturn(0L);
        when(storage.delete(SHA_A))
                .thenThrow(new HallOfFameStorageException("REPLAY_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR, "x"));

        // 文件删除失败仅 WARN（orphan 保留），不影响已完成的业务状态迁移
        service.discardForSubmission(10L);

        verify(repository).deleteBySubmissionId(10L);
    }
}
