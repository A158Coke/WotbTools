package com.wotb.core.processing;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReplayProcessingCapabilitiesTest {

    @Test
    void recordStoresFactsWithoutPrecomputingAiAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        assertTrue(caps.summaryAvailable());
        assertTrue(caps.recorderResultAvailable());
        assertTrue(caps.recorderEntityMapped());
        assertFalse(caps.teamFeatureExtractionPossible());
    }

    @Test
    void summaryOnlyWithRecorderResult() {
        final var caps = ReplayProcessingCapabilities.summaryOnly(true);
        assertTrue(caps.summaryAvailable());
        assertTrue(caps.recorderResultAvailable());
    }

    @Test
    void summaryOnlyWithoutRecorderResult() {
        final var caps = ReplayProcessingCapabilities.summaryOnly(false);
        assertTrue(caps.summaryAvailable());
        assertFalse(caps.recorderResultAvailable());
    }

    // ======== isAiAnalyzable scope-dependent tests ========

    @Test
    void playerFocusedSummaryNoRecorderNotAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, false, false, false, false, false, false, false);
        assertFalse(BatchAnalyzer.isAiAnalyzable(caps, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

    @Test
    void playerFocusedSummaryWithRecorderAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, true, false, false, false, false, false, false);
        assertTrue(BatchAnalyzer.isAiAnalyzable(caps, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

    @Test
    void playerFocusedNoSummaryNotAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(false, false, false, false, false, false, false, false);
        assertFalse(BatchAnalyzer.isAiAnalyzable(caps, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

    @Test
    void teamPerspectiveRequiresReconAndTeamResolved() {
        final var caps = new ReplayProcessingCapabilities(true, false, true, false, false, true, false, true);
        assertTrue(BatchAnalyzer.isAiAnalyzable(caps, ReplayAnalysisScope.TEAM_PERSPECTIVE));
    }

    @Test
    void teamPerspectiveWithoutReconNotAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, false, false, false, false, true, false, true);
        assertFalse(BatchAnalyzer.isAiAnalyzable(caps, ReplayAnalysisScope.TEAM_PERSPECTIVE));
    }

    @Test
    void nullScopeReturnsFalse() {
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        assertFalse(BatchAnalyzer.isAiAnalyzable(caps, (ReplayAnalysisScope) null));
    }

    @Test
    void nullCapabilitiesReturnsFalse() {
        assertFalse(BatchAnalyzer.isAiAnalyzable((ReplayProcessingCapabilities) null, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

    @Test
    void recorderParticipantWithoutEntityMappingReflected() {
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, false, false, true, false);
        assertTrue(caps.recorderParticipantResolved());
        assertFalse(caps.recorderEntityMapped());
    }

    @Test
    void bothParticipantAndEntityMappingResolved() {
        final var caps = new ReplayProcessingCapabilities(true, true, true, true, true, false, true, false);
        assertTrue(caps.recorderParticipantResolved());
        assertTrue(caps.recorderEntityMapped());
    }
}
