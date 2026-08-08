package com.wotb.web.replay.ai;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 解析 Call #1 的 JSON 输出。容忍 markdown 代码围栏；字段缺失兜底为空；
 * 解析失败返回 {@code null}（由 Harness 降级，不抛业务异常）。
 */
public final class PreBattleStrategicParser {

    static final int MAX_ITEMS = 6;
    static final int MAX_TEXT_LENGTH = 200;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private PreBattleStrategicParser() {
    }

    public static PreBattleStrategicPrior parse(final String output) {
        if (output == null || output.isBlank()) {
            return null;
        }
        try {
            final JsonNode root = MAPPER.readTree(extractJson(output));
            if (root == null || !root.isObject()) {
                return null;
            }
            return new PreBattleStrategicPrior(
                    parseTeam(root.get("teamA")),
                    parseTeam(root.get("teamB")),
                    parseList(root.get("keyMatchups"), PreBattleStrategicParser::parseMatchup),
                    parseList(root.get("strategicWinConditions"),
                            PreBattleStrategicParser::parseWinCondition),
                    parseList(root.get("hypotheses"), PreBattleStrategicParser::parseHypothesis));
        } catch (final Exception e) {
            return null;
        }
    }

    private static PreBattleStrategicPrior.TeamProfile parseTeam(final JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        final Map<String, String> composition = new LinkedHashMap<>();
        final JsonNode comp = node.get("composition");
        if (comp != null && comp.isObject()) {
            comp.properties().forEach(e -> composition.put(
                    cap(e.getKey(), 40),
                    cap(e.getValue().asText("UNKNOWN"), 20)));
        }
        return new PreBattleStrategicPrior.TeamProfile(
                composition,
                capList(node.get("strengths")),
                capList(node.get("weaknesses")),
                capList(node.get("preferredPlans")));
    }

    private static PreBattleStrategicPrior.KeyMatchup parseMatchup(final JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        return new PreBattleStrategicPrior.KeyMatchup(
                cap(node.path("area").asText(""), 60),
                cap(node.path("advantage").asText(""), 20),
                cap(node.path("reason").asText(""), MAX_TEXT_LENGTH));
    }

    private static PreBattleStrategicPrior.StrategicWinCondition parseWinCondition(final JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        return new PreBattleStrategicPrior.StrategicWinCondition(
                cap(node.path("team").asText(""), 20),
                cap(node.path("condition").asText(""), MAX_TEXT_LENGTH));
    }

    private static PreBattleStrategicPrior.StrategicHypothesis parseHypothesis(final JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        return new PreBattleStrategicPrior.StrategicHypothesis(
                cap(node.path("id").asText(""), 20),
                cap(node.path("claim").asText(""), MAX_TEXT_LENGTH),
                cap(node.path("reason").asText(""), MAX_TEXT_LENGTH));
    }

    private static <T> List<T> parseList(final JsonNode node, final java.util.function.Function<JsonNode, T> mapper) {
        final List<T> result = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return result;
        }
        for (final JsonNode item : node) {
            final T value = mapper.apply(item);
            if (value != null) {
                result.add(value);
                if (result.size() >= MAX_ITEMS) {
                    break;
                }
            }
        }
        return result;
    }

    private static List<String> capList(final JsonNode node) {
        final List<String> result = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return result;
        }
        for (final JsonNode item : node) {
            final String text = cap(item.asText(""), MAX_TEXT_LENGTH);
            if (!text.isBlank()) {
                result.add(text);
                if (result.size() >= MAX_ITEMS) {
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
