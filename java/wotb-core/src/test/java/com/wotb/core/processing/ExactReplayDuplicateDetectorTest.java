package com.wotb.core.processing;

import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ExactReplayDuplicateDetectorTest {

    @Test
    void sameHashProducesDuplicate() {
        final var r1 = result("a.wotbreplay", "hash-1", ReplayProcessingStatus.SUCCESS);
        final var r2 = result("b.wotbreplay", "hash-1", ReplayProcessingStatus.SUCCESS);
        final var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(1, p.uniqueResults().size());
        assertEquals(1, p.count());
        assertEquals("b.wotbreplay", p.duplicateFileNames().getFirst());
    }

    @Test
    void threeSameHashTwoDuplicates() {
        final var r1 = result("a.wotbreplay", "h", ReplayProcessingStatus.SUCCESS);
        final var r2 = result("b.wotbreplay", "h", ReplayProcessingStatus.SUCCESS);
        final var r3 = result("c.wotbreplay", "h", ReplayProcessingStatus.SUCCESS);
        final var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2, r3));
        assertEquals(1, p.uniqueResults().size());
        assertEquals(2, p.count());
    }

    @Test
    void nullIdentityNoDuplicate() {
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        final var r2 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null, null, ReplayProcessingCapabilities.NONE, null, null);
        final var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void failedFileNotCounted() {
        final var id = new ReplayIdentity("h", null, null, null, null, null);
        final var r1 = result("a.wotbreplay", "h", ReplayProcessingStatus.SUCCESS);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.FAILED, id, null, null, null, ReplayProcessingCapabilities.NONE, ReplayProcessingError.of("FAILED", ""), null);
        final var p = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(2, p.uniqueResults().size());
        assertEquals(0, p.count());
    }

    @Test
    void batchAnalyzerAndDetectorMatch() {
        final var id = new ReplayIdentity("h", null, null, null, null, null);
        final var b = new com.wotb.core.model.Battle(); b.arenaId = "a"; b.arenaBonusType = 1;
        final var pr = new com.wotb.core.model.PlayerResult(); pr.accountId = 1L; pr.nickname = "P"; pr.team = 1;
        b.players = List.of(pr); b.recorder = "P";
        final var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        final var r1 = new ReplayProcessingResult("a.wotbreplay", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        final var r2 = new ReplayProcessingResult("b.wotbreplay", ReplayProcessingStatus.SUCCESS, id, b, null, null, caps, null, null);
        final var plan = new BatchAnalyzer().analyze(List.of(r1, r2));
        final var partition = ExactReplayDuplicateDetector.partition(List.of(r1, r2));
        assertEquals(plan.exactDuplicateCount(), partition.count());
        assertEquals(plan.exactDuplicates().size(), partition.duplicates().size());
    }

    private static ReplayProcessingResult result(final String name, final String hash, final ReplayProcessingStatus status) {
        return new ReplayProcessingResult(name, status, new ReplayIdentity(hash, null, null, null, null, null), null, null, null, ReplayProcessingCapabilities.NONE, null, null);
    }
}
