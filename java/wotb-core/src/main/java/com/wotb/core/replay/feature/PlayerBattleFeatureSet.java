package com.wotb.core.replay.feature;

import com.wotb.core.replay.facts.ShotFact;
import com.wotb.core.replay.facts.TargetingShotPair;

import java.util.List;

public record PlayerBattleFeatureSet(
        List<MovementSegment> movements,
        List<EngagementSummary> engagements,
        List<BattlePhaseSummary> phases,
        List<KeyBattleEvent> keyEvents,
        List<ShotFact> shots,
        List<TargetingShotPair> targetingPairs,
        List<String> limitations,
        boolean hasFeatures
) {

    public PlayerBattleFeatureSet(
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final List<KeyBattleEvent> keyEvents,
            final List<String> limitations,
            final boolean hasFeatures
    ) {
        this(movements, engagements, phases, keyEvents,
                List.of(), List.of(), limitations, hasFeatures);
    }

    public static PlayerBattleFeatureSet empty() {
        return new PlayerBattleFeatureSet(List.of(), List.of(), List.of(), List.of(),
                List.of(), List.of(), List.of("Recorder entity not mapped"), false);
    }
}
