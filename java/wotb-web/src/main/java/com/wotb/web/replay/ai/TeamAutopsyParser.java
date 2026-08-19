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
 * 解析并严格验证 Team Autopsy（settlement-only）的 JSON 输出。
 * <p>容忍 markdown 代码围栏；但任何契约不成立（roster 不足 7 个 key、虚构/重复
 * playerKey、LLM 判断出现 EXACT/INFERRED、verdict 引用无效 playerKey、evidence 为空、
 * 空对象、判胜无 MVP / 判负无战犯（允许为空，不强行生成）等）时整段返回 {@code null}，由编排器决定不输出团队剖析段。</p>
 */
public final class TeamAutopsyParser {

    static final int MAX_VERDICTS = 3;
    static final int MAX_LIMITATIONS = 8;
    static final int MAX_TEXT_LENGTH = 120;

    private static final Set<String> CONTRIBUTION_VALUES =
            Set.of("HIGH", "MEDIUM", "LOW", "UNKNOWN");
    /**
     * settlement-only 模式：LLM 判断（contribution / verdict）不是权威结算事实，只能 PARTIAL/UNKNOWN。
     */
    private static final Set<String> SETTLEMENT_CONFIDENCE_VALUES =
            Set.of("PARTIAL", "UNKNOWN");

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private TeamAutopsyParser() {
    }

    /**
     * @param rosterPlayerKeys 本方 roster 的合法 playerKey（必须恰好 7 个有效唯一 key）
     * @param winner           通过显式 recorderTeam 计算的胜负；mvps / biggestLiabilities 允许为空（Quality Gate）
     */
    public static TeamAutopsyResult parse(final String output,
                                          final Set<String> rosterPlayerKeys,
                                          final Winner winner) {
        if (output == null || output.isBlank()
                || rosterPlayerKeys == null || rosterPlayerKeys.size() != 7
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
            if (players == null || mvps == null || liabilities == null) {
                return null;
            }
            // Quality Gate（PR #103）：结算级数据没有明显异常时，允许 mvps / biggestLiabilities 为空，
            // 不为了结构完整强行生成评价；空数组是合法结果（UI 不渲染对应段落）。
            return new TeamAutopsyResult(
                    players,
                    mvps,
                    liabilities,
                    capList(root.get("limitations"), MAX_LIMITATIONS));
        } catch (final Exception e) {
            return null;
        }
    }

    /**
     * players 的 playerKey 集合必须与 roster 完全相等；超长/缺失/额外/重复均拒绝。
     */
    private static List<TeamAutopsyResult.AutopsyPlayer> parsePlayers(
            final JsonNode node, final Set<String> rosterPlayerKeys) {
        if (node == null || !node.isArray()
                || node.size() != rosterPlayerKeys.size()) {
            return null;
        }
        final List<TeamAutopsyResult.AutopsyPlayer> result = new ArrayList<>();
        final Set<String> seen = new HashSet<>();
        for (final JsonNode item : node) {
            if (item == null || !item.isObject()) {
                return null;
            }
            final String playerKey = cap(item.path("playerKey").asText(""), 8);
            final String contribution =
                    cap(item.path("contribution").asText(""), 20).toUpperCase(Locale.ROOT);
            final String confidence =
                    cap(item.path("confidence").asText(""), 20).toUpperCase(Locale.ROOT);
            if (!rosterPlayerKeys.contains(playerKey)
                    || !seen.add(playerKey)
                    || !CONTRIBUTION_VALUES.contains(contribution)
                    || !SETTLEMENT_CONFIDENCE_VALUES.contains(confidence)) {
                return null;
            }
            result.add(new TeamAutopsyResult.AutopsyPlayer(playerKey, contribution, confidence));
        }
        if (!result.stream().map(TeamAutopsyResult.AutopsyPlayer::playerKey)
                .collect(java.util.stream.Collectors.toSet()).equals(rosterPlayerKeys)) {
            return null;
        }
        return result;
    }

    /**
     * verdict 列表 ≤3；每条必须引用有效 playerKey、列表内不重复、reason 非空、evidence 非空。
     */
    private static List<TeamAutopsyResult.AutopsyVerdict> parseVerdicts(
            final JsonNode node, final Set<String> rosterPlayerKeys) {
        if (node == null || !node.isArray()) {
            return List.of();
        }
        if (node.size() > MAX_VERDICTS) {
            return null;
        }
        final List<TeamAutopsyResult.AutopsyVerdict> result = new ArrayList<>();
        final Set<String> seen = new HashSet<>();
        for (final JsonNode item : node) {
            if (item == null || !item.isObject()) {
                return null;
            }
            final String playerKey = cap(item.path("playerKey").asText(""), 8);
            final String reason = cap(item.path("reason").asText(""), MAX_TEXT_LENGTH);
            final String confidence =
                    cap(item.path("confidence").asText(""), 20).toUpperCase(Locale.ROOT);
            final List<String> evidence = capList(item.get("evidence"), 5);
            if (!rosterPlayerKeys.contains(playerKey)
                    || !seen.add(playerKey)
                    || reason.isBlank()
                    || !SETTLEMENT_CONFIDENCE_VALUES.contains(confidence)
                    || evidence.isEmpty()) {
                return null;
            }
            result.add(new TeamAutopsyResult.AutopsyVerdict(
                    playerKey,
                    reason,
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