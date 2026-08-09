package com.wotb.web.replay.ai;

import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 解析并严格验证 Team Autopsy 的 JSON 输出。
 * <p>容忍 markdown 代码围栏；但任何契约不成立（虚构/重复 playerKey、非法枚举、
 * verdict 引用无效 playerKey、evidence 为空、空对象、判胜无 MVP / 判负无战犯）
 * 时整段返回 {@code null}，由 Harness 决定不输出团队剖析段。</p>
 */
public final class TeamAutopsyParser {

    static final int MAX_PLAYERS = 7;
    static final int MAX_VERDICTS = 5;
    static final int MAX_LIMITATIONS = 8;
    static final int MAX_TEXT_LENGTH = 120;

    private static final Set<String> CONTRIBUTION_VALUES =
            Set.of("HIGH", "MEDIUM", "LOW", "UNKNOWN");
    private static final Set<String> CONFIDENCE_VALUES =
            Set.of("EXACT", "INFERRED", "PARTIAL", "UNKNOWN");

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private TeamAutopsyParser() {
    }

    /**
     * @param rosterPlayerKeys 本方 roster 的合法 playerKey（P1..P7）
     * @param winner           通过显式 recorderTeam 计算的胜负；FRIENDLY_WIN 要求 mvps 非空、
     *                         ENEMY_WIN 要求 biggestLiabilities 非空
     */
    public static TeamAutopsyResult parse(final String output,
                                          final Set<String> rosterPlayerKeys,
                                          final Winner winner) {
        if (output == null || output.isBlank()
                || rosterPlayerKeys == null || rosterPlayerKeys.isEmpty()
                || winner == null || winner == Winner.DRAW_OR_UNKNOWN) {
            return null;
        }
        try {
            final JsonNode root = MAPPER.readTree(extractJson(output));
            if (root == null || !root.isObject()) {
                return null;
            }
            final List<TeamAutopsyResult.AutopsyPlayer> players =
                    parsePlayers(root.get("players"), rosterPlayerKeys);
            final List<TeamAutopsyResult.AutopsyVerdict> mvps =
                    parseVerdicts(root.get("mvps"), rosterPlayerKeys);
            final List<TeamAutopsyResult.AutopsyVerdict> liabilities =
                    parseVerdicts(root.get("biggestLiabilities"), rosterPlayerKeys);
            if (players.isEmpty()) {
                return null;
            }
            if (winner == Winner.FRIENDLY_WIN && mvps.isEmpty()) {
                return null;
            }
            if (winner == Winner.ENEMY_WIN && liabilities.isEmpty()) {
                return null;
            }
            return new TeamAutopsyResult(
                    players,
                    mvps,
                    liabilities,
                    capList(root.get("limitations"), MAX_LIMITATIONS));
        } catch (final Exception e) {
            return null;
        }
    }

    private static List<TeamAutopsyResult.AutopsyPlayer> parsePlayers(
            final JsonNode node, final Set<String> rosterPlayerKeys) {
        final List<TeamAutopsyResult.AutopsyPlayer> result = new ArrayList<>();
        final Set<String> seen = new HashSet<>();
        if (node == null || !node.isArray()) {
            return result;
        }
        for (final JsonNode item : node) {
            if (result.size() >= MAX_PLAYERS) {
                return result;
            }
            if (item == null || !item.isObject()) {
                return List.of();
            }
            final String playerKey = cap(item.path("playerKey").asText(""), 8);
            final String contribution =
                    cap(item.path("contribution").asText(""), 20).toUpperCase(Locale.ROOT);
            final String confidence =
                    cap(item.path("confidence").asText(""), 20).toUpperCase(Locale.ROOT);
            if (!rosterPlayerKeys.contains(playerKey)
                    || !seen.add(playerKey)
                    || !CONTRIBUTION_VALUES.contains(contribution)
                    || !CONFIDENCE_VALUES.contains(confidence)) {
                return List.of();
            }
            result.add(new TeamAutopsyResult.AutopsyPlayer(playerKey, contribution, confidence));
        }
        return result;
    }

    private static List<TeamAutopsyResult.AutopsyVerdict> parseVerdicts(
            final JsonNode node, final Set<String> rosterPlayerKeys) {
        final List<TeamAutopsyResult.AutopsyVerdict> result = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return result;
        }
        for (final JsonNode item : node) {
            if (result.size() >= MAX_VERDICTS) {
                return result;
            }
            if (item == null || !item.isObject()) {
                return List.of();
            }
            final String playerKey = cap(item.path("playerKey").asText(""), 8);
            final String confidence =
                    cap(item.path("confidence").asText(""), 20).toUpperCase(Locale.ROOT);
            final List<String> evidence = capList(item.get("evidence"), 5);
            if (!rosterPlayerKeys.contains(playerKey)
                    || !CONFIDENCE_VALUES.contains(confidence)
                    || evidence.isEmpty()) {
                return List.of();
            }
            result.add(new TeamAutopsyResult.AutopsyVerdict(
                    playerKey,
                    cap(item.path("reason").asText(""), MAX_TEXT_LENGTH),
                    evidence,
                    confidence));
        }
        return result;
    }

    private static List<String> capList(final JsonNode node, final int max) {
        final List<String> result = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return result;
        }
        for (final JsonNode item : node) {
            final String text = cap(item.asText(""), MAX_TEXT_LENGTH);
            if (!text.isBlank()) {
                result.add(text);
                if (result.size() >= max) {
                    break;
                }
            }
        }
        return result;
    }

    private static String cap(final String text, final int maxLength) {
        if (text == null) {
            return "";
        }
        final String trimmed = text.trim();
        return trimmed.length() <= maxLength ? trimmed : trimmed.substring(0, maxLength);
    }

    private static String extractJson(final String output) {
        String text = output.trim();
        if (text.startsWith("```")) {
            final int firstNewline = text.indexOf('\n');
            final int lastFence = text.lastIndexOf("```");
            if (firstNewline >= 0 && lastFence > firstNewline) {
                text = text.substring(firstNewline + 1, lastFence).trim();
            }
        }
        final int firstBrace = text.indexOf('{');
        final int lastBrace = text.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return text.substring(firstBrace, lastBrace + 1);
        }
        return text;
    }
}
