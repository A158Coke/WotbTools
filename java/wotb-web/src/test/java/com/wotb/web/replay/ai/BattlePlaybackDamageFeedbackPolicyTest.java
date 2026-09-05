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

    private static PlaybackCombatReconstruction.Loss singleReliableLoss(
            final double fromSec,
            final double toSec) {
        return new PlaybackCombatReconstruction.Loss(
                fromSec, toSec, 400, 1001L, true, 1, 2400, 2000);
    }

    @Test
    void allowsFeedbackWhenTheVictimStillHasADisplayableLastKnownAnchor() throws Exception {
        final List<PositionSegment> segments = List.of(
                new PositionSegment(
                        10.0, 12.0, "OBSERVED", true,
                        List.of(
                                new PositionSample(10.0, 20.0, 30.0),
                                new PositionSample(12.0, 20.0, 30.0))),
                new PositionSegment(
                        12.0, 20.0, "LAST_KNOWN", false,
                        List.of(new PositionSample(12.0, 20.0, 30.0))));

        // A stationary/no-fresh-position vehicle can remain rendered at its canonical last-known
        // anchor while an exact HP loss arrives later. Feedback describes the authoritative HP
        // transition; it must not be suppressed merely because no new position packet arrived.
        assertTrue(transientAllowed(segments, singleReliableLoss(12.0, 15.0)));
    }

    @Test
    void rejectsFeedbackWhenNoMarkerAnchorHasEverBeenKnown() throws Exception {
        assertFalse(transientAllowed(List.of(), singleReliableLoss(12.0, 15.0)));
    }

    @Test
    void rejectsAggregatedOrAmbiguousDamageWindows() throws Exception {
        final List<PositionSegment> segments = List.of(
                new PositionSegment(
                        10.0, 20.0, "OBSERVED", true,
                        List.of(new PositionSample(10.0, 20.0, 30.0))));

        final PlaybackCombatReconstruction.Loss multipleHits = new PlaybackCombatReconstruction.Loss(
                12.0, 15.0, 800, null, false, 2, 2400, 1600);
        assertFalse(transientAllowed(segments, multipleHits));
    }
}
