package com.wotb.core.replay.feature;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BattlePhaseSummaryTest {

    private static void assertValidPhases(final List<BattlePhaseSummary> phases, final float battleEnd) {
        for (final BattlePhaseSummary p : phases) {
            assertTrue(Float.isFinite(p.startTime()), "startTime must be finite");
            assertTrue(Float.isFinite(p.endTime()), "endTime must be finite");
            assertTrue(p.startTime() >= 0f, "startTime must be >= 0");
            assertTrue(p.endTime() >= 0f, "endTime must be >= 0");
            assertTrue(p.startTime() <= p.endTime(), "startTime <= endTime");
            assertTrue(p.endTime() <= battleEnd + 0.001f, "endTime must not exceed battleEnd");
        }
        for (int i = 0; i < phases.size() - 1; i++) {
            final BattlePhaseSummary a = phases.get(i);
            final BattlePhaseSummary b = phases.get(i + 1);
            assertTrue(a.startTime() <= b.startTime(), "phases must be sorted by startTime");
            if (a.endTime() > a.startTime() && b.endTime() > b.startTime()) {
                assertTrue(a.endTime() <= b.startTime() + 0.001f, "non-zero phases must not overlap");
            }
        }
    }

    @Test void unknownFirstContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(-1f, 120f);
        assertValidPhases(phases, 120f);
        assertFalse(phases.isEmpty());
        assertTrue(phases.stream().noneMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactIsZero() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(0f, 120f);
        assertValidPhases(phases, 120f);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactAtForty() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(40f, 120f);
        assertValidPhases(phases, 120f);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT && p.startTime() == 40f));
    }

    @Test void firstContactAtFifty() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(50f, 120f);
        assertValidPhases(phases, 120f);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT && p.startTime() == 50f));
    }

    @Test void firstContactNearBattleEnd() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(115f, 120f);
        assertValidPhases(phases, 120f);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactEqualsBattleEnd() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(120f, 120f);
        assertValidPhases(phases, 120f);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void firstContactExceedsBattleEnd() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(130f, 120f);
        assertValidPhases(phases, 120f);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void negativeFirstContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(-5f, 120f);
        assertValidPhases(phases, 120f);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void battleEndIsZero() {
        assertTrue(BattlePhaseSummary.buildRelativePhases(-1f, 0f).isEmpty());
    }

    @Test void shortBattle() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(5f, 20f);
        assertValidPhases(phases, 20f);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void nanBattleEnd() {
        assertTrue(BattlePhaseSummary.buildRelativePhases(-1f, Float.NaN).isEmpty());
    }

    @Test void nonZeroPhasesDoNotOverlap() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(40f, 120f);
        assertValidPhases(phases, 120f);
    }

    @Test void firstContactNotOverlappedByMidGame() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(30f, 200f);
        assertValidPhases(phases, 200f);
        final List<BattlePhaseSummary> fcPhases = phases.stream()
            .filter(p -> p.type() == BattlePhaseType.FIRST_CONTACT).toList();
        for (final BattlePhaseSummary fc : fcPhases) {
            phases.stream()
                .filter(p -> p.type() == BattlePhaseType.MID_GAME)
                .forEach(mg -> assertTrue(mg.startTime() >= fc.endTime()));
        }
    }

    @Test void openingEndAtFortyFiveWhenLateContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(50f, 120f);
        assertValidPhases(phases, 120f);
        final BattlePhaseSummary opening = phases.stream()
            .filter(p -> p.type() == BattlePhaseType.OPENING).findFirst().orElseThrow();
        assertEquals(45f, opening.endTime(), 0.01f, "OPENING must end at 45 when contact > 45");
    }

    @Test void openingEndAtContactWhenEarly() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(40f, 120f);
        final BattlePhaseSummary opening = phases.stream()
            .filter(p -> p.type() == BattlePhaseType.OPENING).findFirst().orElseThrow();
        assertEquals(40f, opening.endTime(), 0.01f, "OPENING must end at contact when contact < 45");
    }

    @Test void openingEndAtFortyFiveWhenContactAtFortyFive() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(45f, 120f);
        final BattlePhaseSummary opening = phases.stream()
            .filter(p -> p.type() == BattlePhaseType.OPENING).findFirst().orElseThrow();
        assertEquals(45f, opening.endTime(), 0.01f, "OPENING must end at 45 when contact = 45");
    }

    @Test void openingEndAtFortyFiveWhenContactAtFiftyOne() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(51f, 120f);
        assertValidPhases(phases, 120f);
        final BattlePhaseSummary opening = phases.stream()
            .filter(p -> p.type() == BattlePhaseType.OPENING).findFirst().orElseThrow();
        assertEquals(45f, opening.endTime(), 0.01f, "OPENING must end at 45 when contact > 45");
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT && p.startTime() == 51f),
            "Late first contact must still be recorded");
    }

    @Test void openingEndAtFortyFiveWhenContactAtNinety() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(90f, 120f);
        assertValidPhases(phases, 120f);
        final BattlePhaseSummary opening = phases.stream()
            .filter(p -> p.type() == BattlePhaseType.OPENING).findFirst().orElseThrow();
        assertEquals(45f, opening.endTime(), 0.01f);
        assertTrue(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT && p.startTime() == 90f));
    }

    @Test void nanFirstContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(Float.NaN, 120f);
        assertValidPhases(phases, 120f);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void positiveInfinityFirstContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(Float.POSITIVE_INFINITY, 120f);
        assertValidPhases(phases, 120f);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void negativeInfinityFirstContact() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhases(Float.NEGATIVE_INFINITY, 120f);
        assertValidPhases(phases, 120f);
        assertFalse(phases.stream().anyMatch(p -> p.type() == BattlePhaseType.FIRST_CONTACT));
    }

    @Test void negativeBattleEnd() {
        assertTrue(BattlePhaseSummary.buildRelativePhases(-1f, -10f).isEmpty());
    }

    @Test void positiveInfinityBattleEnd() {
        assertTrue(BattlePhaseSummary.buildRelativePhases(50f, Float.POSITIVE_INFINITY).isEmpty());
    }

    @Test void negativeInfinityBattleEnd() {
        assertTrue(BattlePhaseSummary.buildRelativePhases(-1f, Float.NEGATIVE_INFINITY).isEmpty());
    }
}
