package com.wotb.core.replay.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BatchAnalyzer 测试：视角分组、代表选择、模式判定。
 */
class BatchAnalyzerTest {

    private final BatchAnalyzer analyzer = new BatchAnalyzer();

    // ---- 辅助工厂 ----

    private static ReplayProcessingResult makeResult(
            String fileName, String arenaId, int team,
            boolean reconstructionOk, boolean participantIsRecorder,
            ReplayProcessingStatus status) {

        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "test_map";
        battle.arenaBonusType = 1; // RANDOM
        if (team > 0) {
            final PlayerResult pr = new PlayerResult();
            pr.accountId = 1000L;
            pr.nickname = "PlayerA";
            pr.team = team;
            battle.players = List.of(pr);
            battle.recorder = "PlayerA";
        }

        final ReplayReconstruction reconstruction = reconstructionOk
                ? new ReplayReconstruction(null, null, 300f, null,
                List.of(new BattleParticipant(1000L, "PlayerA", team, 0, "", participantIsRecorder)),
                List.of(), List.of(), null, null, null)
                : null;

        final boolean reconOk = reconstruction != null;
        final boolean recorderResultAvailable = battle.recorderResult() != null;
        final boolean recorderEntityMapped = participantIsRecorder && reconOk;
        final ReplayProcessingCapabilities caps = new ReplayProcessingCapabilities(
                true, recorderResultAvailable, reconOk,
                recorderEntityMapped, recorderEntityMapped, false,
                reconOk, false);

        return new ReplayProcessingResult(
                fileName, status, null, battle, reconstruction,
                null, caps, null, null);
    }

    private static ReplayProcessingResult makeFailed(final String fileName) {
        return new ReplayProcessingResult(
                fileName, ReplayProcessingStatus.FAILED, null, null, null,
                null, ReplayProcessingCapabilities.NONE,
                ReplayProcessingError.of("FAILED", "Test failure"), null);
    }

    private static ReplayProcessingResult makeTeamResult(
            final String fileName,
            final String arenaId,
            final int arenaBonusType,
            final long recorderAccountId,
            final int team,
            final boolean reconstructionAvailable
    ) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "team_map";
        battle.arenaBonusType = arenaBonusType;
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = recorderAccountId;
        recorder.nickname = "Player" + recorderAccountId;
        recorder.team = team;
        battle.players = List.of(recorder);
        battle.recorder = recorder.nickname;

        final ReplayReconstruction reconstruction = reconstructionAvailable
                ? new ReplayReconstruction(null, null, 300f, null,
                List.of(new BattleParticipant(
                        recorderAccountId, recorder.nickname, team, 0, "", true)),
                List.of(), List.of(), null, null, null)
                : null;
        final ReplayProcessingCapabilities capabilities = new ReplayProcessingCapabilities(
                true, true, reconstructionAvailable,
                reconstructionAvailable, false, true,
                false, reconstructionAvailable);
        final ReplayProcessingStatus status = reconstructionAvailable
                ? ReplayProcessingStatus.SUCCESS
                : ReplayProcessingStatus.PARTIAL_SUCCESS;
        return new ReplayProcessingResult(
                fileName,
                status,
                new ReplayIdentity(
                        "hash-" + fileName, arenaId, null, "team_map", recorderAccountId, null),
                battle,
                reconstruction,
                null,
                capabilities,
                null,
                null);
    }

    // ======== 测试用例 ========

    @Test
    void singleFile() {
        final var result = makeResult("a.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var plan = analyzer.analyze(List.of(result));
        assertEquals(1, plan.groups().size());
        assertEquals(ReplayAnalysisMode.SINGLE_PLAYER_BATTLE, plan.mode());
        assertNotNull(plan.dominantScope());
    }

    @Test
    void multipleSameArenaSameTeam() {
        final var r1 = makeResult("p1.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var r2 = makeResult("p2.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.groups().size());
    }

    @Test
    void multipleDifferentTeamsFailLoud() {
        final var r1 = makeResult("t1.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var r2 = makeResult("t2.wotbreplay", "arena1", 2, true, true, ReplayProcessingStatus.SUCCESS);
        assertThrows(IllegalStateException.class, () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void representativeSelectionPrefersReconstruction() {
        final var r1 = makeResult("no-recon.wotbreplay", "arena1", 1, false, false, ReplayProcessingStatus.PARTIAL_SUCCESS);
        final var r2 = makeResult("with-recon.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.groups().size());
        assertEquals("with-recon.wotbreplay", plan.groups().getFirst().representative().fileName());
    }

    @Test
    void failedFileIsSkipped() {
        final var ok = makeResult("good.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var failed = makeFailed("bad.zip");
        final var plan = analyzer.analyze(List.of(ok, failed));
        assertEquals(1, plan.groups().size());
    }

    @Test
    void noAnalyzableResults() {
        final var failed = makeFailed("bad.zip");
        final var plan = analyzer.analyze(List.of(failed));
        assertNull(plan.dominantScope());
    }

    // ======== 18.2: 录像者映射测试 ========

    @Test
    void multipleBattlesSameRecorderFailLoud() {
        final var r1 = makeResult("a.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var r2 = makeResult("b.wotbreplay", "arena2", 1, true, true, ReplayProcessingStatus.SUCCESS);
        assertThrows(IllegalStateException.class, () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void mixedRecorderThrowsException() {
        final Battle b1 = new Battle();
        b1.arenaId = "arena1"; b1.mapName = "map1"; b1.arenaBonusType = 1;
        final PlayerResult p1 = new PlayerResult(); p1.accountId = 1000L; p1.nickname = "PlayerA"; p1.team = 1;
        b1.players = List.of(p1); b1.recorder = "PlayerA";
        final ReplayReconstruction rec1 = new ReplayReconstruction(null, null, 300f, null,
                List.of(new BattleParticipant(1000L, "PlayerA", 1, 0, "", true)),
                List.of(), List.of(), null, null, null);
        final var caps1 = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b1, rec1, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final ReplayReconstruction rec2 = new ReplayReconstruction(null, null, 300f, null,
                List.of(new BattleParticipant(2000L, "PlayerB", 1, 0, "", true)),
                List.of(), List.of(), null, null, null);
        final var caps2 = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b2, rec2, null, caps2, null, null);

        assertThrows(MixedRandomBattleRecordersException.class,
                () -> analyzer.analyze(List.of(r1, r2)));
    }

    // ======== P1-1: 无 reconstruction 时的录像者检测 ========

    @Test
    void mixedRecorderNoReconstructionThrows() {
        final Battle b1 = new Battle();
        b1.arenaId = "arena1"; b1.mapName = "map1"; b1.arenaBonusType = 1;
        final PlayerResult p1 = new PlayerResult(); p1.accountId = 1000L; p1.nickname = "PlayerA"; p1.team = 1;
        b1.players = List.of(p1); b1.recorder = "PlayerA";
        final var caps1 = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b1, null, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final var caps2 = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b2, null, null, caps2, null, null);

        assertThrows(MixedRandomBattleRecordersException.class,
                () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void multipleBattlesNoReconstructionFailLoud() {
        final Battle b1 = new Battle();
        b1.arenaId = "arena1"; b1.mapName = "map1"; b1.arenaBonusType = 1;
        final PlayerResult p1 = new PlayerResult(); p1.accountId = 1000L; p1.nickname = "PlayerA"; p1.team = 1;
        b1.players = List.of(p1); b1.recorder = "PlayerA";
        final var caps1 = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b1, null, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 1000L; p2.nickname = "PlayerA"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerA";
        final var caps2 = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b2, null, null, caps2, null, null);

        assertThrows(IllegalStateException.class, () -> analyzer.analyze(List.of(r1, r2)));
    }

    // ======== P2: 精确重复去重测试 ========

    @Test
    void exactDuplicateContentIsDeduped() {
        final var identity = new ReplayIdentity("same-hash", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);

        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.groups().size(), "Same content should produce 1 perspective group");
        // 精确重复由 ExactReplayDuplicateDetector 负责（见其单测）；BatchAnalyzer 只暴露分组/模式
        final var partition = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(1, partition.count());
        assertEquals("b.wotbreplay", partition.duplicates().getFirst().duplicate().fileName());
    }

    @Test
    void differentContentSameBattleSameTeamIsTeamDuplicate() {
        final var id1 = new ReplayIdentity("hash-1", null, null, null, null, null);
        final var id2 = new ReplayIdentity("hash-2", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);

        final var r1 = new ReplayProcessingResult("p1.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("p2.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.groups().size(), "Same battle+team → 1 group");
        assertEquals(0, ExactReplayDuplicateDetector.partition(List.of(r1, r2)).count(),
                "Different content → not exact duplicate");
    }

    @Test
    void exactDuplicateNotCountedAsTeamDuplicate() {
        final var identity = new ReplayIdentity("same-hash", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);

        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r3 = new ReplayProcessingResult("c.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2, r3));
        assertEquals(1, plan.groups().size());
        assertEquals(2, ExactReplayDuplicateDetector.partition(List.of(r1, r2, r3)).count(),
                "2 exact duplicates from 3 identical files");
    }

    // ======== UNKNOWN battle category 测试 ========

    @Test
    void unknownCategoryResultIsExcluded() {
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1";
        // arenaBonusType left null → UNKNOWN category
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);

        final var r = new ReplayProcessingResult("unknown.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b, null, null, caps, null, null);
        final var plan = analyzer.analyze(List.of(r));

        assertEquals(0, plan.groups().size(), "UNKNOWN category produces no perspective groups");
        assertNull(plan.dominantScope(), "UNKNOWN-only results have null scope");
    }

    @Test
    void unknownAndRandomMixedThrows() {
        // RANDOM result
        final Battle b1 = new Battle();
        b1.arenaId = "arena1"; b1.mapName = "map1"; b1.arenaBonusType = 1;
        final PlayerResult p1 = new PlayerResult(); p1.accountId = 1000L; p1.nickname = "PlayerA"; p1.team = 1;
        b1.players = List.of(p1); b1.recorder = "PlayerA";
        final var caps1 = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        final var r1 = new ReplayProcessingResult("random.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b1, null, null, caps1, null, null);

        // UNKNOWN result
        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2";
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 2;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final var caps2 = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r2 = new ReplayProcessingResult("unknown.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b2, null, null, caps2, null, null);

        assertThrows(MixedAnalysisScopesException.class,
                () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void unknownCategoryDoesNotAffectExactDuplicateCount() {
        final var identity = new ReplayIdentity("hash-x", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1";
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);

        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, ExactReplayDuplicateDetector.partition(List.of(r1, r2)).count(),
                "Exact duplicate detected regardless of UNKNOWN category");
        assertEquals(0, plan.groups().size(), "UNKNOWN → no groups");
    }

    // ======== Failed file 不影响 duplicate 计数 ========

    @Test
    void failedFileNotCountedInDuplicateOrGroup() {
        final var identity = new ReplayIdentity("hash-1", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);

        final var valid = new ReplayProcessingResult("good.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var failed = new ReplayProcessingResult("bad.zip", ReplayProcessingStatus.FAILED, null, null, null, null, ReplayProcessingCapabilities.NONE,
                ReplayProcessingError.of("FILE_VALIDATION_FAILED", "Bad file"), null);

        final var plan = analyzer.analyze(List.of(valid, failed));
        assertEquals(1, plan.groups().size(), "Failed file excluded from groups");
        assertEquals(0, ExactReplayDuplicateDetector.partition(List.of(valid, failed)).count(),
                "Failed file not counted as duplicate");
    }

    // ======== Canonical battle key 测试 ========

    @Test
    void sameArenaIdSameTeamGroupsTogether() {
        final var id1 = new ReplayIdentity("h1", "arena-1", null, null, null, null);
        final var id2 = new ReplayIdentity("h2", "arena-1", null, null, null, null);
        final Battle b = new Battle(); b.arenaId = "arena-1"; b.mapName = "m"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b, null, null, caps, null, null);
        assertEquals(1, analyzer.analyze(List.of(r1, r2)).groups().size());
    }

    @Test
    void multipleBattlesDifferentArenaFailLoud() {
        final var id1 = new ReplayIdentity("h1", "arena-1", null, null, 1000L, null);
        final var id2 = new ReplayIdentity("h2", "arena-2", null, null, 1000L, null);
        final Battle b1 = new Battle(); b1.arenaId = "arena-1"; b1.mapName = "m1"; b1.arenaBonusType = 1;
        final Battle b2 = new Battle(); b2.arenaId = "arena-2"; b2.mapName = "m2"; b2.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b1.players = List.of(pr); b1.recorder = "P"; b2.players = List.of(pr); b2.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertThrows(IllegalStateException.class, () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void nullArenaIdSameMapSameTimeGroupsTogether() {
        final var start = java.time.Instant.now();
        final var id1 = new ReplayIdentity("h1", null, "11.18", "lagoon", 1000L, start);
        final var id2 = new ReplayIdentity("h2", null, "11.18", "lagoon", 1000L, start);
        final Battle b1 = new Battle(); b1.arenaId = ""; b1.mapName = "lagoon"; b1.arenaBonusType = 1;
        final Battle b2 = new Battle(); b2.arenaId = ""; b2.mapName = "lagoon"; b2.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b1.players = List.of(pr); b1.recorder = "P"; b2.players = List.of(pr); b2.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertEquals(1, analyzer.analyze(List.of(r1, r2)).groups().size());
    }

    @Test
    void multipleBattlesDifferentTimeFailLoud() {
        final var id1 = new ReplayIdentity("h1", null, "11.18", "lagoon", 1000L, java.time.Instant.ofEpochSecond(1000));
        final var id2 = new ReplayIdentity("h2", null, "11.18", "lagoon", 1000L, java.time.Instant.ofEpochSecond(2000));
        final Battle b1 = new Battle(); b1.arenaId = ""; b1.mapName = "lagoon"; b1.arenaBonusType = 1;
        final Battle b2 = new Battle(); b2.arenaId = ""; b2.mapName = "lagoon"; b2.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b1.players = List.of(pr); b1.recorder = "P"; b2.players = List.of(pr); b2.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertThrows(IllegalStateException.class, () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void multipleBattlesMissingMetadataFailLoud() {
        final var id1 = new ReplayIdentity("hash-a", null, null, null, 1000L, null);
        final var id2 = new ReplayIdentity("hash-b", null, null, null, 1000L, null);
        final Battle b1 = new Battle(); b1.arenaId = ""; b1.mapName = ""; b1.arenaBonusType = 1;
        final Battle b2 = new Battle(); b2.arenaId = ""; b2.mapName = ""; b2.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b1.players = List.of(pr); b1.recorder = "P"; b2.players = List.of(pr); b2.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertThrows(IllegalStateException.class, () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void analyzePartitionReusesPassedDuplicates() {
        var id = new ReplayIdentity("same-hash", null, null, null, null, null);
        var b = new Battle(); b.arenaBonusType = 1;
        var pr = new PlayerResult(); pr.accountId = 1L; pr.nickname = "P"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "P";
        var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        var partition = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        var plan = new BatchAnalyzer().analyzePartition(partition);
        assertEquals(1, plan.groups().size());
    }

    // ======== Team perspective modes ========

    @Test
    void trainingBattleUsesSingleTeamMode() {
        final var result = makeTeamResult(
                "training.wotbreplay", "training-arena", 2, 1001L, 1, true);

        final var plan = analyzer.analyze(List.of(result));

        assertEquals(ReplayAnalysisScope.TEAM_PERSPECTIVE, plan.dominantScope());
        assertEquals(ReplayAnalysisMode.SINGLE_TEAM_BATTLE, plan.mode());
        assertEquals(1, plan.groups().size());
        assertEquals(1, plan.groups().getFirst().key().perspectiveTeam());
    }

    @Test
    void tournamentBattleUsesSingleTeamMode() {
        final var result = makeTeamResult(
                "tournament.wotbreplay", "tournament-arena", 3, 1001L, 1, true);

        final var plan = analyzer.analyze(List.of(result));

        assertEquals(ReplayAnalysisScope.TEAM_PERSPECTIVE, plan.dominantScope());
        assertEquals(ReplayAnalysisMode.SINGLE_TEAM_BATTLE, plan.mode());
    }

    @Test
    void randomAndTrainingBattlesCannotShareAnAnalysisBatch() {
        final var random = makeTeamResult(
                "random.wotbreplay", "random-arena", 1, 1001L, 1, true);
        final var training = makeTeamResult(
                "training.wotbreplay", "training-arena", 2, 1002L, 1, true);

        assertThrows(MixedAnalysisScopesException.class,
                () -> analyzer.analyze(List.of(random, training)));
    }

    @Test
    void sameBattleSameTeamPerspectivesAreDeduplicated() {
        final var first = makeTeamResult(
                "team-a.wotbreplay", "shared-arena", 2, 1001L, 1, true);
        final var second = makeTeamResult(
                "team-b.wotbreplay", "shared-arena", 2, 1002L, 1, true);

        final var plan = analyzer.analyze(List.of(first, second));

        assertEquals(1, plan.groups().size());
        assertEquals(ReplayAnalysisMode.SINGLE_TEAM_BATTLE, plan.mode());
    }

    @Test
    void multipleIndependentPerspectivesFailLoud() {
        // 对立视角各自成为独立 group = 2 个可分析单元 → 违反 AI 单文件
        // single-analyzable-unit 不变量；必须 fail loud，绝不静默伪装成 SINGLE。
        //（多结果批量属旧 multipart multi 架构，已删除。）
        final var allied = makeTeamResult(
                "allied.wotbreplay", "shared-arena", 2, 1001L, 1, true);
        final var enemy = makeTeamResult(
                "enemy.wotbreplay", "shared-arena", 2, 2001L, 2, true);

        final IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> analyzer.analyze(List.of(allied, enemy)));
        assertTrue(ex.getMessage().contains("single-analyzable-unit"),
                "fail-loud message: " + ex.getMessage());
    }

    @Test
    void teamSummaryFallbackIsAnalyzableWithoutReconstruction() {
        final var result = makeTeamResult(
                "fallback.wotbreplay", "fallback-arena", 2, 1001L, 1, false);

        final var plan = analyzer.analyze(List.of(result));

        assertEquals(ReplayAnalysisMode.SINGLE_TEAM_BATTLE, plan.mode());
        assertEquals(1, plan.groups().size());
    }

    @Test
    void unresolvedTeamDoesNotBecomeTeamOne() {
        final Battle battle = new Battle();
        battle.arenaId = "observer-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.recorder = "Observer";
        battle.players = List.of();
        final var capabilities = new ReplayProcessingCapabilities(
                true, false, false, false, false, false, false, false);
        final var result = new ReplayProcessingResult(
                "observer.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "observer-hash", "observer-arena", null, "team_map", null, null),
                battle,
                null,
                null,
                capabilities,
                null,
                null);

        final var plan = analyzer.analyze(List.of(result));

        assertEquals(0, plan.groups().getFirst().key().perspectiveTeam());
        assertEquals(ReplayAnalysisMode.NONE, plan.mode());
    }
}
