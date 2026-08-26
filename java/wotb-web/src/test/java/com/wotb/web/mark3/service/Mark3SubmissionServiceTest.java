package com.wotb.web.mark3.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 三环核心状态机和排行回归：不复用百场的可替代 CURRENT 语义。 */
@ExtendWith(MockitoExtension.class)
class Mark3SubmissionServiceTest {

    private static final long TIER10_VEHICLE = 385L;
    private static final long GAME_ID = 111L;
    private static final String USER = "kc-user";
    private static final String ADMIN = "kc-admin";
    private static final String IMAGE_ONE = "data:image/png;base64,AAAA";
    private static final String IMAGE_TWO = "data:image/jpeg;base64,BBBB";

    @Mock
    Mark3SubmissionRepository repository;

    @Mock
    UserProfileService userProfileService;

    @Mock
    Mark3ReplayEvidenceService evidenceService;

    @Mock
    com.wotb.web.replayfile.ReplayHashLock replayHashLock;

    @Mock
    PlatformTransactionManager transactionManager;

    Mark3SubmissionService service;

    @BeforeEach
    void setUp() {
        service = newService(new ReplayCapacityLimiter(2));
        lenient().when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        lenient().when(repository.saveAndFlush(any())).thenAnswer(invocation -> {
            final Mark3Submission submission = invocation.getArgument(0);
            if (submission != null && submission.getId() == null) {
                submission.setId(10L);
            }
            return submission;
        });
        lenient().when(replayHashLock.runWithLocksResult(anyList(), any()))
                .thenAnswer(invocation -> ((java.util.function.Supplier<?>) invocation.getArgument(1)).get());
        lenient().when(transactionManager.getTransaction(any()))
                .thenReturn(mock(org.springframework.transaction.TransactionStatus.class));
    }

    @Test
    void validManualSubmissionFreezesClaimsAndBothScreenshots() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        try (final var parser = mockStatic(ReplayParser.class)) {
            parser.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(invocation -> {
                final byte[] data = invocation.getArgument(0);
                return battle(new String(data));
            });

            final var result = service.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(IMAGE_ONE, IMAGE_TWO), fiveReplays());

            assertThat(result.status()).isEqualTo("PENDING");
        }

        final ArgumentCaptor<Mark3Submission> captor = ArgumentCaptor.forClass(Mark3Submission.class);
        verify(repository).saveAndFlush(captor.capture());
        final Mark3Submission saved = captor.getValue();
        assertThat(saved.getStatus()).isEqualTo("PENDING");
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
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.existsByUserKeycloakIdAndVehicleIdAndStatus(USER, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(true);

        assertThatThrownBy(() -> service.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                List.of(IMAGE_ONE), fiveReplays()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MARK3_CURRENT_EXISTS");

        verify(evidenceService, never()).storeAll(anyList());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void approveCopiesFrozenClaimsAndNeverAcceptsReplacementScores() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(repository.findCurrentForUpdate(USER, TIER10_VEHICLE)).thenReturn(Optional.empty());

        final var result = service.approve(ADMIN, 10L);

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
        when(repository.findCurrentForUpdate(USER, TIER10_VEHICLE)).thenReturn(Optional.of(current));

        assertThatThrownBy(() -> service.approve(ADMIN, 10L))
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

        final Mark3LeaderboardPageDto page = service.leaderboard(TIER10_VEHICLE, null, null, 1, 50);

        assertThat(page.items()).extracting("rank").containsExactly(1, 2, 2, 4);
        assertThat(page.items()).extracting("approvedBattleCount").containsExactly(100, 120, 120, 160);
    }

    @Test
    void rejectsWinRateWithMoreThanTwoDecimalPlaces() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(
                USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.251"),
                List.of(IMAGE_ONE), fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("MARK3_INVALID_WIN_RATE");
    }

    @Test
    void acceptsDataUrlProducedFromAFourMiBImage() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        final int encodedPayloadChars = ((4 * 1024 * 1024 + 2) / 3) * 4;
        final String screenshot = "data:image/png;base64," + "A".repeat(encodedPayloadChars);
        try (final var parser = mockStatic(ReplayParser.class)) {
            parser.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(invocation -> {
                final byte[] data = invocation.getArgument(0);
                return battle(new String(data));
            });

            service.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(screenshot), fiveReplays());
        }

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
            when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

            try (final var parser = mockStatic(ReplayParser.class)) {
                assertThatThrownBy(() -> limitedService.createSubmission(
                        USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                        List.of(IMAGE_ONE), fiveReplays()))
                        .isInstanceOf(ReplayBusyException.class)
                        .hasMessage("REPLAY_BUSY");
                parser.verifyNoInteractions();
            }
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
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.existsByUserKeycloakIdAndVehicleIdAndStatus(USER, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(false, true);

        try (final var parser = mockStatic(ReplayParser.class)) {
            assertThatThrownBy(() -> service.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(IMAGE_ONE), fiveReplays()))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("MARK3_CURRENT_EXISTS");
            parser.verifyNoInteractions();
        }
        verify(evidenceService, never()).storeAll(anyList());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void releasesGlobalReplayCapacityAfterParseFailure() throws Exception {
        final Mark3SubmissionService limitedService = newService(new ReplayCapacityLimiter(1));
        final AtomicInteger parseCalls = new AtomicInteger();
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        try (final var parser = mockStatic(ReplayParser.class)) {
            parser.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(invocation -> {
                if (parseCalls.getAndIncrement() == 0) {
                    throw new IllegalArgumentException("invalid replay");
                }
                final byte[] data = invocation.getArgument(0);
                return battle(new String(data));
            });

            assertThatThrownBy(() -> limitedService.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(IMAGE_ONE), fiveReplays()))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("INVALID_REPLAY_FILE");

            assertThat(limitedService.createSubmission(
                    USER, TIER10_VEHICLE, 123, 3_456, new BigDecimal("55.25"),
                    List.of(IMAGE_ONE), fiveReplays()).status()).isEqualTo("PENDING");
        }

        verify(evidenceService).storeAll(anyList());
    }

    @Test
    void rejectReasonTextCannotOverflowDatabaseColumn() {
        assertThatThrownBy(() -> service.reject(ADMIN, 10L, "OTHER", "x".repeat(501)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("MARK3_REJECT_REASON_TEXT_TOO_LONG");
        verify(repository, never()).findByIdForUpdate(anyLong());
    }

    private Mark3SubmissionService newService(final ReplayCapacityLimiter limiter) {
        return new Mark3SubmissionService(
                repository, new Mark3Mapper(), userProfileService, limiter,
                evidenceService, replayHashLock, transactionManager);
    }

    private static UserProfile profile() {
        final UserProfile profile = new UserProfile();
        profile.setId(1L);
        profile.setKeycloakUserId(USER);
        profile.setWotbAccountId(GAME_ID);
        profile.setWotbNickname("PlayerOne");
        return profile;
    }

    private static Mark3Submission pendingSubmission() {
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(10L);
        submission.setUserKeycloakId(USER);
        submission.setVehicleId(TIER10_VEHICLE);
        submission.setVehicleName("Progetto 65");
        submission.setGameAccountIdSnapshot(GAME_ID);
        submission.setNicknameSnapshot("PlayerOne");
        submission.setClaimedBattleCount(123);
        submission.setClaimedAverageDamage(3_456);
        submission.setClaimedWinRate(new BigDecimal("55.25"));
        submission.setStatus("PENDING");
        submission.setProofScreenshotFirst(IMAGE_ONE);
        submission.setProofScreenshotSecond(IMAGE_TWO);
        return submission;
    }

    private static Mark3Submission currentSubmission(final int battleCount) {
        final Mark3Submission submission = pendingSubmission();
        submission.setStatus("CURRENT");
        submission.setApprovedBattleCount(battleCount);
        submission.setApprovedAverageDamage(3_456);
        submission.setApprovedWinRate(new BigDecimal("55.25"));
        submission.setApprovedAt(OffsetDateTime.parse("2026-08-01T00:00:00Z"));
        return submission;
    }

    private static List<MultipartFile> fiveReplays() {
        final List<MultipartFile> files = new ArrayList<>();
        for (int index = 1; index <= 5; index++) {
            files.add(new MockMultipartFile(
                    "replays", "battle-" + index + ".wotbreplay", "application/octet-stream",
                    ("arena-" + index).getBytes()));
        }
        return files;
    }

    private static Battle battle(final String arenaId) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        final PlayerResult player = new PlayerResult();
        player.accountId = GAME_ID;
        player.tankId = TIER10_VEHICLE;
        battle.players = new ArrayList<>(List.of(player));
        return battle;
    }
}
