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

/**
 * 百场 submission 业务契约测试（Mockito，无 DB，任何环境可跑）。
 * 覆盖：submission 校验矩阵 / CURRENT 门槛 / snapshot /
 * approval / terminal transition 竞争 / delete / rank / files。
 */
@ExtendWith(MockitoExtension.class)
class HundredEvidencePersistenceTest extends HundredSubmissionTestSupport {

    // ── Files：创建失败不持久化 ──────────────────────────────────────────

    @Test
    void createFailureNeverPersistsSubmission() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        // 第 2 份与第 1 份同 arena → 失败；已解析的前面文件不应产生任何持久化
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", duplicateArenaReplays(), facts(duplicateArenaReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        verify(repository, never()).saveAndFlush(any());
        verify(repository, never()).save(any());
    }

    // ── Evidence 持久化（V19：5 个 replay 内容寻址落盘 + metadata 入库）──────────

    @Test
    void validSubmissionStoresAndAttachesAllFiveEvidence() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));

        // 锁协议：整段临界区在 sorted distinct hash locks 内（Blocker 2）
        @SuppressWarnings("unchecked")
        final ArgumentCaptor<List<String>> hashCaptor = ArgumentCaptor.forClass(List.class);
        verify(replayHashLock).runWithLocksResult(hashCaptor.capture(), any());
        assertThat(hashCaptor.getValue()).hasSize(5);
        // 稳定顺序 + 去重（防 deadlock）
        assertThat(hashCaptor.getValue()).isSorted();
        assertThat(hashCaptor.getValue().stream().distinct()).hasSize(5);

        // 5 个 replay 全部落盘（锁内）
        verify(evidenceService).storeAll(anyList());
        // attach 收到恰好 5 行，slot 1..5、原始文件名、内容寻址 hash（SHA-256 of arena bytes）
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
        // fileSize 与原始字节一致；sha256 为真实 SHA-256（不是用户提供的路径/文件名）
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

        // 第 2 份与第 1 份同 arena → 硬门禁失败，整单拒绝
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
        // 任意文件存储失败 → submission 绝不创建、evidence 绝不写入
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
        // DB 写入失败 → 已落盘文件 best-effort 清理（不允许留下无 DB 引用的孤儿文件常态）
        verify(evidenceService).storeAll(anyList());
        verify(evidenceService).cleanupStoredFiles(anyList());
        verify(evidenceService, never()).attach(anyLong(), anyList());
    }
}
