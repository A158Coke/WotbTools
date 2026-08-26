package com.wotb.core.replay.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * 处理门面的能力标记与模式判断（失败/去重侧，不依赖真实回放样本）。
 * 有效回放的单场/多场覆盖属于集成测试（需样本 fixture）。
 */
class DefaultReplayProcessingFacadeTest {

    private final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();

    private static Source src(final String name, final byte... bytes) {
        return new Source(name, bytes);
    }

    @Test
    void garbageIsNotAnalyzable_modeNone() {
        final ReplayBatchProcessingResult r = facade.processBatch(
                List.of(src("a.wotbreplay", (byte) 1, (byte) 2, (byte) 3)),
                ReplayProcessingOptions.full());

        assertEquals(ReplayAnalysisMode.NONE, r.suggestedAnalysisMode());
        final ReplayProcessingResult one = r.results().get(0);
        assertEquals(ReplayProcessingStatus.FAILED, one.status());
        assertNotNull(one.capabilities());
        assertFalse(one.capabilities().recorderResultAvailable(), "garbage must not be AI-analyzable");
    }

    @Test
    void identicalContentNotDedupedInFacade() {
        // Facade 不再做 content-hash 去重，由 BatchAnalyzer 统一处理
        final byte[] same = {9, 8, 7, 6, 5};
        final ReplayBatchProcessingResult r = facade.processBatch(
                List.of(new Source("a.wotbreplay", same), new Source("b.wotbreplay", same)),
                ReplayProcessingOptions.full());

        assertEquals(2, r.results().size());
        // 不再标记为 DUPLICATE_FILE，两个都正常处理（均解析失败）
        assertEquals("SUMMARY_PARSE_FAILED", r.results().get(1).error().code());
        // 均不可分析 → 模式 NONE
        final long analyzable = r.results().stream()
                .filter(x -> x.capabilities() != null && x.capabilities().recorderResultAvailable())
                .count();
        assertEquals(0, analyzable);
        assertEquals(ReplayAnalysisMode.NONE, r.suggestedAnalysisMode());
    }

    // ======== 批量汇总一致性测试 ========

    private static ReplayProcessingResult makeBattleResult(
            final String name,
            final String hash,
            final int arenaBonusType,
            final long accountId) {
        final var b = new Battle();
        b.arenaId = "a";
        b.mapName = "m";
        b.arenaBonusType = arenaBonusType;
        final var pr = new PlayerResult();
        pr.accountId = accountId;
        pr.nickname = "P";
        pr.team = 1;
        b.players = List.of(pr);
        b.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        return new ReplayProcessingResult(
                name, ReplayProcessingStatus.SUCCESS,
                new ReplayIdentity(hash, null, null, null, accountId, null),
                b, null, null, caps, null, null);
    }

    @Test
    void sameHashBatchConsistency() {
        var r1 = makeBattleResult("a.wotbreplay", "hash-x", 1, 1000L);
        var r2 = makeBattleResult("b.wotbreplay", "hash-x", 1, 1000L);
        var result = facade.buildBatchResult(2, List.of(r1, r2));
        assertEquals(1, result.summary().totalDuplicates());
        assertEquals(1, result.summary().duplicateFileNames().size());
        assertEquals(ReplayAnalysisMode.SINGLE_PLAYER_BATTLE, result.suggestedAnalysisMode());
    }

    @Test
    void nullIdentityNoDuplicate() {
        var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null, null, caps, null, null);
        var r2 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null, null, caps, null, null);
        var result = facade.buildBatchResult(2, List.of(r1, r2));
        assertEquals(0, result.summary().totalDuplicates());
    }

    @Test
    void mixedScopeWithExactDuplicate() {
        var orig = makeBattleResult("a.wotbreplay", "hash-x", 1, 1000L);
        var dup = makeBattleResult("b.wotbreplay", "hash-x", 1, 1000L);
        var training = makeBattleResult("c.wotbreplay", "hash-y", 2, 2000L);
        var result = facade.buildBatchResult(3, List.of(orig, dup, training));
        assertEquals(ReplayAnalysisMode.NONE, result.suggestedAnalysisMode());
        assertEquals(1, result.summary().totalDuplicates());
        assertEquals("b.wotbreplay", result.summary().duplicateFileNames().getFirst());
        // Partition-based duplicate detection works independently of scope
        var partition = ExactReplayDuplicateDetector.partition(List.of(orig, dup, training));
        assertEquals(1, partition.count());
        assertSame(orig, partition.duplicates().getFirst().original());
        assertSame(dup, partition.duplicates().getFirst().duplicate());
    }

    @Test
    void mixedRecordersWithExactDuplicate() {
        var orig = makeBattleResult("a.wotbreplay", "hash-x", 1, 1000L);
        var dup = makeBattleResult("b.wotbreplay", "hash-x", 1, 1000L);
        var other = makeBattleResult("c.wotbreplay", "hash-y", 1, 2000L);
        var result = facade.buildBatchResult(3, List.of(orig, dup, other));
        assertEquals(ReplayAnalysisMode.NONE, result.suggestedAnalysisMode());
        assertEquals(1, result.summary().totalDuplicates());
        assertEquals("b.wotbreplay", result.summary().duplicateFileNames().getFirst());
        // Partition confirms duplicate regardless of recorder mix
        var partition = ExactReplayDuplicateDetector.partition(List.of(orig, dup, other));
        assertEquals(1, partition.count());
        assertSame(orig, partition.duplicates().getFirst().original());
        assertSame(dup, partition.duplicates().getFirst().duplicate());
    }

    @Test
    void emptyContentHashNotDuplicate() {
        var id1 = new ReplayIdentity("", null, null, null, null, null);
        var id2 = new ReplayIdentity("", null, null, null, null, null);
        var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, null, null, null, caps, null, null);
        var r2 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, null, null, null, caps, null, null);
        var result = facade.buildBatchResult(2, List.of(r1, r2));
        assertEquals(0, result.summary().totalDuplicates());
    }

    @Test
    void blankContentHashNotDuplicate() {
        var id1 = new ReplayIdentity("   ", null, null, null, null, null);
        var id2 = new ReplayIdentity("   ", null, null, null, null, null);
        var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id1, null, null, null, caps, null, null);
        var r2 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id2, null, null, null, caps, null, null);
        var result = facade.buildBatchResult(2, List.of(r1, r2));
        assertEquals(0, result.summary().totalDuplicates());
    }

    @Test
    void buildBatchResultPreservesOrder() {
        var caps = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        var r1 = new ReplayProcessingResult(
                "unique-1.wotbreplay", ReplayProcessingStatus.SUCCESS,
                null, null, null, null, caps, null, null);
        var id2 = new ReplayIdentity(
                "same-hash", null, null, null, null, null);
        var b = new Battle();
        b.arenaId = "a";
        b.arenaBonusType = 1;
        var pr = new PlayerResult();
        pr.accountId = 1L;
        pr.nickname = "P";
        pr.team = 1;
        b.players = List.of(pr);
        b.recorder = "P";
        var r2 = new ReplayProcessingResult(
                "orig.wotbreplay", ReplayProcessingStatus.SUCCESS,
                id2, b, null, null, caps, null, null);
        var r3 = new ReplayProcessingResult(
                "dup.wotbreplay", ReplayProcessingStatus.SUCCESS,
                id2, b, null, null, caps, null, null);
        var r4 = new ReplayProcessingResult(
                "failed.wotbreplay", ReplayProcessingStatus.FAILED,
                null, null, null, null, ReplayProcessingCapabilities.NONE,
                ReplayProcessingError.of("FAILED", ""), null);
        var r5 = new ReplayProcessingResult(
                "unique-2.wotbreplay", ReplayProcessingStatus.SUCCESS,
                null, null, null, null, caps, null, null);
        var input = List.of(r1, r2, r3, r4, r5);
        var result = facade.buildBatchResult(input.size(), input);
        for (int i = 0; i < input.size(); i++) {
            assertSame(input.get(i), result.results().get(i), "Order mismatch at index " + i);
        }
    }

    @Test
    void threeSameHashFullVerification() {
        var r1 = makeBattleResult("a.wotbreplay", "hash-x", 1, 1000L);
        var r2 = makeBattleResult("b.wotbreplay", "hash-x", 1, 1000L);
        var r3 = makeBattleResult("c.wotbreplay", "hash-x", 1, 1000L);
        var result = facade.buildBatchResult(3, List.of(r1, r2, r3));
        assertEquals(2, result.summary().totalDuplicates());
        var plan = new BatchAnalyzer().analyze(List.of(r1, r2, r3));
        assertEquals(2, plan.exactDuplicateCount());
        assertEquals(List.of("b.wotbreplay", "c.wotbreplay"), result.summary().duplicateFileNames());
        assertSame(r1, plan.exactDuplicates().getFirst().original());
        assertSame(r2, plan.exactDuplicates().getFirst().duplicate());
        assertSame(r1, plan.exactDuplicates().get(1).original());
        assertSame(r3, plan.exactDuplicates().get(1).duplicate());
    }
}
