package com.wotb.web.replay.ai;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * 解析 Team Autopsy 的 JSON 输出。容忍 markdown 代码围栏；字段缺失兜底为空；
 * 解析失败返回 {@code null}（由 Harness 决定不输出团队剖析段，不影响主复盘）。
 */
public final class TeamAutopsyParser {

    static final int MAX_PLAYERS = 7;
    static final int MAX_VERDICTS = 5;
    static final int MAX_LIMITATIONS = 8;
    static final int MAX_TEXT_LENGTH = 120;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private TeamAutopsyParser() {
    }

    public static TeamAutopsyResult parse(final String output) {
        if (output == null || output.isBlank()) {
            return null;
        }
        try {
            final JsonNode root = MAPPER.readTree(extractJson(output));
            if (root == null || !root.isObject()) {
                return null;
            }
            return new TeamAutopsyResult(
                    parsePlayers(root.get("players")),
                    parseVerdicts(root.get("mvps")),
                    parseVerdicts(root.get("biggestLiabilities")),
                    capList(root.get("limitations"), MAX_LIMITATIONS));
        } catch (final Exception e) {
            return null;
        }
    }

    private static List<TeamAutopsyResult.AutopsyPlayer> parsePlayers(final JsonNode node) {
        final List<TeamAutopsyResult.AutopsyPlayer> result = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return result;
        }
        for (final JsonNode item : node) {
            if (item == null || !item.isObject()) {
                continue;
            }
            result.add(new TeamAutopsyResult.AutopsyPlayer(
                    cap(item.path("tank").asText(""), 60),
                    cap(item.path("contribution").asText("UNKNOWN"), 20),
                    cap(item.path("confidence").asText("UNKNOWN"), 20)));
            if (result.size() >= MAX_PLAYERS) {
                break;
            }
        }
        return result;
    }

    private static List<TeamAutopsyResult.AutopsyVerdict> parseVerdicts(final JsonNode node) {
        final List<TeamAutopsyResult.AutopsyVerdict> result = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return result;
        }
        for (final JsonNode item : node) {
            if (item == null || !item.isObject()) {
                continue;
            }
            result.add(new TeamAutopsyResult.AutopsyVerdict(
                    cap(item.path("tank").asText(""), 60),
                    cap(item.path("reason").asText(""), MAX_TEXT_LENGTH),
                    capList(item.get("evidence"), 5),
                    cap(item.path("confidence").asText("UNKNOWN"), 20)));
            if (result.size() >= MAX_VERDICTS) {
                break;
            }
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
