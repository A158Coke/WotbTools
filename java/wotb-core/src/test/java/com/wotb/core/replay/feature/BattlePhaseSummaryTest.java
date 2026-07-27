package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import java.util.List;

class BattlePhaseSummaryTest {

    private static void assertValidPhases(final List<BattlePhaseSummary> phases) {
        for (final BattlePhaseSummary p : phases) {
            assertTrue(Float.isFinite(p.startTime()), "startTime must be finite");
            assertTrue(Float.isFinite(p.endTime()), "endTime must be finite");
            assertTrue(p.startTime() >= 0f, "startTime must be >= 0");
            assertTrue(p.endTime() >= 0f, "endTime must be >= 0");
            assertTrue(p.startTime() <= p.endTime(), "startTime <= endTime");
        }
        for (int i = 0; i < phases.size() - 1; i++) {
            final BattlePhaseSummary a = phases.get(i);
            final BattlePhaseSummary b = phases.get(i + 1);
            assertTrue(a.startTime() <= b.startTime(), "phases must be sorted by startTime");
            if (a.endTime() > a.startTime() && b.endTime() > b.startTime()) {
                assertTrue(a.endTime() <= b.startTime(), "non-zero phases must not overlap: " + a + " vs " + b);
            }
        }
    }

    @Test void unknownFirstContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(-1f, 120f);
        assertValidPhases(phases);
        assertFalse(phases.isEmpty());
        assertTrue(phases.stream().noneMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactIsZero() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(0f, 120f);
        assertValidPhases(phases);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactAtForty() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(40f, 120f);
        assertValidPhases(phases);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT && p.startTime() == 40f));
    }

    @Test void firstContactAtFifty() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(50f, 120f);
        assertValidPhases(phases);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT && p.startTime() == 50f));
    }

    @Test void firstContactNearBattleEnd() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(115f, 120f);
        assertValidPhases(phases);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactEqualsBattleEnd() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(120f, 120f);
        assertValidPhases(phases);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactExceedsBattleEnd() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(130f, 120f);
        assertValidPhases(phases);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void negativeFirstContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(-5f, 120f);
        assertValidPhases(phases);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void battleEndIsZero() {
        assertTrue(BattlePhaseSummary.buildRelativePhases(-1f, 0f).isEmpty());
    }

    @Test void shortBattle() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(5f, 20f);
        assertValidPhases(phases);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void nanBattleEnd() {
        assertTrue(BattlePhaseSummary.buildRelativePhases(-1f, Float.NaN).isEmpty());
    }

    @Test void nonZeroPhasesDoNotOverlap() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(40f, 120f);
        assertValidPhases(phases);
    }

    @Test void firstContactNotOverlappedByMidGame() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(30f, 200f);
        assertValidPhases(phases);
        boolean foundFirstContact = false;
        for (final BattlePhaseSummary p : phases) {
            if (p.type() == BattlePhaseType.FIRST_CONTACT) foundFirstContact = true;
            if (p.type() == BattlePhaseType.MID_GAME && foundFirstContact) {
                // MID_GAME must start after or at FIRST_CONTACT end
                final BattlePhaseSummary fc = phases.stream()
                    .filter(ph -> ph.type() == BattlePhaseType.FIRST_CONTACT).findFirst().get();
                assertTrue(p.startTime() >= fc.endTime(), "MID_GAME must start at or after FIRST_CONTACT end");
            }
        }
    }
}
