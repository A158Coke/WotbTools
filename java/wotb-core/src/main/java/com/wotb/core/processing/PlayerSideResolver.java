package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

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

    public static Side resolve(final int recorderTeam, final int playerTeam) {
        if (!isValidRawTeam(recorderTeam) || !isValidRawTeam(playerTeam)) {
            return Side.UNKNOWN;
        }
        return recorderTeam == playerTeam ? Side.FRIENDLY : Side.ENEMY;
    }

    public static Side resolve(final Battle battle, final PlayerResult player) {
        if (battle == null || player == null) return Side.UNKNOWN;
        final Integer rt = resolveRecorderTeam(battle);
        if (rt == null) return Side.UNKNOWN;
        return resolve(rt, player.team);
    }

    public static Map<PlayerResult, Side> resolveAll(final Battle battle) {
        if (battle == null || battle.players == null) return new LinkedHashMap<>();
        final Integer rt = resolveRecorderTeam(battle);
        if (rt == null) {
            return battle.players.stream()
                    .collect(Collectors.toMap(
                            p -> p, p -> Side.UNKNOWN,
                            (a, b) -> a, LinkedHashMap::new));
        }
        return battle.players.stream()
                .collect(Collectors.toMap(
                        p -> p, p -> resolve(rt, p.team),
                        (a, b) -> a, LinkedHashMap::new));
    }

    public static Integer resolveRecorderTeam(final Battle battle) {
        if (battle == null) return null;
        final PlayerResult rec = battle.recorderResult();
        if (rec == null) return null;
        return isValidRawTeam(rec.team) ? rec.team : null;
    }
}
