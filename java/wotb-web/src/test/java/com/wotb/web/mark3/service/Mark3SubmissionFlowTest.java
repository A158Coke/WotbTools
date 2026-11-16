package com.wotb.web.mark3.service;

import com.wotb.core.model.Battle;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.testsupport.ReplayFactsJson;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 三环核心状态机和排行回归：不复用百场的可替代 CURRENT 语义。 */
@ExtendWith(MockitoExtension.class)
class Mark3SubmissionFlowTest extends Mark3SubmissionTestSupport {

    @Test
    void validManualSubmissionFreezesClaimsAndBothScreenshots() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        final var result = service.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                List.of(IMAGE_ONE, IMAGE_TWO), fiveReplays(), facts(fiveReplays()));

        assertThat(result.status()).isEqualTo("PENDING");

        final ArgumentCaptor<Mark3Submission> captor = ArgumentCaptor.forClass(Mark3Submission.class);
        verify(repository).saveAndFlush(captor.capture());
        final Mark3Submission saved = captor.getValue();
        assertThat(saved.getStatus()).isEqualTo("PENDING");
        // canonical owner 冻结：区服 + WotB 账号都必须在创建瞬间落库
        assertThat(saved.getWotbServer()).isEqualTo(WOTB_SERVER);
        assertThat(saved.getWotbAccountId()).isEqualTo(GAME_ID);
        assertThat(saved.getClaimedBattleCount()).isEqualTo(123);
        assertThat(saved.getClaimedAverageDamage()).isEqualTo(3_456);
        assertThat(saved.getClaimedWinRate()).isEqualByComparingTo("55.25");
        assertThat(saved.getProofScreenshotFirst()).isEqualTo(IMAGE_ONE);
        assertThat(saved.getProofScreenshotSecond()).isEqualTo(IMAGE_TWO);
        verify(evidenceService).storeAll(anyList());
        verify(evidenceService).attach(eq(10L), anyList());
    }

    @Test
    void currentRecordBlocksNewSubmissionBeforeReplayParsing() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        // ownership/canonical owner 改为 (区服, WotB 账号)：预检按 profile 的区服 + 账号查询
        when(repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(true);

        assertThatThrownBy(() -> service.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                List.of(IMAGE_ONE), fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MARK3_CURRENT_EXISTS");

        verify(evidenceService, never()).storeAll(anyList());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void approveCopiesFrozenClaimsAndNeverAcceptsReplacementScores() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(repository.findCurrentForUpdate(WOTB_SERVER, GAME_ID, TIER10_VEHICLE)).thenReturn(Optional.empty());

        final var result = moderationService.approve(ADMIN, 10L);

        assertThat(result.status()).isEqualTo("CURRENT");
        assertThat(pending.getApprovedBattleCount()).isEqualTo(123);
        assertThat(pending.getApprovedAverageDamage()).isEqualTo(3_456);
        assertThat(pending.getApprovedWinRate()).isEqualByComparingTo("55.25");
        assertThat(pending.getProofScreenshotFirst()).isNull();
        assertThat(pending.getProofScreenshotSecond()).isNull();
        verify(evidenceService).requireCompleteEvidenceForApproval(10L, List.of(IMAGE_ONE, IMAGE_TWO));
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void approveRejectsWhenCurrentRecordAlreadyExists() {
        final Mark3Submission pending = pendingSubmission();
        final Mark3Submission current = pendingSubmission();
        current.setStatus("CURRENT");
        current.setApprovedBattleCount(100);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(repository.findCurrentForUpdate(WOTB_SERVER, GAME_ID, TIER10_VEHICLE)).thenReturn(Optional.of(current));

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MARK3_CURRENT_EXISTS");
        verify(repository, never()).saveAndFlush(any());
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    @Test
    void leaderboardUsesAscendingCompetitionRankForBattleCount() {
        final Mark3Submission s100 = currentSubmission(100);
        s100.setId(1L);
        final Mark3Submission s120a = currentSubmission(120);
        s120a.setId(2L);
        final Mark3Submission s120b = currentSubmission(120);
        s120b.setId(3L);
        final Mark3Submission s160 = currentSubmission(160);
        s160.setId(4L);
        when(repository.findByVehicleIdAndStatusOrderByApprovedBattleCountAscApprovedAtAscIdAsc(
                eq(TIER10_VEHICLE), eq("CURRENT"), any()))
                .thenReturn(new PageImpl<>(List.of(s100, s120a, s120b, s160)));
        when(repository.countCurrentGroupedByBattleCount(TIER10_VEHICLE)).thenReturn(List.of(
                new Object[]{100, 1L}, new Object[]{120, 2L}, new Object[]{160, 1L}));

        final Mark3LeaderboardPageDto page = leaderboardService.leaderboard(TIER10_VEHICLE, null, null, 1, 50);

        assertThat(page.items()).extracting("rank").containsExactly(1, 2, 2, 4);
        assertThat(page.items()).extracting("approvedBattleCount").containsExactly(100, 120, 120, 160);
    }

    @Test
    void rejectsWinRateWithMoreThanTwoDecimalPlaces() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.251"),
                List.of(IMAGE_ONE), fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("MARK3_INVALID_WIN_RATE");
    }

    @Test
    void acceptsDataUrlProducedFromAFourMiBImage() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        final int encodedPayloadChars = ((4 * 1024 * 1024 + 2) / 3) * 4;
        final String screenshot = "data:image/png;base64," + "A".repeat(encodedPayloadChars);
        service.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                List.of(screenshot), fiveReplays(), facts(fiveReplays()));

        verify(evidenceService).storeAll(anyList());
    }

    @Test
    void rejectsFullGlobalReplayCapacityBeforeParsingOrPersistence() throws Exception {
        final ReplayCapacityLimiter limiter = new ReplayCapacityLimiter(1);
        final Mark3SubmissionService limitedService = newService(limiter);
        final ExecutorService executor = Executors.newSingleThreadExecutor();
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        try {
            final Future<String> holder = executor.submit(() -> limiter.execute(() -> {
                entered.countDown();
                if (!release.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("TEST_TIMEOUT");
                }
                return "released";
            }));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

            assertThatThrownBy(() -> limitedService.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(IMAGE_ONE), fiveReplays(), facts(fiveReplays())))
                    .isInstanceOf(ReplayBusyException.class)
                    .hasMessage("REPLAY_BUSY");
            verify(evidenceService, never()).storeAll(anyList());
            verify(repository, never()).saveAndFlush(any());

            release.countDown();
            assertThat(holder.get(5, TimeUnit.SECONDS)).isEqualTo("released");
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void rechecksActiveSubmissionInsideCapacityBeforeParsing() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(false, true);

        assertThatThrownBy(() -> service.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                List.of(IMAGE_ONE), fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MARK3_CURRENT_EXISTS");
        verify(evidenceService, never()).storeAll(anyList());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void releasesGlobalReplayCapacityAfterReplayValidationFailure() throws Exception {
        final Mark3SubmissionService limitedService = newService(new ReplayCapacityLimiter(1));
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        // 容量许可内失败（首个回放的 facts 不含本人账号）→ 许可必须释放，下一次提交仍可进入
        final List<String> firstForeign = new ArrayList<>(facts(fiveReplays()));
        final Battle foreign = battle("a1");
        foreign.players.getFirst().accountId = 999L;
        firstForeign.set(0, ReplayFactsJson.of(foreign));
        assertThatThrownBy(() -> limitedService.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                List.of(IMAGE_ONE), fiveReplays(), firstForeign))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("MARK3_REPLAY_GAME_ID_MISMATCH");

        assertThat(limitedService.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                List.of(IMAGE_ONE), fiveReplays(), facts(fiveReplays())).status()).isEqualTo("PENDING");

        verify(evidenceService).storeAll(anyList());
    }

    @Test
    void rejectsMissingOrMiscountedReplayFactsBeforePersistence() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        // 服务器没有 parser：facts 必填且与回放一一对应
        for (final List<String> facts : java.util.Arrays.asList(null, List.<String>of(),
                facts(fiveReplays()).subList(0, 4))) {
            assertThatThrownBy(() -> service.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(IMAGE_ONE), fiveReplays(), facts))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("REPLAY_FACTS_COUNT_MISMATCH");
        }
        verify(evidenceService, never()).storeAll(anyList());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsInvalidReplayFactsBeforePersistence() {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        final List<String> broken = new ArrayList<>(facts(fiveReplays()));
        final Battle noTank = battle("a4");
        noTank.players.getFirst().tankId = 0;
        broken.set(3, ReplayFactsJson.of(noTank));
        final List<String> notJson = new ArrayList<>(facts(fiveReplays()));
        notJson.set(1, "not json");
        for (final List<String> facts : List.of(broken, notJson)) {
            assertThatThrownBy(() -> service.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(IMAGE_ONE), fiveReplays(), facts))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("INVALID_REPLAY_FACTS");
        }
        verify(evidenceService, never()).storeAll(anyList());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void rejectReasonTextCannotOverflowDatabaseColumn() {
        assertThatThrownBy(() -> moderationService.reject(ADMIN, 10L, "OTHER", "x".repeat(501)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("MARK3_REJECT_REASON_TEXT_TOO_LONG");
        verify(repository, never()).findByIdForUpdate(anyLong());
    }
}
