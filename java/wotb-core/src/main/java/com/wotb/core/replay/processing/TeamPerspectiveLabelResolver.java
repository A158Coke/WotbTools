package com.wotb.core.replay.processing;

import com.wotb.core.model.PlayerResult;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Resolves team identity labels for TEAM_PERSPECTIVE scope.
 * <p><b>PR #103 review BLOCKER A</b>：internal identity 与 user-facing display label
 * 严格分离，任何方法都不再同时承担两者：
 * <ul>
 *   <li>{@link #resolveDisplayLabel(List)} —— 用户可见 display label：只有<b>唯一 dominant
 *       且严格多数（超过一半成员）</b>的 clan tag 才返回其最常见 casing；无 clan / 平票 /
 *       非多数一律返回空串（由上层 fallback 到「我方/对方」）。绝不返回 {@code 队伍-XXXX}。</li>
 *   <li>{@link #resolveStableKey(List)} —— 内部稳定身份键（roster hash），可用于 internal
 *       identity；<b>禁止</b>进入任何 user-facing 输出路径（Prompt 正文 / UI / 渲染）。</li>
 *   <li>{@link #resolveDominantClanTag(List)} —— 归一化（小写）dominant clan tag，供内部
 *       partition 兼容逻辑使用；不区分大小写、取唯一最高计数，不要求多数（内部用途）。</li>
 * </ul>
 * 可靠性门槛：7 人团队需要 ≥4 人同 clan；2 个玩家同 clan、其他 5 个全不同时<b>不</b>
 * 把整队命名为该 clan（多数派保守规则，避免过度命名）。
 * Does NOT modify {@link PlayerResult#clan}.</p>
 */
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
            // 非严格多数（含 2/7 之类的 minority dominant）：不把整队命名为该 clan
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

    /**
     * 内部稳定身份键：基于排序 roster 昵称/账号 hash 的 {@code 队伍-<code>}。
     * <p><b>internal only</b>：可用于内部 identity 比较，<b>禁止</b>出现在任何
     * 用户可见输出（Prompt 正文 / UI / PreBattleSectionRenderer / Autopsy 渲染）。</p>
     */
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

    /**
     * Returns the normalized (lowercased) dominant clan tag from the given players,
     * or empty string if there is no unique dominant clan (tie or no clans present).
     * <p>Internal helper: does NOT require a majority and is NOT user-facing.</p>
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

    private static long countClan(final List<PlayerResult> players, final String normalizedTag) {
        return players.stream()
                .map(p -> p.clan)
                .filter(clan -> StringUtils.hasText(clan))
                .map(String::trim)
                .filter(clan -> clan.toLowerCase(Locale.ROOT).equals(normalizedTag))
                .count();
    }
}
