package com.wotb.web.hundred.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 百场 submission 业务契约测试（Mockito，无 DB，任何环境可跑）。
 * 覆盖 docs/current-plan.md §52：submission 校验矩阵 / CURRENT 门槛 / snapshot /
 * approval / terminal transition 竞争 / delete / rank / files。
 */
@ExtendWith(MockitoExtension.class)
class HundredBattleSubmissionServiceTest {

    private static final long TIER10_VEHICLE = 385L;          // Progetto 65 (tier 10)
    private static final long TIER10_VEHICLE_2 = 3649L;       // B-C 25 t (tier 10)
    private static final long TIER7_VEHICLE = 113L;           // Vindicator UM (tier 7)
    private static final long GAME_ID = 111L;
    private static final String USER = "kc-user";
    private static final String ADMIN = "kc-admin";

    @Mock
    HundredBattleSubmissionRepository repository;

    @Mock
    UserProfileService userProfileService;

    HundredBattleSubmissionService service;

    @BeforeEach
    void setUp() {
        // 真实 mapper（无依赖），便于断言返回 DTO；Service 构造器注入，无 Spring。
        service = new HundredBattleSubmissionService(repository, new HundredBattleMapper(), userProfileService);
        // 未触发终态保存的用例不报 UnnecessaryStubbing（lenient）；已触发时返回入参避免 mapper 吃 null。
        org.mockito.Mockito.lenient().when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        org.mockito.Mockito.lenient().when(repository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static UserProfile profile() {
        final UserProfile p = new UserProfile();
        p.setId(1L);
        p.setKeycloakUserId(USER);
        p.setWotbAccountId(GAME_ID);
        p.setWotbNickname("PlayerOne");
        return p;
    }

    private static UserProfile profileWithoutGameId() {
        final UserProfile p = profile();
        p.setWotbAccountId(null);
        return p;
    }

    private static UserProfile profileWithoutNickname() {
        final UserProfile p = profile();
        p.setWotbNickname(null);
        return p;
    }

    /** 构造一个 battle：唯一玩家 accountId=GAME_ID、tankId=TIER10_VEHICLE。 */
    private static Battle battle(final String arenaId) {
        return battle(arenaId, GAME_ID, TIER10_VEHICLE);
    }

    private static Battle battle(final String arenaId, final long gameId, final long vehicleId) {
        final Battle b = new Battle();
        b.arenaId = arenaId;
        b.arenaBonusType = 1;
        final PlayerResult p = new PlayerResult();
        p.accountId = gameId;
        p.nickname = "PlayerOne";
        p.tankId = vehicleId;
        p.damageDealt = 3200;
        b.players = new ArrayList<>(List.of(p));
        return b;
    }

    private static List<MultipartFile> replays(final int count, final String... arenaIds) {
        final List<MultipartFile> files = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            final String arena = arenaIds != null && i < arenaIds.length
                    ? arenaIds[i] : "arena-" + (i + 1);
            files.add(new MockMultipartFile("replays", "battle-" + i + ".wotbreplay",
                    "application/octet-stream", arena.getBytes()));
        }
        return files;
    }

    /** 默认 5 场不同 battle 的 replay 列表。 */
    private static List<MultipartFile> fiveReplays() {
        return replays(5, "a1", "a2", "a3", "a4", "a5");
    }

    private static HundredBattleSubmission pendingSubmission() {
        final HundredBattleSubmission s = new HundredBattleSubmission();
        s.setId(10L);
        s.setUserKeycloakId(USER);
        s.setVehicleId(TIER10_VEHICLE);
        s.setVehicleName("Progetto 65");
        s.setGameAccountIdSnapshot(GAME_ID);
        s.setNicknameSnapshot("PlayerOne");
        s.setClaimedAverageDamage(4200);
        s.setClaimedBattleCount(136);
        s.setStatus("PENDING");
        s.setProofScreenshot("data:image/png;base64,AAAA");
        return s;
    }

    private static HundredBattleSubmission currentSubmission(final int approvedDamage) {
        final HundredBattleSubmission s = pendingSubmission();
        s.setStatus("CURRENT");
        s.setApprovedAverageDamage(approvedDamage);
        s.setApprovedBattleCount(151);
        s.setApprovedAt(OffsetDateTime.parse("2026-08-01T00:00:00Z"));
        s.setApprovedBy(ADMIN);
        return s;
    }

    // ── Submission：创建校验矩阵 ────────────────────────────────────────

    @Test
    void validSubmissionCreatesPendingWithFrozenSnapshot() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv -> {
                final byte[] bytes = inv.getArgument(0);
                return battle(new String(bytes));
            });

            service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", fiveReplays());
        }

        final ArgumentCaptor<HundredBattleSubmission> captor =
                ArgumentCaptor.forClass(HundredBattleSubmission.class);
        verify(repository).saveAndFlush(captor.capture());
        final HundredBattleSubmission s = captor.getValue();
        assertThat(s.getStatus()).isEqualTo("PENDING");
        assertThat(s.getUserKeycloakId()).isEqualTo(USER);
        assertThat(s.getVehicleId()).isEqualTo(TIER10_VEHICLE);
        assertThat(s.getVehicleName()).isEqualTo("Progetto 65");
        // snapshot 冻结：创建瞬间的 gameId / nickname，与之后 Profile 修改无关
        assertThat(s.getGameAccountIdSnapshot()).isEqualTo(GAME_ID);
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
    void rejectsWhenProfileMissingGameId() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profileWithoutGameId()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_PROFILE_GAME_ID_REQUIRED");
    }

    @Test
    void rejectsWhenProfileMissingNickname() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profileWithoutNickname()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_PROFILE_NICKNAME_REQUIRED");
    }

    @Test
    void rejectsInvalidClaimValues() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 0, 136,
                "data:image/png;base64,AAAA", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_INVALID_CLAIM");
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, -1,
                "data:image/png;base64,AAAA", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_INVALID_CLAIM");
    }

    @Test
    void rejectsNonTierXVehicle() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER7_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_NON_TIER_X");
    }

    @Test
    void rejectsUnknownVehicle() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, 999999L, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_NON_TIER_X");
    }

    @Test
    void rejectsMissingScreenshot() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "  ", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("PROOF_SCREENSHOT_REQUIRED");
    }

    @Test
    void rejectsInvalidScreenshotData() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "not-a-data-url", fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("INVALID_IMAGE_DATA");
    }

    @Test
    void rejectsOversizedScreenshot() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        final String huge = "data:image/png;base64," + "x".repeat(5_500_000);
        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                huge, fiveReplays()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("IMAGE_TOO_LARGE");
    }

    @Test
    void rejectsReplayCountBelowFive() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", replays(3)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_COUNT");
    }

    @Test
    void rejectsReplayCountAboveFive() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", replays(7)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REPLAY_COUNT");
    }

    @Test
    void rejectsReplayParseFailure() {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class)))
                    .thenThrow(new RuntimeException("bad file"));

            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", fiveReplays()))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("INVALID_REPLAY_FILE");
        }
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsWrongGameIdInReplay() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class)))
                    .thenReturn(battle("a1", 999L, TIER10_VEHICLE));

            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", fiveReplays()))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("HUNDRED_REPLAY_GAME_ID_MISMATCH");
        }
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsWrongVehicleInReplay() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class)))
                    .thenReturn(battle("a1", GAME_ID, 999L));

            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", fiveReplays()))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("HUNDRED_REPLAY_VEHICLE_MISMATCH");
        }
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsDuplicateBattleAmongFiveReplays() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            // 第二份与第一份同 arena（a2 重复）→ 不是 5 场不同 battle
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));

            final List<MultipartFile> files = replays(5, "a1", "a2", "a2", "a3", "a4");
            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", files))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        }
        verify(repository, never()).saveAndFlush(any());
    }

    // ── Submission：PENDING 唯一性 & CURRENT 门槛 ───────────────────────

    @Test
    void rejectsWhenSameUserSameVehicleAlreadyPending() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.existsByUserKeycloakIdAndVehicleIdAndStatus(USER, TIER10_VEHICLE, "PENDING"))
                .thenReturn(true);

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));

            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", fiveReplays()))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("HUNDRED_PENDING_EXISTS");
        }
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void allowsDifferentVehicleWhenAnotherPendingExists() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        // IS-7 (385) 已有 PENDING（本次提交的是另一辆车，该 stub 只表达「另一辆车已有 PENDING」的场景前提）
        org.mockito.Mockito.lenient()
                .when(repository.existsByUserKeycloakIdAndVehicleIdAndStatus(USER, TIER10_VEHICLE, "PENDING"))
                .thenReturn(true);
        when(repository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv -> {
                final Battle b = new Battle();
                b.arenaId = new String((byte[]) inv.getArgument(0));
                final PlayerResult p = new PlayerResult();
                p.accountId = GAME_ID;
                p.tankId = TIER10_VEHICLE_2;
                b.players = new ArrayList<>(List.of(p));
                return b;
            });

            // IS-7 (385) 已有 PENDING，提交另一辆 Tier X (3649) 允许
            service.createSubmission(USER, TIER10_VEHICLE_2, 4200, 136,
                    "data:image/png;base64,AAAA", fiveReplays());
        }
        verify(repository).saveAndFlush(any());
    }

    @Test
    void mapsPendingUniqueIndexRaceToConflict() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("uk_hundred_battle_pending_user_vehicle"));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));

            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", fiveReplays()))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("HUNDRED_PENDING_EXISTS");
        }
    }

    @Test
    void currentGateAllowsStrictlyHigherScore() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.findByUserKeycloakIdAndVehicleIdAndStatus(USER, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(Optional.of(currentSubmission(4000)));
        when(repository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));
            service.createSubmission(USER, TIER10_VEHICLE, 4001, 136,
                    "data:image/png;base64,AAAA", fiveReplays());
        }
        verify(repository).saveAndFlush(any());
    }

    @Test
    void currentGateRejectsEqualScore() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.findByUserKeycloakIdAndVehicleIdAndStatus(USER, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(Optional.of(currentSubmission(4000)));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));

            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4000, 136,
                    "data:image/png;base64,AAAA", fiveReplays()))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("HUNDRED_NOT_HIGHER");
        }
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void currentGateRejectsLowerScore() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.findByUserKeycloakIdAndVehicleIdAndStatus(USER, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(Optional.of(currentSubmission(4000)));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));

            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 3999, 136,
                    "data:image/png;base64,AAAA", fiveReplays()))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("HUNDRED_NOT_HIGHER");
        }
    }

    @Test
    void noCurrentWithHistoricalDeletedOrSupersededAllowsRestart() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));
            // CURRENT 不存在（历史 DELETED/SUPERSEDED 由 repository 查询自然排除）
            service.createSubmission(USER, TIER10_VEHICLE, 4000, 136,
                    "data:image/png;base64,AAAA", fiveReplays());
        }
        verify(repository).saveAndFlush(any());
    }

    // ── Approval ─────────────────────────────────────────────────────────

    @Test
    void approveWithoutCurrentMakesSubmissionCurrent() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result =
                service.approve(ADMIN, 10L, 4200, 136);

        assertThat(result.status()).isEqualTo("CURRENT");
        assertThat(s.getApprovedAverageDamage()).isEqualTo(4200);
        assertThat(s.getApprovedBattleCount()).isEqualTo(136);
        assertThat(s.getApprovedAt()).isNotNull();
        assertThat(s.getApprovedBy()).isEqualTo(ADMIN);
        // APPROVE 终态：proof 截图事务内清空（不永久保存）
        assertThat(s.getProofScreenshot()).isNull();
        // 无旧 CURRENT：仅保存 submission
        verify(repository).save(s);
    }

    @Test
    void approveWithExistingLowerCurrentSupersedesIt() {
        final HundredBattleSubmission s = pendingSubmission();
        final HundredBattleSubmission current = currentSubmission(4100);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(repository.findCurrentForUpdate(USER, TIER10_VEHICLE)).thenReturn(Optional.of(current));

        final HundredSubmissionSummaryDto result = service.approve(ADMIN, 10L, 4200, 136);

        assertThat(result.status()).isEqualTo("CURRENT");
        assertThat(current.getStatus()).isEqualTo("SUPERSEDED");
        assertThat(s.getStatus()).isEqualTo("CURRENT");
        verify(repository).save(current);
        verify(repository).save(s);
    }

    @Test
    void approveRejectsWhenApprovedValueNotHigherThanCurrent() {
        final HundredBattleSubmission s = pendingSubmission();
        final HundredBattleSubmission current = currentSubmission(4100);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(repository.findCurrentForUpdate(USER, TIER10_VEHICLE)).thenReturn(Optional.of(current));

        // 管理员修正 approved=4050 < CURRENT 4100 → stale approve 拒绝（claimed 4200 不作数）
        assertThatThrownBy(() -> service.approve(ADMIN, 10L, 4050, 136))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_APPROVE_STALE");
        assertThat(current.getStatus()).isEqualTo("CURRENT");
        assertThat(s.getStatus()).isEqualTo("PENDING");
    }

    @Test
    void approveRejectsWhenCurrentRoseAfterSubmission() {
        final HundredBattleSubmission s = pendingSubmission();
        final HundredBattleSubmission current = currentSubmission(4300);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(repository.findCurrentForUpdate(USER, TIER10_VEHICLE)).thenReturn(Optional.of(current));

        assertThatThrownBy(() -> service.approve(ADMIN, 10L, 4200, 136))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_APPROVE_STALE");
    }

    @Test
    void approveRejectsInvalidApprovedValues() {
        assertThatThrownBy(() -> service.approve(ADMIN, 10L, 0, 136))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_INVALID_APPROVED");
    }

    @Test
    void approveRejectsWhenSubmissionNotPending() {
        final HundredBattleSubmission s = pendingSubmission();
        s.setStatus("CANCELLED");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        // 竞争：CANCEL 已成功 → APPROVE 得到明确 conflict
        assertThatThrownBy(() -> service.approve(ADMIN, 10L, 4200, 136))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_SUBMISSION_NOT_PENDING");
    }

    // ── REJECT / CANCEL / DELETE ─────────────────────────────────────────

    @Test
    void rejectSetsReasonAndClearsScreenshot() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result =
                service.reject(ADMIN, 10L, "SCREENSHOT_MISMATCH", null);

        assertThat(result.status()).isEqualTo("REJECTED");
        assertThat(s.getRejectedBy()).isEqualTo(ADMIN);
        assertThat(s.getRejectReason()).isEqualTo("SCREENSHOT_MISMATCH");
        assertThat(s.getRejectReasonText()).isNull();
        assertThat(s.getProofScreenshot()).isNull();
    }

    @Test
    void rejectRequiresReason() {
        assertThatThrownBy(() -> service.reject(ADMIN, 10L, "  ", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REJECT_REASON_REQUIRED");
        assertThatThrownBy(() -> service.reject(ADMIN, 10L, "UNKNOWN_CATEGORY", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REJECT_REASON_REQUIRED");
    }

    @Test
    void rejectOtherRequiresText() {
        assertThatThrownBy(() -> service.reject(ADMIN, 10L, "OTHER", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REJECT_REASON_TEXT_REQUIRED");
    }

    @Test
    void rejectCannotTransitionNonPending() {
        final HundredBattleSubmission s = pendingSubmission();
        s.setStatus("CURRENT");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> service.reject(ADMIN, 10L, "SCREENSHOT_MISMATCH", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_SUBMISSION_NOT_PENDING");
    }

    @Test
    void cancelByOwnerMovesPendingToCancelledAndClearsScreenshot() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result = service.cancelSubmission(USER, 10L);

        assertThat(result.status()).isEqualTo("CANCELLED");
        assertThat(s.getCancelledAt()).isNotNull();
        assertThat(s.getProofScreenshot()).isNull();
    }

    @Test
    void cancelByNonOwnerForbidden() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> service.cancelSubmission("kc-other", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_FORBIDDEN");
                });
    }

    @Test
    void cancelCannotTransitionAlreadyApproved() {
        final HundredBattleSubmission s = currentSubmission(4100);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> service.cancelSubmission(USER, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_SUBMISSION_NOT_PENDING");
    }

    @Test
    void deleteCurrentMovesToDeletedWithReason() {
        final HundredBattleSubmission s = currentSubmission(4120);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result =
                service.deleteCurrent(ADMIN, 10L, "CHEATING_FORGERY", null);

        assertThat(result.status()).isEqualTo("DELETED");
        assertThat(s.getDeletedBy()).isEqualTo(ADMIN);
        assertThat(s.getDeleteReason()).isEqualTo("CHEATING_FORGERY");
        assertThat(s.getDeletedAt()).isNotNull();
    }

    @Test
    void deleteRequiresReason() {
        assertThatThrownBy(() -> service.deleteCurrent(ADMIN, 10L, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_DELETE_REASON_REQUIRED");
        assertThatThrownBy(() -> service.deleteCurrent(ADMIN, 10L, "OTHER", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_DELETE_REASON_TEXT_REQUIRED");
    }

    @Test
    void deleteOnlyFromCurrent() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> service.deleteCurrent(ADMIN, 10L, "CHEATING_FORGERY", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_NOT_CURRENT");
    }

    @Test
    void deleteCurrentDoesNotTouchSupersededHistory() {
        final HundredBattleSubmission s = currentSubmission(4120);
        final HundredBattleSubmission superseded = currentSubmission(3900);
        superseded.setStatus("SUPERSEDED");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        service.deleteCurrent(ADMIN, 10L, "CHEATING_FORGERY", null);

        // 只保存被删除的 CURRENT 行；SUPERSEDED 历史保持原状（不恢复）
        verify(repository).save(s);
        verify(repository, never()).save(superseded);
        assertThat(superseded.getStatus()).isEqualTo("SUPERSEDED");
    }

    // ── Rank：competition ranking ────────────────────────────────────────

    @Test
    void leaderboardComputesCompetitionRanking() {
        final HundredBattleSubmission s4300 = currentSubmission(4300);
        s4300.setId(1L);
        final HundredBattleSubmission s4200a = currentSubmission(4200);
        s4200a.setId(2L);
        final HundredBattleSubmission s4200b = currentSubmission(4200);
        s4200b.setId(3L);
        final HundredBattleSubmission s4100 = currentSubmission(4100);
        s4100.setId(4L);

        when(repository.findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                eq(TIER10_VEHICLE), eq("CURRENT"), any()))
                .thenReturn(new PageImpl<>(List.of(s4300, s4200a, s4200b, s4100)));
        when(repository.countCurrentGroupedByDamage(TIER10_VEHICLE))
                .thenReturn(List.of(
                        new Object[]{4300, 1L},
                        new Object[]{4200, 2L},
                        new Object[]{4100, 1L}));

        final HundredLeaderboardPageDto dto = service.leaderboard(TIER10_VEHICLE, 1, 50);

        assertThat(dto.items()).extracting("rank").containsExactly(1, 2, 2, 4);
        assertThat(dto.items()).extracting("approvedAverageDamage").containsExactly(4300, 4200, 4200, 4100);
    }

    @Test
    void leaderboardTieAcrossPageBoundaryKeepsGlobalRank() {
        final HundredBattleSubmission s4200a = currentSubmission(4200);
        s4200a.setId(2L);
        final HundredBattleSubmission s4200b = currentSubmission(4200);
        s4200b.setId(3L);
        // 页面只含同分两行（tie 从上一页延续），4300 组在页外
        when(repository.findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                eq(TIER10_VEHICLE), eq("CURRENT"), any()))
                .thenReturn(new PageImpl<>(List.of(s4200a, s4200b)));
        when(repository.countCurrentGroupedByDamage(TIER10_VEHICLE))
                .thenReturn(List.of(new Object[]{4300, 1L}, new Object[]{4200, 2L}));

        final HundredLeaderboardPageDto dto = service.leaderboard(TIER10_VEHICLE, 2, 2);

        assertThat(dto.items()).extracting("rank").containsExactly(2, 2);
    }

    // ── Files：创建失败不持久化 ──────────────────────────────────────────

    @Test
    void createFailureNeverPersistsSubmission() throws Exception {
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));

            // 第 2 份与第 1 份同 arena → 失败；已解析的前面文件不应产生任何持久化
            assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", replays(5, "a1", "a1", "a3", "a4", "a5")))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        }
        verify(repository, never()).saveAndFlush(any());
        verify(repository, never()).save(any());
    }
}