package com.wotb.core.league;

/**
 * League Rating quality metadata (non-blocking limitation, not a failure).
 *
 * <p>Boundary with {@link LeagueFailure}: failure = a real problem that prevents rating
 * the whole battle; quality limitation = rating is still produced, but some sub-facts
 * cannot be reliably proven from the replay (e.g. exact death time UNKNOWN), so the
 * dimension depending on that fact is conservatively scored 0 (fail-closed).</p>
 */
public record LeagueRatingQuality(int unknownDeathTimePlayers) {

    /** No quality limitation (no destroyed player with UNKNOWN death time in the batch). */
    public static final LeagueRatingQuality NONE = new LeagueRatingQuality(0);
}
