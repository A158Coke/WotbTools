package com.wotb.core.replay.processing;

import com.wotb.core.model.PlayerResult;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

public final class TeamPerspectiveLabelResolver {

    private TeamPerspectiveLabelResolver() {}

    /**
     * 用户可见 display label：唯一 dominant 且严格多数（{@code count * 2 > roster.size()}）
     * 的 clan tag（最常见 casing）；否则返回空串。
     * <p>调用方负责 fallback：本方空 → 「我方」；对方空 → 「对方」。</p>
     *
     * @param players the perspective team's authoritative roster
     * @return clan tag（最常见 casing）或空串；绝不返回 {@code 队伍-XXXX}
     */
    public static String resolveDisplayLabel(final List<PlayerResult> players) {
        if (players == null || players.isEmpty()) {
            return "";
        }
        final String winner = resolveDominantClanTag(players);
        if (winner.isEmpty()) {
            return "";
        }
        final long winnerCount = countClan(players, winner);
        if (winnerCount * 2L <= players.size()) {
            return "";
        }
        final Map<String, Long> casingCounts = players.stream()
                .map(p -> p.clan)
                .filter(clan -> StringUtils.hasText(clan))
                .map(String::trim)
                .filter(clan -> clan.toLowerCase(Locale.ROOT).equals(winner))
                .collect(Collectors.groupingBy(s -> s, LinkedHashMap::new, Collectors.counting()));
        return casingCounts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue()
                        .reversed()
                        .thenComparing(Map.Entry.comparingByKey()))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElse("");
    }

    public static String resolveStableKey(final List<PlayerResult> players) {
        if (players == null || players.isEmpty()) {
            return "队伍-0";
        }
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

    private static long countClan(final List<PlayerResult> players, final String normalizedTag) {
        return players.stream()
                .map(p -> p.clan)
                .filter(clan -> StringUtils.hasText(clan))
                .map(String::trim)
                .filter(clan -> clan.toLowerCase(Locale.ROOT).equals(normalizedTag))
                .count();
    }
}
