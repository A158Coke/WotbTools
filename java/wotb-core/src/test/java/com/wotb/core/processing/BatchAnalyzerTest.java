package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

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
        final ReplayProcessingCapabilities caps = ReplayProcessingCapabilities.of(
                true, recorderResultAvailable, reconOk,
                recorderEntityMapped, false,
                reconOk, false, ReplayAnalysisScope.PLAYER_FOCUSED);

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

    // ======== 测试用例 ========

    @Test
    void singleFile() {
        final var result = makeResult("a.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var plan = analyzer.analyze(List.of(result));
        assertEquals(1, plan.effectiveUnitCount());
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
    void multipleSameArenaDifferentTeams() {
        final var r1 = makeResult("t1.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var r2 = makeResult("t2.wotbreplay", "arena1", 2, true, true, ReplayProcessingStatus.SUCCESS);
        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(2, plan.groups().size());
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
    void sameRecorderMultiBattleNoException() {
        final var r1 = makeResult("a.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var r2 = makeResult("b.wotbreplay", "arena2", 1, true, true, ReplayProcessingStatus.SUCCESS);
        assertDoesNotThrow(() -> analyzer.analyze(List.of(r1, r2)));
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
        final var caps1 = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b1, rec1, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final ReplayReconstruction rec2 = new ReplayReconstruction(null, null, 300f, null,
                List.of(new BattleParticipant(2000L, "PlayerB", 1, 0, "", true)),
                List.of(), List.of(), null, null, null);
        final var caps2 = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
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
        final var caps1 = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b1, null, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final var caps2 = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b2, null, null, caps2, null, null);

        assertThrows(MixedRandomBattleRecordersException.class,
                () -> analyzer.analyze(List.of(r1, r2)));
    }

    @Test
    void sameRecorderNoReconstructionNoException() {
        final Battle b1 = new Battle();
        b1.arenaId = "arena1"; b1.mapName = "map1"; b1.arenaBonusType = 1;
        final PlayerResult p1 = new PlayerResult(); p1.accountId = 1000L; p1.nickname = "PlayerA"; p1.team = 1;
        b1.players = List.of(p1); b1.recorder = "PlayerA";
        final var caps1 = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b1, null, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 1000L; p2.nickname = "PlayerA"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerA";
        final var caps2 = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b2, null, null, caps2, null, null);

        assertDoesNotThrow(() -> analyzer.analyze(List.of(r1, r2)));
    }

    // ======== P2: 精确重复去重测试 ========

    @Test
    void exactDuplicateContentIsDeduped() {
        final var identity = new ReplayIdentity("same-hash", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);

        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.groups().size(), "Same content should produce 1 perspective group");
        assertEquals(1, plan.exactDuplicateCount(), "Second identical file is exact duplicate");
        assertEquals(1, plan.exactDuplicates().size());
        assertEquals("b.wotbreplay", plan.exactDuplicates().getFirst().duplicate().fileName());
    }

    @Test
    void differentContentSameBattleSameTeamIsTeamDuplicate() {
        final var id1 = new ReplayIdentity("hash-1", null, null, null, null, null);
        final var id2 = new ReplayIdentity("hash-2", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);

        final var r1 = new ReplayProcessingResult("p1.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("p2.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.groups().size(), "Same battle+team → 1 group");
        assertEquals(1, plan.sameTeamDuplicatePerspectiveCount(), "Second is same-team duplicate perspective");
        assertEquals(0, plan.exactDuplicateCount(), "Different content → not exact duplicate");
    }

    @Test
    void exactDuplicateNotCountedAsTeamDuplicate() {
        final var identity = new ReplayIdentity("same-hash", null, null, null, null, null);
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);

        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r3 = new ReplayProcessingResult("c.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2, r3));
        assertEquals(1, plan.groups().size());
        assertEquals(2, plan.exactDuplicateCount(), "2 exact duplicates from 3 identical files");
        assertEquals(0, plan.sameTeamDuplicatePerspectiveCount());
    }

    // ======== UNKNOWN battle category 测试 ========

    @Test
    void unknownCategoryResultIsExcluded() {
        final Battle b = new Battle();
        b.arenaId = "arena1"; b.mapName = "map1";
        // arenaBonusType left null → UNKNOWN category
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "PlayerA"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "PlayerA";
        final var caps = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);

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
        final var caps1 = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("random.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b1, null, null, caps1, null, null);

        // UNKNOWN result
        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2";
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 2;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final var caps2 = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
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
        final var caps = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);

        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);

        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.exactDuplicateCount(), "Exact duplicate detected regardless of UNKNOWN category");
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
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);

        final var valid = new ReplayProcessingResult("good.wotbreplay", ReplayProcessingStatus.SUCCESS, identity, b, null, null, caps, null, null);
        final var failed = new ReplayProcessingResult("bad.zip", ReplayProcessingStatus.FAILED, null, null, null, null, ReplayProcessingCapabilities.NONE,
                ReplayProcessingError.of("FILE_VALIDATION_FAILED", "Bad file"), null);

        final var plan = analyzer.analyze(List.of(valid, failed));
        assertEquals(1, plan.groups().size(), "Failed file excluded from groups");
        assertEquals(0, plan.exactDuplicateCount(), "Failed file not counted as duplicate");
        assertEquals(0, plan.sameTeamDuplicatePerspectiveCount(), "Failed file not counted as team duplicate");
    }

    // ======== Canonical battle key 测试 ========

    @Test
    void sameArenaIdSameTeamGroupsTogether() {
        final var id1 = new ReplayIdentity("h1", "arena-1", null, null, null, null);
        final var id2 = new ReplayIdentity("h2", "arena-1", null, null, null, null);
        final Battle b = new Battle(); b.arenaId = "arena-1"; b.mapName = "m"; b.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "P";
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b, null, null, caps, null, null);
        assertEquals(1, analyzer.analyze(List.of(r1, r2)).groups().size());
    }

    @Test
    void differentArenaIdDifferentBattles() {
        final var id1 = new ReplayIdentity("h1", "arena-1", null, null, 1000L, null);
        final var id2 = new ReplayIdentity("h2", "arena-2", null, null, 1000L, null);
        final Battle b1 = new Battle(); b1.arenaId = "arena-1"; b1.mapName = "m1"; b1.arenaBonusType = 1;
        final Battle b2 = new Battle(); b2.arenaId = "arena-2"; b2.mapName = "m2"; b2.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b1.players = List.of(pr); b1.recorder = "P"; b2.players = List.of(pr); b2.recorder = "P";
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertEquals(2, analyzer.analyze(List.of(r1, r2)).groups().size());
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
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertEquals(1, analyzer.analyze(List.of(r1, r2)).groups().size());
    }

    @Test
    void nullArenaIdDifferentTimeDifferentBattles() {
        final var id1 = new ReplayIdentity("h1", null, "11.18", "lagoon", 1000L, java.time.Instant.ofEpochSecond(1000));
        final var id2 = new ReplayIdentity("h2", null, "11.18", "lagoon", 1000L, java.time.Instant.ofEpochSecond(2000));
        final Battle b1 = new Battle(); b1.arenaId = ""; b1.mapName = "lagoon"; b1.arenaBonusType = 1;
        final Battle b2 = new Battle(); b2.arenaId = ""; b2.mapName = "lagoon"; b2.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b1.players = List.of(pr); b1.recorder = "P"; b2.players = List.of(pr); b2.recorder = "P";
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertEquals(2, analyzer.analyze(List.of(r1, r2)).groups().size());
    }

    @Test
    void missingMetadataDifferentHashesRemainDifferentBattles() {
        final var id1 = new ReplayIdentity("hash-a", null, null, null, 1000L, null);
        final var id2 = new ReplayIdentity("hash-b", null, null, null, 1000L, null);
        final Battle b1 = new Battle(); b1.arenaId = ""; b1.mapName = ""; b1.arenaBonusType = 1;
        final Battle b2 = new Battle(); b2.arenaId = ""; b2.mapName = ""; b2.arenaBonusType = 1;
        final PlayerResult pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        b1.players = List.of(pr); b1.recorder = "P"; b2.players = List.of(pr); b2.recorder = "P";
        final var caps = ReplayProcessingCapabilities.of(true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, b1, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, b2, null, null, caps, null, null);
        assertEquals(2, analyzer.analyze(List.of(r1, r2)).groups().size());
    }
}
