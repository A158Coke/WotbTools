package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Resolves player side (FRIENDLY / ENEMY / UNKNOWN) for random-battle
 * player-focused analysis.
 * <p>
 * Uses the authoritative recorder team from {@code battle.recorderResult()}.
 * Raw teams are restricted to 1 or 2 per WoT Blitz domain.
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

    /** WoT Blitz only uses raw team numbers 1 and 2. */
    public static boolean isValidRawTeam(final int team) {
        return team == 1 || team == 2;
    }

    /**
     * Resolve the side of a player given the recorder's raw team number.
     * Both teams must be 1 or 2; any other value returns UNKNOWN.
     */
    public static Side resolve(final int recorderTeam, final int playerTeam) {
        if (!isValidRawTeam(recorderTeam) || !isValidRawTeam(playerTeam)) {
            return Side.UNKNOWN;
        }
        return recorderTeam == playerTeam ? Side.FRIENDLY : Side.ENEMY;
    }

    /**
     * Resolve the side of a player given the battle and player result.
     */
    public static Side resolve(final Battle battle, final PlayerResult player) {
        if (battle == null || player == null) return Side.UNKNOWN;
        final Integer rt = resolveRecorderTeam(battle);
        if (rt == null) return Side.UNKNOWN;
        return resolve(rt, player.team);
    }

    /**
     * Resolve all players in a battle into sides relative to the recorder.
     */
    public static Map<PlayerResult, Side> resolveAll(final Battle battle) {
        final Map<PlayerResult, Side> result = new LinkedHashMap<>();
        if (battle == null || battle.players == null) return result;
        final Integer rt = resolveRecorderTeam(battle);
        if (rt == null) {
            for (final PlayerResult p : battle.players) {
                result.put(p, Side.UNKNOWN);
            }
            return result;
        }
        for (final PlayerResult p : battle.players) {
            result.put(p, resolve(rt, p.team));
        }
        return result;
    }

    /**
     * Get the recorder's authoritative team number from battle.
     * Only returns 1 or 2; returns null for any invalid value.
     */
    public static Integer resolveRecorderTeam(final Battle battle) {
        if (battle == null) return null;
        final PlayerResult rec = battle.recorderResult();
        if (rec == null) return null;
        return isValidRawTeam(rec.team) ? rec.team : null;
    }
}
