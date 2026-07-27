package com.wotb.core.processing;

import com.wotb.core.model.PlayerResult;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Resolves a user-visible team label for TEAM_PERSPECTIVE scope based on
 * dominant clan membership.
 * <p>
 * Rules:
 * <ol>
 *   <li>Count non-blank, trimmed clan tags from the perspective roster.</li>
 *   <li>Normalize by trimming and {@link String#toLowerCase()} for counting.</li>
 *   <li>The tag with the highest member count wins.</li>
 *   <li>If there's a unique highest count, use the MOST COMMON CASING
 *       of that tag (preferring the first encountered casing on tie).</li>
 *   <li>If no clans exist or the highest count is tied, use a stable fallback
 *       derived from the sorted roster identity hash without raw team numbers.</li>
 * </ol>
 * Does NOT modify {@link PlayerResult#clan}.
 */
public final class TeamPerspectiveLabelResolver {

    private TeamPerspectiveLabelResolver() {}

    /**
     * Resolve a user-visible team label for the given roster.
     *
     * @param players the perspective team's authoritative roster
     * @return a stable, human-readable team label without raw team numbers
     */
    public static String resolve(final List<PlayerResult> players) {
        if (players == null || players.isEmpty()) return "未知队伍";

        final Map<String, List<String>> normalizedToOriginals = players.stream()
                .map(p -> p.clan)
                .filter(clan -> StringUtils.hasText(clan))
                .map(String::trim)
                .collect(Collectors.groupingBy(
                        clan -> clan.toLowerCase(Locale.ROOT),
                        LinkedHashMap::new,
                        Collectors.toList()));

        if (normalizedToOriginals.isEmpty()) {
            return stableFallback(players);
        }

        final String winner = resolveDominantClanTag(players);
        if (winner.isEmpty()) {
            return stableFallback(players);
        }

        final List<String> originals = normalizedToOriginals.get(winner);
        final List<String> common = originals.stream()
                .collect(Collectors.groupingBy(s -> s, LinkedHashMap::new, Collectors.counting()))
                .entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue()
                        .reversed()
                        .thenComparing(Map.Entry.comparingByKey()))
                .map(Map.Entry::getKey)
                .toList();
        return common.isEmpty() ? winner : common.getFirst();
    }

    /**
     * Returns the normalized (lowercased) dominant clan tag from the given players,
     * or empty string if there is no unique dominant clan (tie or no clans present).
     * <p>Shared helper used by both {@link #resolve} and partition compatibility logic
     * in the web layer.</p>
     */
    public static String resolveDominantClanTag(final List<PlayerResult> players) {
        if (players == null || players.isEmpty()) return "";
        final Map<String, Long> counts = players.stream()
                .map(p -> p.clan)
                .filter(clan -> StringUtils.hasText(clan))
                .map(String::trim)
                .collect(Collectors.groupingBy(
                        clan -> clan.toLowerCase(Locale.ROOT),
                        LinkedHashMap::new,
                        Collectors.counting()));
        if (counts.isEmpty()) return "";
        final long maxCount = counts.values().stream().max(Long::compare).orElse(0L);
        if (maxCount == 0) return "";
        final long uniqueMaxCount = counts.values().stream().filter(c -> c == maxCount).count();
        if (uniqueMaxCount != 1) return "";
        return counts.entrySet().stream()
                .filter(e -> e.getValue() == maxCount)
                .map(Map.Entry::getKey)
                .findFirst()
                .orElse("");
    }

    /**
     * Stable fallback that does NOT contain raw team numbers.
     * Derived from sorted roster nickname hash.
     */
    private static String stableFallback(final List<PlayerResult> players) {
        final String hash = players.stream()
                .map(p -> {
                    final String nick = StringUtils.hasText(p.nickname) ? p.nickname : "";
                    return p.accountId > 0 ? p.accountId + ":" + nick : nick;
                })
                .sorted()
                .collect(Collectors.joining(","));
        final int code = Math.floorMod(hash.hashCode(), 10000);
        return "队伍-" + code;
    }
}
