package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Compares duplicate replays using a deterministic settlement/Rating fingerprint only.
 *
 * <p>League duplicate identity is <b>#301 settlement-only</b>: it compares the deterministic
 * settlement facts Rating actually consumes (winnerTeam / arenaBonusType / duration + per-account
 * team / tankId / survived / settlementLifeTimeSec / settlementDeathReasonRaw + the settled stat
 * fields). Non-Rating identity — {@code rosterComplete}, #201 roster evidence, {@code clan},
 * killer/result-entity ids, live reconstruction/provenance — is deliberately excluded so a replay
 * with better live evidence never mutates the rating identity.</p>
 *
 * <p>Comparison is <b>not</b> all-pairs: the first copy is canonical and every later copy is compared
 * against that canonical fingerprint in O(n).</p>
 */
public final class LeagueRatingConflictDetector {

    private LeagueRatingConflictDetector() {
    }

    /**
     * Stable deterministic settlement/Rating fingerprint. The first copy becomes the canonical
     * {@link #validateCopies} fingerprint; equal fingerprints ⇒ duplicate copies, different ⇒ conflict.
     */
    static String fingerprint(final Battle battle) {
        if (battle == null) {
            return "null";
        }
        final StringBuilder sb = new StringBuilder();
        sb.append("w=").append(battle.winnerTeam)
                .append(";t=").append(battle.arenaBonusType)
                .append(";d=").append(battle.durationS);
        if (battle.players != null) {
            final Map<Long, PlayerResult> byAccount = new TreeMap<>();
            for (final PlayerResult p : battle.players) {
                byAccount.put(p.accountId, p);
            }
            for (final PlayerResult p : byAccount.values()) {
                sb.append(";p=").append(p.accountId)
                        .append(':').append(p.team)
                        .append(':').append(p.tankId)
                        .append(':').append(p.survived)
                        .append(':').append(p.settlementLifeTimeSec)
                        .append(':').append(p.settlementDeathReasonRaw)
                        .append(':').append(p.damageDealt)
                        .append(':').append(p.damageAssisted)
                        .append(':').append(p.damageReceived)
                        .append(':').append(p.damageBlocked)
                        .append(':').append(p.kills)
                        .append(':').append(p.nShots)
                        .append(':').append(p.nHitsDealt)
                        .append(':').append(p.nPenetrationsDealt)
                        .append(':').append(p.victoryPointsEarned)
                        .append(':').append(p.victoryPointsSeized)
                        .append(':').append(p.nHitsReceived)
                        .append(':').append(p.nPenetrationsReceived)
                        .append(':').append(p.nEnemiesDamaged);
            }
        }
        return sb.toString();
    }

    /** Two copies are consistent (duplicates) only when their settlement/Rating fingerprints match. */
    public static boolean consistent(final Battle a, final Battle b) {
        if (a == null || b == null) {
            return false;
        }
        return fingerprint(a).equals(fingerprint(b));
    }

    /** Group-level settlement identity check against the first (canonical) copy; never mutates a Battle. */
    public static boolean validateCopies(final List<Battle> copies) {
        if (copies == null || copies.isEmpty() || copies.getFirst() == null) {
            return false;
        }
        final String canonical = fingerprint(copies.getFirst());
        for (int i = 1; i < copies.size(); i++) {
            if (!fingerprint(copies.get(i)).equals(canonical)) {
                return false;
            }
        }
        return true;
    }
}
