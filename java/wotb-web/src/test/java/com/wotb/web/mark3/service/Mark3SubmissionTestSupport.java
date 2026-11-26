package com.wotb.web.mark3.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.testsupport.ReplayFactsJson;
import com.wotb.web.user.api.UserProfileSnapshot;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.WotbAccountIdentity;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.mockito.Mock;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.multipart.MultipartFile;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

abstract class Mark3SubmissionTestSupport {

    static final long TIER10_VEHICLE = 385L;
    static final long GAME_ID = 111L;
    static final String WOTB_SERVER = "CN";
    static final String OTHER_SERVER = "EU";
    static final String USER = "kc-user";
    static final String ADMIN = "kc-admin";
    static final String IMAGE_ONE = "data:image/png;base64,AAAA";
    static final String IMAGE_TWO = "data:image/jpeg;base64,BBBB";

    @Mock
    Mark3SubmissionRepository repository;

    @Mock
    UserProfiles userProfileService;

    @Mock
    Mark3ReplayEvidenceService evidenceService;

    @Mock
    com.wotb.web.replayfile.ReplayHashLock replayHashLock;

    @Mock
    PlatformTransactionManager transactionManager;

    Mark3SubmissionService service;
    Mark3LeaderboardService leaderboardService;
    Mark3ModerationService moderationService;

    @BeforeEach
    void setUp() {
        service = newService(new ReplayCapacityLimiter(2));
        leaderboardService = new Mark3LeaderboardService(repository, new Mark3Mapper());
        moderationService = new Mark3ModerationService(repository, new Mark3Mapper(), evidenceService, transactionManager);
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





    Mark3SubmissionService newService(final ReplayCapacityLimiter limiter) {
        return new Mark3SubmissionService(
                repository, new Mark3Mapper(), userProfileService, limiter,
                evidenceService, replayHashLock, transactionManager);
    }

    static UserProfileSnapshot profile() {
        return new UserProfileSnapshot(1L, USER, "PlayerOne", GAME_ID,
                "PlayerOne", WOTB_SERVER, null, null);
    }

    static WotbAccountIdentity identity() {
        return new WotbAccountIdentity(WOTB_SERVER, GAME_ID);
    }

    static Mark3Submission pendingSubmission() {
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(10L);
        submission.setVehicleId(TIER10_VEHICLE);
        submission.setVehicleName("Progetto 65");
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

    static Mark3Submission currentSubmission(final int battleCount) {
        final Mark3Submission submission = pendingSubmission();
        submission.setStatus("CURRENT");
        submission.setApprovedBattleCount(battleCount);
        submission.setApprovedAverageDamage(3_456);
        submission.setApprovedWinRate(new BigDecimal("55.25"));
        submission.setApprovedAt(OffsetDateTime.parse("2026-08-01T00:00:00Z"));
        return submission;
    }

    static List<MultipartFile> fiveReplays() {
        final List<MultipartFile> files = new ArrayList<>();
        for (int index = 1; index <= 5; index++) {
            files.add(new MockMultipartFile(
                    "replays", "battle-" + index + ".wotbreplay", "application/octet-stream",
                    ("arena-" + index).getBytes()));
        }
        return files;
    }

    static Battle battle(final String arenaId) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        final PlayerResult player = new PlayerResult();
        player.accountId = GAME_ID;
        player.nickname = "PlayerOne";
        player.tankId = TIER10_VEHICLE;
        player.team = 1;
        battle.recorder = player.nickname;
        battle.players = new ArrayList<>(List.of(player));
        return battle;
    }

    static List<String> facts(final List<MultipartFile> files) {
        return files.stream().map(file -> {
            try {
                return ReplayFactsJson.of(battle(new String(file.getBytes())));
            } catch (final java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        }).toList();
    }

}
