package com.wotb.core.processing;

import com.wotb.core.model.PlayerResult;
import org.springframework.util.StringUtils;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
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

        // Count trimmed, lowercased clan tags
        final Map<String, List<String>> normalizedToOriginals = players.stream()
                .map(p -> p.clan)
                .filter(clan -> StringUtils.hasText(clan))
                .map(String::trim)
                .collect(Collectors.groupingBy(
                        clan -> clan.toLowerCase(),
                        LinkedHashMap::new,
                        Collectors.toList()));

        if (normalizedToOriginals.isEmpty()) {
            return stableFallback(players);
        }

        // Find the normalized tag with the most members
        final String winner = normalizedToOriginals.entrySet().stream()
                .max(Map.Entry.comparingByValue(
                        Comparator.comparingInt(List::size)))
                .map(Map.Entry::getKey)
                .orElse(null);

        if (winner == null) return stableFallback(players);

        // Count how many normalized tags share the same max count
        final int maxCount = normalizedToOriginals.get(winner).size();
        final long tiedCount = normalizedToOriginals.values().stream()
                .filter(list -> list.size() == maxCount)
                .count();

        if (tiedCount > 1) return stableFallback(players);

        // Return the most common original casing (first encountered on tie)
        final List<String> originals = normalizedToOriginals.get(winner);
        return originals.stream()
                .collect(Collectors.groupingBy(s -> s, Collectors.counting()))
                .entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(winner);
    }

    /**
     * Stable fallback that does NOT contain raw team numbers.
     * Derived from sorted roster nickname hash.
     */
    private static String stableFallback(final List<PlayerResult> players) {
        final String hash = players.stream()
                .map(p -> StringUtils.hasText(p.nickname) ? p.nickname : "")
                .sorted()
                .collect(Collectors.joining(","));
        final int code = Math.abs(hash.hashCode()) % 10000;
        return "队伍-" + code;
    }
}
