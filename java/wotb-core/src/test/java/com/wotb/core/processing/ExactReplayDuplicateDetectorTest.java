package com.wotb.core.processing;

import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ExactReplayDuplicateDetectorTest {

    @Test void nullResultsThrows() { assertThrows(NullPointerException.class, () -> ExactReplayDuplicateDetector.partition(null)); }

    @Test
    void nullElementThrows() {
        final var list = new java.util.ArrayList<ReplayProcessingResult>();
        list.add(result("a", "h", ReplayProcessingStatus.SUCCESS));
        list.add(null);
        assertThrows(NullPointerException.class, () -> ExactReplayDuplicateDetector.partition(list));
    }

    @Test void partitionListsAreImmutable() {
        var p = ExactReplayDuplicateDetector.partition(List.of());
        assertThrows(UnsupportedOperationException.class, () -> p.uniqueResults().add(null));
        assertThrows(UnsupportedOperationException.class, () -> p.duplicates().add(null));
    }

    @Test void sameHashProducesDuplicate() {
        var p = ExactReplayDuplicateDetector.partition(List.of(
                result("a", "hash-1", ReplayProcessingStatus.SUCCESS),
                result("b", "hash-1", ReplayProcessingStatus.SUCCESS)));
        assertEquals(1, p.uniqueResults().size());
        assertEquals(1, p.count());
        assertEquals("b", p.duplicateFileNames().getFirst());
    }

    @Test void threeSameHashTwoDuplicates() {
        var p = ExactReplayDuplicateDetector.partition(List.of(
                result("a", "h", ReplayProcessingStatus.SUCCESS),
                result("b", "h", ReplayProcessingStatus.SUCCESS),
                result("c", "h", ReplayProcessingStatus.SUCCESS)));
        assertEquals(1, p.uniqueResults().size());
        assertEquals(2, p.count());
    }

    @Test void nullIdentityNoDuplicate() {
        var r1 = new ReplayProcessingResult("a", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        var r2 = new ReplayProcessingResult("a", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test void blankHashNoDuplicate() {
        var p = ExactReplayDuplicateDetector.partition(List.of(
                result("a", "", ReplayProcessingStatus.SUCCESS),
                result("b", "", ReplayProcessingStatus.SUCCESS)));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test void blankSpacesHashNoDuplicate() {
        var p = ExactReplayDuplicateDetector.partition(List.of(
                result("a", "   ", ReplayProcessingStatus.SUCCESS),
                result("b", "   ", ReplayProcessingStatus.SUCCESS)));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test void twoFailedSameHashNoDuplicate() {
        var id = new ReplayIdentity("h", null, null, null, null, null);
        var r1 = new ReplayProcessingResult("a", ReplayProcessingStatus.FAILED, id, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        var r2 = new ReplayProcessingResult("b", ReplayProcessingStatus.FAILED, id, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test void sameNameNoHashNotDuplicate() {
        var r1 = new ReplayProcessingResult("same.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        var r2 = new ReplayProcessingResult("same.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test void failedInMiddlePreservesOrder() {
        var id = new ReplayIdentity("h", null, null, null, null, null);
        var r1 = result("first", "h", ReplayProcessingStatus.SUCCESS);
        var r2 = new ReplayProcessingResult("failed-mid", ReplayProcessingStatus.FAILED, id, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        var r3 = result("third", "h", ReplayProcessingStatus.SUCCESS);
        var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2, r3));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(1, p.count());
        assertEquals("first", p.uniqueResults().getFirst().fileName());
        assertEquals("failed-mid", p.uniqueResults().get(1).fileName());
    }

    @Test void batchAnalyzerAndDetectorMatch() {
        final var id = new ReplayIdentity("h", null, null, null, null, null);
        final var b = new com.wotb.core.model.Battle(); b.arenaId = "a"; b.arenaBonusType = 1;
        final var pr = new com.wotb.core.model.PlayerResult(); pr.accountId = 1L; pr.nickname = "P"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r1 = new ReplayProcessingResult("a", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        final var plan = new BatchAnalyzer().analyze(List.of(r1, r2));
        final var partition = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(plan.exactDuplicateCount(), partition.count());
        assertEquals(plan.exactDuplicates().size(), partition.duplicates().size());
    }

    private static ReplayProcessingResult result(final String name, final String hash, final ReplayProcessingStatus status) {
        return new ReplayProcessingResult(name, status, new ReplayIdentity(hash, null, null, null, null, null), null, null, null, ReplayProcessingCapabilities.NONE, null, null);
    }
}
