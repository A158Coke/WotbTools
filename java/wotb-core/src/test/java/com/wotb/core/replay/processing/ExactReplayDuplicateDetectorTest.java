package com.wotb.core.replay.processing;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExactReplayDuplicateDetectorTest {

    @Test
    void nullResultsThrows() {
        assertThrows(NullPointerException.class,
                () -> ExactReplayDuplicateDetector.partition(null));
    }

    @Test
    void nullElementThrows() {
        final var list = new ArrayList<ReplayProcessingResult>();
        list.add(result("a", "h", ReplayProcessingStatus.SUCCESS));
        list.add(null);
        var ex = assertThrows(NullPointerException.class,
                () -> ExactReplayDuplicateDetector.partition(list));
        assertEquals("results contains null", ex.getMessage());
    }

    @Test
    void partitionListsAreImmutable() {
        var p = ExactReplayDuplicateDetector.partition(List.of());
        assertThrows(UnsupportedOperationException.class,
                () -> p.uniqueResults().add(null));
        assertThrows(UnsupportedOperationException.class,
                () -> p.duplicates().add(null));
    }

    @Test
    void sameHashProducesDuplicate() {
        var p = ExactReplayDuplicateDetector.partition(List.of(
                result("a", "hash-1", ReplayProcessingStatus.SUCCESS),
                result("b", "hash-1", ReplayProcessingStatus.SUCCESS)));
        assertEquals(1, p.uniqueResults().size());
        assertEquals(1, p.count());
        assertEquals("b", p.duplicateFileNames().getFirst());
    }

    @Test
    void threeSameHashTwoDuplicates() {
        var r1 = result("a", "h", ReplayProcessingStatus.SUCCESS);
        var r2 = result("b", "h", ReplayProcessingStatus.SUCCESS);
        var r3 = result("c", "h", ReplayProcessingStatus.SUCCESS);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2, r3));
        assertEquals(1, p.uniqueResults().size());
        assertSame(r1, p.uniqueResults().getFirst());
        assertEquals(2, p.count());
        assertSame(r1, p.duplicates().get(0).original());
        assertSame(r2, p.duplicates().get(0).duplicate());
        assertSame(r1, p.duplicates().get(1).original());
        assertSame(r3, p.duplicates().get(1).duplicate());
        assertEquals(List.of(r2.fileName(), r3.fileName()), p.duplicateFileNames());
    }

    @Test
    void nullIdentityNoDuplicate() {
        var r1 = resultWithoutIdentity("a", ReplayProcessingStatus.SUCCESS);
        var r2 = resultWithoutIdentity("a", ReplayProcessingStatus.SUCCESS);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void nullContentHashNoDuplicate() {
        var r1 = result("a", null, ReplayProcessingStatus.SUCCESS);
        var r2 = result("b", null, ReplayProcessingStatus.SUCCESS);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void sameNameNullIdentityNotDuplicate() {
        var r1 = resultWithoutIdentity("same.wotbreplay", ReplayProcessingStatus.SUCCESS);
        var r2 = resultWithoutIdentity("same.wotbreplay", ReplayProcessingStatus.SUCCESS);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void blankHashNoDuplicate() {
        var p = ExactReplayDuplicateDetector.partition(List.of(
                result("a", "", ReplayProcessingStatus.SUCCESS),
                result("b", "", ReplayProcessingStatus.SUCCESS)));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void blankSpacesHashNoDuplicate() {
        var p = ExactReplayDuplicateDetector.partition(List.of(
                result("a", "   ", ReplayProcessingStatus.SUCCESS),
                result("b", "   ", ReplayProcessingStatus.SUCCESS)));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void twoFailedSameHashNoDuplicate() {
        var id = identity("h");
        var r1 = failedResult("a", id);
        var r2 = failedResult("b", id);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void failedInMiddlePreservesOrder() {
        var id = identity("h");
        var r1 = result("first", "h", ReplayProcessingStatus.SUCCESS);
        var r2 = failedResult("failed-mid", id);
        var r3 = result("third", "h", ReplayProcessingStatus.SUCCESS);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2, r3));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(1, p.count());
        assertEquals("first", p.uniqueResults().get(0).fileName());
        assertEquals("failed-mid", p.uniqueResults().get(1).fileName());
    }

    @Test
    void mixedGroupsPreserveOrderAndOriginal() {
        var r1 = result("a", "hash-1", ReplayProcessingStatus.SUCCESS);
        var r2 = result("b", "hash-2", ReplayProcessingStatus.SUCCESS);
        var r3 = result("c", "hash-1", ReplayProcessingStatus.SUCCESS);
        var r4 = failedResult("d", identity("hash-3"));
        var r5 = result("e", "hash-2", ReplayProcessingStatus.SUCCESS);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2, r3, r4, r5));
        // unique: a(hash-1), b(hash-2), d(failed) in order
        assertEquals(3, p.uniqueResults().size());
        assertSame(r1, p.uniqueResults().get(0));
        assertSame(r2, p.uniqueResults().get(1));
        assertSame(r4, p.uniqueResults().get(2));
        // duplicates: c(dup of a), e(dup of b)
        assertEquals(2, p.count());
        assertSame(r1, p.duplicates().get(0).original());
        assertSame(r3, p.duplicates().get(0).duplicate());
        assertSame(r2, p.duplicates().get(1).original());
        assertSame(r5, p.duplicates().get(1).duplicate());
        assertEquals(5, p.uniqueResults().size() + p.count());
    }

    @Test
    void batchAnalyzerAndDetectorMatch() {
        final var id = identity("h");
        final var b = new com.wotb.core.model.Battle();
        b.arenaId = "a";
        b.arenaBonusType = 1;
        final var pr = new com.wotb.core.model.PlayerResult();
        pr.accountId = 1L;
        pr.nickname = "P";
        pr.team = 1;
        b.players = List.of(pr);
        b.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        final var r1 = new ReplayProcessingResult(
                "a", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult(
                "b", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        final var plan = new BatchAnalyzer().analyze(List.of(r1, r2));
        final var partition = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(plan.exactDuplicateCount(), partition.count());
        assertEquals(plan.exactDuplicates().size(), partition.duplicates().size());
    }

    // ======== helpers ========

    private static ReplayProcessingResult result(
            final String name,
            final String hash,
            final ReplayProcessingStatus status) {
        return new ReplayProcessingResult(
                name, status, new ReplayIdentity(hash, null, null, null, null, null),
                null, null, null, ReplayProcessingCapabilities.NONE, null, null);
    }

    private static ReplayProcessingResult resultWithoutIdentity(
            final String name,
            final ReplayProcessingStatus status) {
        return new ReplayProcessingResult(
                name, status, null,
                null, null, null, ReplayProcessingCapabilities.NONE, null, null);
    }

    private static ReplayProcessingResult failedResult(
            final String name,
            final ReplayIdentity identity) {
        return new ReplayProcessingResult(
                name, ReplayProcessingStatus.FAILED, identity,
                null, null, null, ReplayProcessingCapabilities.NONE, null, null);
    }

    private static ReplayIdentity identity(final String hash) {
        return new ReplayIdentity(hash, null, null, null, null, null);
    }
}
