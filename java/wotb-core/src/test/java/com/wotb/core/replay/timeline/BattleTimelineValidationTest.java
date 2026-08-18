package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Timeline validation（docs/current-plan.md §4）：关键条件缺失 → 拒绝，不进入 AI Review。
 */
class BattleTimelineValidationTest {

    @Test
    void personalRequiresRecorderResolved() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final ReplayReconstruction recon = TimelineTestFixtures.recon(
                60.0, TimelineTestFixtures.standardEvents());
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(null, 1));
        assertFalse(result.usable());
        assertNull(result.timeline());
        assertTrue(result.validation().errors().contains(TimelineError.TIMELINE_RECORDER_UNRESOLVED));
    }

    @Test
    void personalRequiresPerspectiveTeam() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final ReplayReconstruction recon = TimelineTestFixtures.recon(
                60.0, TimelineTestFixtures.standardEvents());
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(1001L, null));
        assertFalse(result.usable());
        assertTrue(result.validation().errors().contains(TimelineError.TIMELINE_TEAM_UNRESOLVED));
    }

    @Test
    void missingBattleResultsRejects() {
        final ReplayReconstruction recon = TimelineTestFixtures.recon(
                60.0, TimelineTestFixtures.standardEvents());
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                null, recon, TimelineTestFixtures.personalPerspective());
        assertFalse(result.usable());
        assertTrue(result.validation().errors().contains(TimelineError.TIMELINE_RESULTS_INVALID));
    }

    @Test
    void unresolvedClockRejects() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        final ReplayReconstruction base = TimelineTestFixtures.recon(60.0, events);
        // 无 battle start、无 BattleEndedEvent、无 duration → 时钟无法建立
        final ReplayReconstruction noClock = new ReplayReconstruction(
                base.metadata(), base.streamHeader(), base.replayDurationSec(), null,
                base.participants(), base.events(), base.checkpoints(),
                base.finalState(), base.coverage(), base.diagnostics());
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, noClock, TimelineTestFixtures.personalPerspective());
        assertFalse(result.usable());
        assertTrue(result.validation().errors().contains(TimelineError.TIMELINE_CLOCK_UNRESOLVED));
    }

    @Test
    void unknownMapRejects() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final ReplayReconstruction base = TimelineTestFixtures.recon(
                60.0, TimelineTestFixtures.standardEvents());
        final com.wotb.core.replay.reconstruction.ReplayMetadata noMap =
                new com.wotb.core.replay.reconstruction.ReplayMetadata(
                        "arena", "", "1", "1", 1, "rec1", "", 60.0, 0L);
        final ReplayReconstruction noMapRecon = new ReplayReconstruction(
                noMap, base.streamHeader(), base.replayDurationSec(), base.battleStartRawClockSec(),
                base.participants(), base.events(), base.checkpoints(),
                base.finalState(), base.coverage(), base.diagnostics());
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, noMapRecon, TimelineTestFixtures.personalPerspective());
        assertFalse(result.usable());
        assertTrue(result.validation().errors().contains(TimelineError.TIMELINE_MAP_UNRESOLVED));
    }

    @Test
    void emptyStreamRejects() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final ReplayReconstruction base = TimelineTestFixtures.recon(60.0, List.of());
        final ReplayReconstruction empty = new ReplayReconstruction(
                base.metadata(), base.streamHeader(), base.replayDurationSec(), base.battleStartRawClockSec(),
                base.participants(), List.of(), base.checkpoints(),
                base.finalState(), base.coverage(), base.diagnostics());
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, empty, TimelineTestFixtures.personalPerspective());
        assertFalse(result.usable());
        assertTrue(result.validation().errors().contains(TimelineError.TIMELINE_STREAM_CORRUPTED));
    }

    @Test
    void validPersonalTimelineIsUsable() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final ReplayReconstruction recon = TimelineTestFixtures.recon(
                60.0, TimelineTestFixtures.standardEvents());
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelineTestFixtures.personalPerspective());
        assertTrue(result.usable());
        assertEquals(61, result.timeline().frames().size());
    }
}
