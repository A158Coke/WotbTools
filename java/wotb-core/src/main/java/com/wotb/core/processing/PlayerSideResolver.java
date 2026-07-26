package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

/**
 * Resolves player side (FRIENDLY / ENEMY / UNKNOWN) for random-battle
 * player-focused analysis.
 * <p>
 * Uses the authoritative recorder team from {@code battle.recorderResult()}.
 * Does NOT modify {@link PlayerResult#team}. Does NOT apply to
 * TEAM_PERSPECTIVE scope (training / tournament).
 */
public final class PlayerSideResolver {

    private PlayerSideResolver() {}

    public enum Side {
        FRIENDLY,
        ENEMY,
        UNKNOWN
    }

    /**
     * Resolve the side of a player given the recorder's raw team number.
     *
     * @param recorderTeam the recorder's raw team (1 or 2), must be > 0
     * @param playerTeam   the player's raw team (1 or 2), must be > 0
     * @return FRIENDLY, ENEMY, or UNKNOWN
     */
    public static Side resolve(int recorderTeam, int playerTeam) {
        if (recorderTeam <= 0 || playerTeam <= 0) return Side.UNKNOWN;
        return recorderTeam == playerTeam ? Side.FRIENDLY : Side.ENEMY;
    }

    /**
     * Resolve the side of a player given the battle and player result.
     */
    public static Side resolve(Battle battle, PlayerResult player) {
        if (battle == null || player == null) return Side.UNKNOWN;
        Integer rt = resolveRecorderTeam(battle);
        if (rt == null) return Side.UNKNOWN;
        return resolve(rt, player.team);
    }

    /**
     * Resolve all players in a battle into sides relative to the recorder.
     *
     * @param battle the battle with players
     * @return map from each player to its Side
     */
    public static java.util.Map<PlayerResult, Side> resolveAll(Battle battle) {
        java.util.Map<PlayerResult, Side> result = new java.util.LinkedHashMap<>();
        if (battle == null || battle.players == null) return result;
        Integer rt = resolveRecorderTeam(battle);
        if (rt == null) {
            for (PlayerResult p : battle.players) result.put(p, Side.UNKNOWN);
            return result;
        }
        for (PlayerResult p : battle.players) {
            result.put(p, resolve(rt, p.team));
        }
        return result;
    }

    /**
     * Get the recorder's authoritative team number from battle.
     *
     * @return the recorder's team (1 or 2), or null if unavailable
     */
    public static Integer resolveRecorderTeam(Battle battle) {
        if (battle == null) return null;
        PlayerResult rec = battle.recorderResult();
        if (rec == null) return null;
        return rec.team > 0 ? rec.team : null;
    }
}
