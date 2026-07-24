package com.wotb.core.processing;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReplayProcessingCapabilitiesTest {

    @Test
    void summaryNoRecorderResultNotAnalyzable() {
        final var caps = ReplayProcessingCapabilities.of(
                true, false, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        assertFalse(caps.aiAnalyzable());
        assertFalse(caps.fullFeatureAnalysisPossible());
    }

    @Test
    void summaryWithRecorderResultAnalyzable() {
        final var caps = ReplayProcessingCapabilities.of(
                true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        assertTrue(caps.aiAnalyzable());
        assertFalse(caps.fullFeatureAnalysisPossible());
    }

    @Test
    void fullFeatureAvailableOnlyWithReconAndEntityAndFeatures() {
        final var caps = ReplayProcessingCapabilities.of(
                true, true, true, true, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        assertTrue(caps.aiAnalyzable());
        assertTrue(caps.fullFeatureAnalysisPossible());
    }

    @Test
    void reconWithoutEntityMappingNotFullFeature() {
        final var caps = ReplayProcessingCapabilities.of(
                true, true, true, false, false, true, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        assertTrue(caps.aiAnalyzable());
        assertFalse(caps.fullFeatureAnalysisPossible());
    }

    @Test
    void reconWithoutFeaturesNotFullFeature() {
        final var caps = ReplayProcessingCapabilities.of(
                true, true, true, true, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        assertTrue(caps.aiAnalyzable());
        assertFalse(caps.fullFeatureAnalysisPossible());
    }

    @Test
    void noSummaryNotAnalyzable() {
        final var caps = ReplayProcessingCapabilities.of(
                false, false, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        assertFalse(caps.aiAnalyzable());
        assertFalse(caps.fullFeatureAnalysisPossible());
    }

    @Test
    void teamPerspectiveRequiresReconAndTeamResolved() {
        final var caps = ReplayProcessingCapabilities.of(
                true, false, true, false, true, false, true, ReplayAnalysisScope.TEAM_PERSPECTIVE);
        assertTrue(caps.aiAnalyzable());
    }

    @Test
    void teamPerspectiveWithoutReconNotAnalyzable() {
        final var caps = ReplayProcessingCapabilities.of(
                true, false, false, false, true, false, true, ReplayAnalysisScope.TEAM_PERSPECTIVE);
        assertFalse(caps.aiAnalyzable());
    }

    @Test
    void summaryOnlyWithRecorderResult() {
        final var caps = ReplayProcessingCapabilities.summaryOnly(true);
        assertTrue(caps.aiAnalyzable());
        assertFalse(caps.fullFeatureAnalysisPossible());
    }

    @Test
    void summaryOnlyWithoutRecorderResult() {
        final var caps = ReplayProcessingCapabilities.summaryOnly(false);
        assertFalse(caps.aiAnalyzable());
        assertFalse(caps.fullFeatureAnalysisPossible());
    }
}
