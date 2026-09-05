package com.wotb.web.replay.ai;

import com.wotb.core.replay.feature.PlaybackCombatReconstruction;
import com.wotb.web.replay.dto.BattlePlaybackDataset.PositionSample;
import com.wotb.web.replay.dto.BattlePlaybackDataset.PositionSegment;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BattlePlaybackDamageFeedbackPolicyTest {

    private static boolean transientAllowed(
            final List<PositionSegment> segments,
            final PlaybackCombatReconstruction.Loss loss) throws Exception {
        final Method method = BattlePlaybackProjector.class.getDeclaredMethod(
                "transientAllowed", List.class, PlaybackCombatReconstruction.Loss.class);
        method.setAccessible(true);
        return (boolean) method.invoke(null, segments, loss);
    }

    private static PlaybackCombatReconstruction.Loss loss(
            final double fromSec,
            final double toSec) {
        return new PlaybackCombatReconstruction.Loss(
                fromSec, toSec, 400, 1001L, true, 1, 2400, 2000);
    }

    @Test
    void allowsFeedbackWhenVictimIsObservedAtTheHpLossEndpoint() throws Exception {
        final List<PositionSegment> segments = List.of(
                new PositionSegment(
                        19.0, 21.0, "OBSERVED", true,
                        List.of(
                                new PositionSample(19.0, 20.0, 30.0),
                                new PositionSample(21.0, 20.0, 30.0))));

        // fromSec is the previous trustworthy HP sample, not the start of a hit-visibility window.
        // Requiring OBSERVED coverage all the way back to it suppresses a real hit at t=20 even
        // though the victim is currently positioned and rendered when the HP loss becomes known.
        assertTrue(transientAllowed(segments, loss(10.0, 20.0)));
    }

    @Test
    void rejectsFeedbackWhenVictimIsOnlyLastKnownAtTheHpLossEndpoint() throws Exception {
        final List<PositionSegment> segments = List.of(
                new PositionSegment(
                        10.0, 18.0, "OBSERVED", true,
                        List.of(
                                new PositionSample(10.0, 20.0, 30.0),
                                new PositionSample(18.0, 20.0, 30.0))),
                new PositionSegment(
                        18.0, 21.0, "LAST_KNOWN", false,
                        List.of(new PositionSample(18.0, 20.0, 30.0))));

        assertFalse(transientAllowed(segments, loss(10.0, 20.0)));
    }

    @Test
    void rejectsFeedbackWhenNoPositionWasEverObserved() throws Exception {
        assertFalse(transientAllowed(List.of(), loss(10.0, 20.0)));
    }
}
