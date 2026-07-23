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
        // 同一场同队 → 只产生 1 个视角组
        assertEquals(1, plan.groups().size());
    }

    @Test
    void multipleSameArenaDifferentTeams() {
        final var r1 = makeResult("t1.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var r2 = makeResult("t2.wotbreplay", "arena1", 2, true, true, ReplayProcessingStatus.SUCCESS);
        final var plan = analyzer.analyze(List.of(r1, r2));
        // 不同队伍 → 2 个独立视角组
        assertEquals(2, plan.groups().size());
    }

    @Test
    void representativeSelectionPrefersReconstruction() {
        final var r1 = makeResult("no-recon.wotbreplay", "arena1", 1, false, false, ReplayProcessingStatus.PARTIAL_SUCCESS);
        final var r2 = makeResult("with-recon.wotbreplay", "arena1", 1, true, true, ReplayProcessingStatus.SUCCESS);
        final var plan = analyzer.analyze(List.of(r1, r2));
        assertEquals(1, plan.groups().size());
        // 代表应该是 reconstruction 成功的那个
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
}