package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Compares duplicate replays using stable settlement facts only.
 *
 * <p>Live reconstruction observations and their provenance are deliberately excluded from
 * League identity/conflict decisions. A replay with better live evidence must not mutate the
 * settlement model or change the rating identity.</p>
 */
public final class LeagueRatingConflictDetector {

    private LeagueRatingConflictDetector() {
    }

    /** Two copies are consistent only when all rating-relevant settlement facts match. */
    public static boolean consistent(final Battle a, final Battle b) {
        if (a == null || b == null
                || !java.util.Objects.equals(a.winnerTeam, b.winnerTeam)
                || !java.util.Objects.equals(a.arenaBonusType, b.arenaBonusType)
                || !java.util.Objects.equals(a.rosterComplete, b.rosterComplete)
                || !java.util.Objects.equals(a.settlementAccountsCoveredByRoster,
                        b.settlementAccountsCoveredByRoster)
                || !java.util.Objects.equals(a.settlementRosterTeamConsistent,
                        b.settlementRosterTeamConsistent)
                || !java.util.Objects.equals(a.durationS, b.durationS)) {
            return false;
        }
        final Map<Long, PlayerResult> left = byAccount(a.players);
        final Map<Long, PlayerResult> right = byAccount(b.players);
        if (left.size() != right.size()) {
            return false;
        }
        for (final Map.Entry<Long, PlayerResult> entry : left.entrySet()) {
            final PlayerResult p = entry.getValue();
            final PlayerResult q = right.get(entry.getKey());
            if (q == null || p.team != q.team || p.tankId != q.tankId
                    || p.survived != q.survived
                    || p.settlementResultEntityId != q.settlementResultEntityId
                    || Double.compare(p.settlementLifeTimeSec, q.settlementLifeTimeSec) != 0
                    || !java.util.Objects.equals(p.settlementDeathReasonRaw, q.settlementDeathReasonRaw)
                    || !java.util.Objects.equals(p.settlementKillerResultEntityId,
                            q.settlementKillerResultEntityId)
                    || !java.util.Objects.equals(p.killerAccountId, q.killerAccountId)
                    || p.damageDealt != q.damageDealt
                    || p.damageAssisted != q.damageAssisted
                    || p.damageReceived != q.damageReceived
                    || p.damageBlocked != q.damageBlocked
                    || p.kills != q.kills
                    || p.nShots != q.nShots
                    || p.nHitsDealt != q.nHitsDealt
                    || p.nPenetrationsDealt != q.nPenetrationsDealt
                    || p.victoryPointsEarned != q.victoryPointsEarned
                    || p.victoryPointsSeized != q.victoryPointsSeized
                    || p.nHitsReceived != q.nHitsReceived
                    || p.nPenetrationsReceived != q.nPenetrationsReceived
                    || p.nEnemiesDamaged != q.nEnemiesDamaged
                    || !java.util.Objects.equals(p.clan, q.clan)) {
                return false;
            }
        }
        return true;
    }

    /** Group-level all-pairs settlement identity check; never mutates a retained Battle. */
    public static boolean validateCopies(final List<Battle> copies) {
        if (copies == null || copies.isEmpty() || copies.getFirst() == null) {
            return false;
        }
        for (int i = 0; i < copies.size(); i++) {
            for (int j = i + 1; j < copies.size(); j++) {
                if (!consistent(copies.get(i), copies.get(j))) {
                    return false;
                }
            }
        }
        return true;
    }

    private static Map<Long, PlayerResult> byAccount(final List<PlayerResult> players) {
        final Map<Long, PlayerResult> result = new HashMap<>();
        if (players != null) {
            for (final PlayerResult player : players) {
                result.put(player.accountId, player);
            }
        }
        return result;
    }
}
