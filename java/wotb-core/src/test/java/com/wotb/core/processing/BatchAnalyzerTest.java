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
            boolean reconstructionOk, boolean recorderMapped,
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
                List.of(new BattleParticipant(1000L, "PlayerA", team, 0, "", recorderMapped)),
                List.of(), List.of(), null, null, null)
                : null;

        final boolean reconOk = reconstruction != null;
        final ReplayProcessingCapabilities caps = ReplayProcessingCapabilities.of(
                true, reconOk, recorderMapped && reconOk,
                false, reconOk, false, ReplayAnalysisScope.PLAYER_FOCUSED);

        return new ReplayProcessingResult(
                fileName, status, null, battle, reconstruction,
                null, caps, null, null);
    }

    private static ReplayProcessingResult makeFailed(String fileName) {
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
        final var caps1 = ReplayProcessingCapabilities.of(true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, b1, rec1, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final ReplayReconstruction rec2 = new ReplayReconstruction(null, null, 300f, null,
                List.of(new BattleParticipant(2000L, "PlayerB", 1, 0, "", true)),
                List.of(), List.of(), null, null, null);
        final var caps2 = ReplayProcessingCapabilities.of(true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
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
        final var caps1 = ReplayProcessingCapabilities.of(true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b1, null, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 2000L; p2.nickname = "PlayerB"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerB";
        final var caps2 = ReplayProcessingCapabilities.of(true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
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
        final var caps1 = ReplayProcessingCapabilities.of(true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b1, null, null, caps1, null, null);

        final Battle b2 = new Battle();
        b2.arenaId = "arena2"; b2.mapName = "map2"; b2.arenaBonusType = 1;
        final PlayerResult p2 = new PlayerResult(); p2.accountId = 1000L; p2.nickname = "PlayerA"; p2.team = 1;
        b2.players = List.of(p2); b2.recorder = "PlayerA";
        final var caps2 = ReplayProcessingCapabilities.of(true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS, null, b2, null, null, caps2, null, null);

        assertDoesNotThrow(() -> analyzer.analyze(List.of(r1, r2)));
    }
}
