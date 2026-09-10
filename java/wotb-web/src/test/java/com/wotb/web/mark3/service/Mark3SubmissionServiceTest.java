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
import com.wotb.web.user.service.WotbAccountIdentity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

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
import static org.mockito.ArgumentMatchers.anyString;
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
    /** canonical owner 的区服维度：(WOTB_SERVER, GAME_ID) 与 (OTHER_SERVER, GAME_ID) 是两个不同账号。 */
    private static final String WOTB_SERVER = "CN";
    private static final String OTHER_SERVER = "EU";
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
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        // ownership/canonical owner 改为 (区服, WotB 账号)：预检按 profile 的区服 + 账号查询
        when(repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT"))
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
        when(repository.findCurrentForUpdate(WOTB_SERVER, GAME_ID, TIER10_VEHICLE)).thenReturn(Optional.empty());

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
        when(repository.findCurrentForUpdate(WOTB_SERVER, GAME_ID, TIER10_VEHICLE)).thenReturn(Optional.of(current));

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
        when(repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT"))
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

    // ── CANCEL：ownership 按当前绑定的 (区服, WotB 账号) 判定 ─────────────

    @Test
    void cancelByOwnerMovesPendingToCancelledAndClearsEvidence() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        // userId 只用于解析身份；比较的是 currentWotbIdentity 与记录的 canonical owner
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));

        final var result = service.cancelSubmission(USER, 10L);

        assertThat(result.status()).isEqualTo("CANCELLED");
        assertThat(pending.getCancelledAt()).isNotNull();
        assertThat(pending.getProofScreenshotFirst()).isNull();
        assertThat(pending.getProofScreenshotSecond()).isNull();
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void cancelForbiddenWhenCallerBoundToAnotherWotbAccount() {
        final Mark3Submission pending = pendingSubmission(); // owner = (WOTB_SERVER, GAME_ID)
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        // Keycloak 用户改绑到另一个 WotB 账号（同区服）→ 记录仍属原账号，不可取消
        when(userProfileService.currentWotbIdentity("kc-other"))
                .thenReturn(Optional.of(new WotbAccountIdentity(WOTB_SERVER, GAME_ID + 1)));

        assertThatThrownBy(() -> service.cancelSubmission("kc-other", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) error).getReason()).contains("MARK3_FORBIDDEN");
                });

        assertThat(pending.getStatus()).isEqualTo("PENDING");
        assertThat(pending.getProofScreenshotFirst()).isNotNull();
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    @Test
    void cancelForbiddenWhenCallerBoundToSameAccountOnAnotherServer() {
        // 区服是 canonical owner 的一部分：(CN, 111) 与 (EU, 111) 是两个不同账号，
        // 只比账号 ID 会让跨服同号互相取消对方的申请。
        final Mark3Submission pending = pendingSubmission(); // owner = (CN, GAME_ID)
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(userProfileService.currentWotbIdentity("kc-eu"))
                .thenReturn(Optional.of(new WotbAccountIdentity(OTHER_SERVER, GAME_ID)));

        assertThatThrownBy(() -> service.cancelSubmission("kc-eu", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) error).getReason()).contains("MARK3_FORBIDDEN");
                });

        // 记录状态与证据必须原封不动
        assertThat(pending.getStatus()).isEqualTo("PENDING");
        assertThat(pending.getProofScreenshotFirst()).isNotNull();
        assertThat(pending.getProofScreenshotSecond()).isNotNull();
        assertThat(pending.getWotbServer()).isEqualTo(WOTB_SERVER);
        assertThat(pending.getWotbAccountId()).isEqualTo(GAME_ID);
        verify(evidenceService, never()).discardForSubmission(anyLong());
        verify(repository, never()).save(any());
    }

    @Test
    void cancelForbiddenWhenCallerHasNoBoundWotbAccount() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        // 未绑定账号的两种形态都必须是 403：profile 不存在，或 profile 存在但 wotbAccountId 为 null
        // （后者由 UserProfileService.currentWotbIdentity 统一归一为 empty，服务层不需要第二套规则）
        when(userProfileService.currentWotbIdentity("kc-unknown")).thenReturn(Optional.empty());
        when(userProfileService.currentWotbIdentity("kc-unbound")).thenReturn(Optional.empty());

        for (final String caller : List.of("kc-unknown", "kc-unbound")) {
            assertThatThrownBy(() -> service.cancelSubmission(caller, 10L))
                    .as("caller %s", caller)
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(error -> {
                        assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                        assertThat(((ResponseStatusException) error).getReason()).contains("MARK3_FORBIDDEN");
                    });
        }

        assertThat(pending.getStatus()).isEqualTo("PENDING");
        assertThat(pending.getProofScreenshotFirst()).isNotNull();
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    // ── userStatus：ownership = 当前绑定的 (区服, WotB 账号) ───────────────

    @Test
    void userStatusReturnsEmptyListsWhenNoBoundWotbAccount() {
        // profile 不存在或未绑定账号 → 三个空列表；不再抛错，也不回退到 Keycloak id 查询
        when(userProfileService.currentWotbIdentity("kc-unknown")).thenReturn(Optional.empty());
        when(userProfileService.currentWotbIdentity("kc-unbound")).thenReturn(Optional.empty());

        for (final String caller : List.of("kc-unknown", "kc-unbound")) {
            final var status = service.userStatus(caller);
            assertThat(status.current()).as("caller %s", caller).isEmpty();
            assertThat(status.pending()).isEmpty();
            assertThat(status.rejected()).isEmpty();
        }

        // 未绑定 → 从不查 repository（不得按 Keycloak 身份兜底）
        verify(repository, never()).findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                anyString(), anyLong(), any());
    }

    @Test
    void userStatusQueriesByBoundWotbAccountId() {
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));
        final Mark3Submission current = currentSubmission(123);
        final Mark3Submission pending = pendingSubmission();
        final Mark3Submission rejected = pendingSubmission();
        rejected.setStatus("REJECTED");
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("CURRENT"))).thenReturn(List.of(current));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("PENDING"))).thenReturn(List.of(pending));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("REJECTED"))).thenReturn(List.of(rejected));

        final var status = service.userStatus(USER);

        assertThat(status.current()).extracting("status").containsExactly("CURRENT");
        assertThat(status.pending()).extracting("status").containsExactly("PENDING");
        assertThat(status.rejected()).extracting("status").containsExactly("REJECTED");
    }

    @Test
    void userStatusQueriesByBoundServerNotOnlyByAccountId() {
        // 同一账号在另一区服：查询必须带区服维度，否则 (CN, 111) 的记录会串到 (EU, 111) 名下
        final Mark3Submission euCurrent = currentSubmission(123);
        euCurrent.setWotbServer(OTHER_SERVER);
        when(userProfileService.currentWotbIdentity(USER))
                .thenReturn(Optional.of(new WotbAccountIdentity(OTHER_SERVER, GAME_ID)));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("CURRENT"))).thenReturn(List.of(euCurrent));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("PENDING"))).thenReturn(List.of());
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("REJECTED"))).thenReturn(List.of());

        final var status = service.userStatus(USER);

        // 绑定 (EU, 111) 时看到的是 EU 那条记录
        assertThat(status.current()).extracting("status").containsExactly("CURRENT");
        assertThat(status.pending()).isEmpty();
        assertThat(status.rejected()).isEmpty();
        // 三个查询全部带绑定身份的区服；从不按另一区服（CN）查询
        verify(repository, never()).findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                eq(WOTB_SERVER), anyLong(), any());
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
        profile.setWotbServer(WOTB_SERVER);
        profile.setWotbAccountId(GAME_ID);
        profile.setWotbNickname("PlayerOne");
        return profile;
    }

    /** 当前绑定身份 = 记录的 canonical owner（同区服、同账号）。 */
    private static WotbAccountIdentity identity() {
        return new WotbAccountIdentity(WOTB_SERVER, GAME_ID);
    }

    private static Mark3Submission pendingSubmission() {
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(10L);
        submission.setVehicleId(TIER10_VEHICLE);
        submission.setVehicleName("Progetto 65");
        // canonical owner：创建瞬间冻结的 (区服, WotB 游戏账号)（Keycloak 身份不再落在 submission 上）
        submission.setWotbServer(WOTB_SERVER);
        submission.setWotbAccountId(GAME_ID);
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
