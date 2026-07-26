package com.wotb.core.processing;

import com.wotb.core.model.Battle;

/**
 * Converts winner team into FRIENDLY_WIN / ENEMY_WIN / DRAW_OR_UNKNOWN
 * for random-battle player-focused analysis.
 * <p>
 * Used in AI prompts so the model never sees raw team numbers.
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
     *
     * @param winnerTeam   the battle's winner team (1 or 2), may be null
     * @param recorderTeam the recorder's team (1 or 2), must be > 0
     * @return FRIENDLY_WIN, ENEMY_WIN, or DRAW_OR_UNKNOWN
     */
    public static Winner resolve(Integer winnerTeam, int recorderTeam) {
        if (winnerTeam == null || winnerTeam <= 0 || recorderTeam <= 0) {
            return Winner.DRAW_OR_UNKNOWN;
        }
        if (winnerTeam.equals(recorderTeam)) return Winner.FRIENDLY_WIN;
        return Winner.ENEMY_WIN;
    }

    /**
     * Resolve winner from a battle (uses recorderTeam internally).
     */
    public static Winner resolve(Battle battle) {
        if (battle == null) return Winner.DRAW_OR_UNKNOWN;
        Integer recorderTeam = PlayerSideResolver.resolveRecorderTeam(battle);
        if (recorderTeam == null) return Winner.DRAW_OR_UNKNOWN;
        return resolve(battle.winnerTeam, recorderTeam);
    }

    /** Short Chinese label for each winner value. */
    public static String label(Winner w) {
        return switch (w) {
            case FRIENDLY_WIN -> "友方获胜";
            case ENEMY_WIN -> "敌方获胜";
            case DRAW_OR_UNKNOWN -> "平局或未知";
        };
    }

    /** Short English label for each winner value. */
    public static String labelEn(Winner w) {
        return switch (w) {
            case FRIENDLY_WIN -> "FRIENDLY_WIN";
            case ENEMY_WIN -> "ENEMY_WIN";
            case DRAW_OR_UNKNOWN -> "DRAW_OR_UNKNOWN";
        };
    }
}
