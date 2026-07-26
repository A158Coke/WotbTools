package com.wotb.core.processing;

import com.wotb.core.model.Battle;

/**
 * Converts winner team into FRIENDLY_WIN / ENEMY_WIN / DRAW_OR_UNKNOWN
 * for random-battle player-focused analysis.
 * <p>
 * Used in AI prompts so the model never sees raw team numbers.
 * Both winnerTeam and recorderTeam must be 1 or 2 per WoT Blitz domain.
 */
public final class FriendlyEnemyResult {

    private FriendlyEnemyResult() {}

    public enum Winner {
        FRIENDLY_WIN,
        ENEMY_WIN,
        DRAW_OR_UNKNOWN
    }

    /**
     * Resolve winner relative to the recorder's team.
     * Both teams must be 1 or 2; anything else returns DRAW_OR_UNKNOWN.
     */
    public static Winner resolve(final Integer winnerTeam, final int recorderTeam) {
        if (!PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return Winner.DRAW_OR_UNKNOWN;
        }
        if (winnerTeam == null || !PlayerSideResolver.isValidRawTeam(winnerTeam)) {
            return Winner.DRAW_OR_UNKNOWN;
        }
        if (winnerTeam.equals(recorderTeam)) return Winner.FRIENDLY_WIN;
        return Winner.ENEMY_WIN;
    }

    /**
     * Resolve winner from a battle (uses recorderTeam internally).
     */
    public static Winner resolve(final Battle battle) {
        if (battle == null) return Winner.DRAW_OR_UNKNOWN;
        final Integer recorderTeam = PlayerSideResolver.resolveRecorderTeam(battle);
        if (recorderTeam == null) return Winner.DRAW_OR_UNKNOWN;
        return resolve(battle.winnerTeam, recorderTeam);
    }

    /** Short Chinese label for each winner value. */
    public static String label(final Winner w) {
        return switch (w) {
            case FRIENDLY_WIN -> "友方获胜";
            case ENEMY_WIN -> "敌方获胜";
            case DRAW_OR_UNKNOWN -> "平局或未知";
        };
    }
}
