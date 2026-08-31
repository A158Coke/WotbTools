package com.wotb.core.replay.processing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReplayProcessingCapabilitiesTest {

    @Test
    void recordStoresFactsWithoutPrecomputingAiAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, true, true, false, false);
        assertTrue(caps.summaryAvailable());
        assertTrue(caps.recorderResultAvailable());
        assertTrue(caps.reconstructionAvailable());
        assertFalse(caps.perspectiveTeamResolved());
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
        final var caps = new ReplayProcessingCapabilities(true, false, false, false, false);
        assertFalse(AiAnalysisEligibility.isAiAnalyzable(caps, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

    @Test
    void playerFocusedSummaryWithRecorderAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, true, false, false, false);
        assertTrue(AiAnalysisEligibility.isAiAnalyzable(caps, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

    @Test
    void playerFocusedNoSummaryNotAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(false, false, false, false, false);
        assertFalse(AiAnalysisEligibility.isAiAnalyzable(caps, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

    @Test
    void teamPerspectiveWithReconAndTeamResolvedIsAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, false, true, true, true);
        assertTrue(AiAnalysisEligibility.isAiAnalyzable(caps, ReplayAnalysisScope.TEAM_PERSPECTIVE));
    }

    @Test
    void teamPerspectiveWithoutReconUsesAuthoritativeSummaryFallback() {
        final var caps = new ReplayProcessingCapabilities(true, true, false, true, false);
        assertTrue(AiAnalysisEligibility.isAiAnalyzable(caps, ReplayAnalysisScope.TEAM_PERSPECTIVE));
    }

    @Test
    void teamPerspectiveWithoutSummaryOrReconstructedFeaturesIsNotAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, false, true, true, false);
        assertFalse(AiAnalysisEligibility.isAiAnalyzable(
                caps, ReplayAnalysisScope.TEAM_PERSPECTIVE));
    }

    @Test
    void teamPerspectiveWithoutResolvedTeamIsNotAnalyzable() {
        final var caps = new ReplayProcessingCapabilities(true, false, true, false, false);
        assertFalse(AiAnalysisEligibility.isAiAnalyzable(caps, ReplayAnalysisScope.TEAM_PERSPECTIVE));
    }

    @Test
    void nullScopeReturnsFalse() {
        final var caps = new ReplayProcessingCapabilities(true, true, true, false, false);
        assertFalse(AiAnalysisEligibility.isAiAnalyzable(caps, (ReplayAnalysisScope) null));
    }

    @Test
    void nullCapabilitiesReturnsFalse() {
        assertFalse(AiAnalysisEligibility.isAiAnalyzable((ReplayProcessingCapabilities) null, ReplayAnalysisScope.PLAYER_FOCUSED));
    }

}
