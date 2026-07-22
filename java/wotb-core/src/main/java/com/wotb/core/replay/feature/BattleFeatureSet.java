package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 单场战斗特征集（占位，后续扩展）。
 *
 * TODO: populate with real feature fields in next phase
 * - opening: OpeningFeature
 * - engagement: EngagementFeature
 * - damageExchange: DamageExchangeFeature
 * - movement: MovementFeature
 * - survival: SurvivalFeature
 * - rotation: RotationFeature
 * - endgame: EndgameFeature
 */
public record BattleFeatureSet(
        String battleId,
        List<KeyBattleEvent> keyEvents,
        boolean hasFeatures
) {

    public static BattleFeatureSet empty(String battleId) {
        return new BattleFeatureSet(battleId, List.of(), false);
    }
}
