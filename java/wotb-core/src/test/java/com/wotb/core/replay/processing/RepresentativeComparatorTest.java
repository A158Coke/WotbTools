package com.wotb.core.replay.processing;

import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RepresentativeComparatorTest {

    @Test
    void reconstructionBeatsNone() {
        var a = scoped("a", true, 0.95, 0, 0);
        var b = scoped("b", false, 0.95, 0, 0);
        assertSelected("a", a, b);
    }

    @Test
    void higherDecodedRatioWins() {
        var a = scoped("a", true, 0.95, 1, 1);
        var b = scoped("b", true, 0.40, 1, 1);
        assertSelected("a", a, b);
    }

    @Test
    void fewerFailedPacketsWins() {
        var a = scoped("a", true, 0.95, 1, 5);
        var b = scoped("b", true, 0.95, 5, 5);
        assertSelected("a", a, b);
    }

    @Test
    void fewerUnknownPacketsWins() {
        var a = scoped("a", true, 0.95, 5, 1);
        var b = scoped("b", true, 0.95, 5, 5);
        assertSelected("a", a, b);
    }

    @Test
    void allEqualFirstWins() {
        var a = scoped("a", true, 0.95, 5, 5);
        var b = scoped("b", true, 0.95, 5, 5);
        assertSelected("a", a, b);
    }

    // ======== helpers ========

    private void assertSelected(final String expectedName, final BatchAnalyzer.ScopedResult... results) {
        var selected = BatchAnalyzer.selectRepresentative(List.of(results));
        assertEquals(expectedName, selected.result().fileName());
    }

    private BatchAnalyzer.ScopedResult scoped(
            final String name,
            final boolean recon,
            final double ratio,
            final int failed,
            final int unknown) {
        var caps = new ReplayProcessingCapabilities(true, true, recon, false, false);
        var coverage = new ReplayCoverage(
                100, (int) (ratio * 100), 0, unknown, failed, ratio, Map.of());
        var diag = new ReplayStreamDiagnostics(
                0, 100, 0f, 0f, 0, Map.of());
        var processingDiag = new ReplayProcessingDiagnostics(
                true, true, recon, diag);
        var reconstruction = recon
                ? new ReplayReconstruction(null, null, 300f, null,
                        List.of(), List.of(), List.of(), null, coverage, diag)
                : null;
        var result = new ReplayProcessingResult(
                name, ReplayProcessingStatus.SUCCESS, null, null,
                reconstruction, processingDiag, caps, null, null);
        return new BatchAnalyzer.ScopedResult(
                result, BattleCategory.RANDOM, ReplayAnalysisScope.PLAYER_FOCUSED);
    }
}
