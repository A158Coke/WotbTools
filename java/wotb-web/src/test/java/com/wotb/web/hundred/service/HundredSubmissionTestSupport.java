package com.wotb.web.hundred.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.testsupport.ReplayFactsJson;
import com.wotb.web.user.api.UserProfileSnapshot;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.WotbAccountIdentity;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.junit.jupiter.api.BeforeEach;
import org.mockito.Mock;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

abstract class HundredSubmissionTestSupport {

    static final long TIER10_VEHICLE = 385L;
    static final long TIER10_VEHICLE_2 = 3649L;
    static final long TIER7_VEHICLE = 113L;
    static final long GAME_ID = 111L;
    static final String WOTB_SERVER = "CN";
    static final String OTHER_SERVER = "EU";
    static final String USER = "kc-user";
    static final String ADMIN = "kc-admin";

    @Mock
    HundredBattleSubmissionRepository repository;

    @Mock
    com.wotb.web.hundred.repository.HundredAdminLogRepository auditRepository;

    @Mock
    UserProfiles userProfileService;

    @Mock
    HundredReplayEvidenceService evidenceService;

    @Mock
    com.wotb.web.replayfile.ReplayHashLock replayHashLock;

    @Mock
    org.springframework.transaction.PlatformTransactionManager transactionManager;

    ReplayCapacityLimiter capacityLimiter;

    HundredBattleSubmissionService service;
    HundredLeaderboardService leaderboardService;
    HundredAdminQueryService adminQueryService;
    HundredModerationService moderationService;

    @BeforeEach
    void setUp() {
        capacityLimiter = new ReplayCapacityLimiter(2);
        service = new HundredBattleSubmissionService(
                repository, new HundredBattleMapper(), userProfileService, evidenceService,
                capacityLimiter, replayHashLock, transactionManager);
        leaderboardService = new HundredLeaderboardService(repository, new HundredBattleMapper());
        adminQueryService = new HundredAdminQueryService(repository, new HundredBattleMapper());
        moderationService = new HundredModerationService(
                repository, auditRepository, new HundredBattleMapper(), evidenceService, transactionManager);
        org.mockito.Mockito.lenient().when(auditRepository.save(any()))
                .thenAnswer(inv -> inv.getArgument(0));
        org.mockito.Mockito.lenient().when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        org.mockito.Mockito.lenient().when(repository.saveAndFlush(any())).thenAnswer(inv -> {
            final HundredBattleSubmission s = inv.getArgument(0);
            if (s != null) {
                s.setId(10L);
            }
            return s;
        });
        org.mockito.Mockito.lenient().when(replayHashLock.runWithLocksResult(anyList(), any()))
                .thenAnswer(inv -> ((java.util.function.Supplier<?>) inv.getArgument(1)).get());
        org.mockito.Mockito.lenient().when(transactionManager.getTransaction(any()))
                .thenReturn(org.mockito.Mockito.mock(org.springframework.transaction.TransactionStatus.class));
    }


    static UserProfileSnapshot profile() {
        return new UserProfileSnapshot(1L, USER, "PlayerOne", GAME_ID,
                "PlayerOne", WOTB_SERVER, null, null);
    }

    static WotbAccountIdentity identity() {
        return new WotbAccountIdentity(WOTB_SERVER, GAME_ID);
    }

    static UserProfileSnapshot profileWithoutGameId() {
        return new UserProfileSnapshot(1L, USER, "PlayerOne", null,
                "PlayerOne", WOTB_SERVER, null, null);
    }

    static UserProfileSnapshot profileWithoutNickname() {
        return new UserProfileSnapshot(1L, USER, "PlayerOne", GAME_ID,
                null, WOTB_SERVER, null, null);
    }

    static Battle battle(final String arenaId) {
        return battle(arenaId, GAME_ID, TIER10_VEHICLE);
    }

    static Battle battle(final String arenaId, final long gameId, final long vehicleId) {
        final Battle b = new Battle();
        b.arenaId = arenaId;
        b.arenaBonusType = 1;
        final PlayerResult p = new PlayerResult();
        p.accountId = gameId;
        p.nickname = "PlayerOne";
        p.tankId = vehicleId;
        p.team = 1;
        p.damageDealt = 3200;
        b.recorder = p.nickname;
        b.players = new ArrayList<>(List.of(p));
        return b;
    }

    static List<String> facts(final List<MultipartFile> files) {
        return facts(files, HundredSubmissionTestSupport::battle);
    }

    static List<String> facts(final List<MultipartFile> files, final Function<String, Battle> toBattle) {
        return files.stream().map(f -> ReplayFactsJson.of(toBattle.apply(arenaOf(f)))).toList();
    }

    static List<String> sameFacts(final List<MultipartFile> files, final Battle battle) {
        return files.stream().map(f -> ReplayFactsJson.of(battle)).toList();
    }

    static List<String> invalidFacts(final List<MultipartFile> files) {
        return files.stream().map(f -> "not json").toList();
    }

    static String arenaOf(final MultipartFile file) {
        try {
            return new String(file.getBytes());
        } catch (final java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    static List<MultipartFile> replays(final int count, final String... arenaIds) {
        final List<MultipartFile> files = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            final String arena = arenaIds != null && i < arenaIds.length
                    ? arenaIds[i] : "arena-" + (i + 1);
            files.add(new MockMultipartFile("replays", "battle-" + i + ".wotbreplay",
                    "application/octet-stream", arena.getBytes()));
        }
        return files;
    }

    static List<MultipartFile> duplicateArenaReplays() {
        return replays(5, "a1", "a1", "a3", "a4", "a5");
    }

    static List<MultipartFile> fiveReplays() {
        return replays(5, "a1", "a2", "a3", "a4", "a5");
    }

    static HundredBattleSubmission pendingSubmission() {
        final HundredBattleSubmission s = new HundredBattleSubmission();
        s.setId(10L);
        s.setVehicleId(TIER10_VEHICLE);
        s.setVehicleName("Progetto 65");
        s.setWotbServer(WOTB_SERVER);
        s.setWotbAccountId(GAME_ID);
        s.setNicknameSnapshot("PlayerOne");
        s.setClaimedAverageDamage(4200);
        s.setClaimedBattleCount(136);
        s.setStatus("PENDING");
        s.setProofScreenshot("data:image/png;base64,AAAA");
        return s;
    }

    static HundredBattleSubmission currentSubmission(final int approvedDamage) {
        final HundredBattleSubmission s = pendingSubmission();
        s.setStatus("CURRENT");
        s.setApprovedAverageDamage(approvedDamage);
        s.setApprovedBattleCount(151);
        s.setApprovedAt(OffsetDateTime.parse("2026-08-01T00:00:00Z"));
        s.setApprovedBy(ADMIN);
        return s;
    }



}
