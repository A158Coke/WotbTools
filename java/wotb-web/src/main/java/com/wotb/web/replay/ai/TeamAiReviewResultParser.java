package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamAiReviewResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Technical parser for Team AI Review v0.5.
 *
 * <p>This class deliberately does not inspect tactical meaning. It only checks JSON shape,
 * scalar types, size limits, and references to the already-known roster/episodes.</p>
 */
public final class TeamAiReviewResultParser {

    public static final int MAX_EPISODES = 6;
    public static final int MAX_REVIEW_FOCUS = 2;
    public static final int MAX_HIGH_CONTRIBUTORS = 2;
    public static final int MAX_TRAINING_SUGGESTIONS = 12;

    private static final int MAX_OUTPUT_CHARS = 64_000;
    private static final int MAX_ID_CHARS = 64;
    private static final int MAX_TITLE_CHARS = 240;
    private static final int MAX_REASON_CHARS = 2_000;
    private static final int MAX_SUMMARY_CHARS = 4_000;
    private static final int MAX_ANALYSIS_CHARS = 8_000;
    private static final int MAX_SUGGESTION_CHARS = 6_000;
    private static final int MAX_PLAYER_KEYS_PER_EPISODE = 8;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private TeamAiReviewResultParser() {
    }

    public static ParseResult parse(final String output, final Set<String> rosterPlayerKeys) {
        if (output == null || output.isBlank()) {
            return ParseResult.fail(Failure.EMPTY_OUTPUT);
        }
        if (output.length() > MAX_OUTPUT_CHARS) {
            return ParseResult.fail(Failure.OUTPUT_TOO_LARGE);
        }
        try {
            final JsonNode root = MAPPER.readTree(extractJson(output));
            if (root == null || !root.isObject()) {
                return ParseResult.fail(Failure.INVALID_JSON);
            }
            if (!hasOnlyFields(root, Set.of("summary", "episodes", "trainingSuggestions",
                    "reviewFocus", "highContributors"))) {
                return ParseResult.fail(Failure.INVALID_FIELD);
            }
            final JsonNode summaryNode = object(root, "summary");
            if (summaryNode == null) {
                return ParseResult.fail(Failure.MISSING_REQUIRED_FIELD);
            }
            if (!hasOnlyFields(summaryNode, Set.of("verdict", "primaryDiagnosis"))) {
                return ParseResult.fail(Failure.INVALID_FIELD);
            }
            final String verdict = requiredText(summaryNode, "verdict", MAX_SUMMARY_CHARS);
            final String diagnosis = requiredText(summaryNode, "primaryDiagnosis", MAX_SUMMARY_CHARS);
            if (verdict == null || diagnosis == null) {
                return ParseResult.fail(Failure.INVALID_FIELD);
            }

            final List<JsonNode> episodeNodes = requiredArray(root, "episodes");
            final List<JsonNode> suggestionNodes = requiredArray(root, "trainingSuggestions");
            final List<JsonNode> focusNodes = requiredArray(root, "reviewFocus");
            final List<JsonNode> contributorNodes = requiredArray(root, "highContributors");
            if (episodeNodes == null || suggestionNodes == null || focusNodes == null
                    || contributorNodes == null) {
                return ParseResult.fail(Failure.MISSING_REQUIRED_FIELD);
            }
            if (episodeNodes.size() > MAX_EPISODES
                    || suggestionNodes.size() > MAX_TRAINING_SUGGESTIONS
                    || focusNodes.size() > MAX_REVIEW_FOCUS
                    || contributorNodes.size() > MAX_HIGH_CONTRIBUTORS) {
                return ParseResult.fail(Failure.CARDINALITY_EXCEEDED);
            }

            final Set<String> roster = rosterPlayerKeys == null ? Set.of() : Set.copyOf(rosterPlayerKeys);
            final Set<String> episodeIds = new HashSet<>();
            final List<TeamAiReviewResult.Episode> episodes = new ArrayList<>();
            for (final JsonNode node : episodeNodes) {
                if (node == null || !node.isObject()) {
                    return ParseResult.fail(Failure.INVALID_FIELD);
                }
                if (!hasOnlyFields(node, Set.of("id", "startSec", "endSec", "title", "analysis", "playerKeys"))) {
                    return ParseResult.fail(Failure.INVALID_FIELD);
                }
                final String id = requiredText(node, "id", MAX_ID_CHARS);
                final String title = requiredText(node, "title", MAX_TITLE_CHARS);
                final String analysis = requiredText(node, "analysis", MAX_ANALYSIS_CHARS);
                final List<String> players = stringArray(node, "playerKeys", MAX_PLAYER_KEYS_PER_EPISODE);
                if (!node.has("startSec") || !node.has("endSec")) {
                    return ParseResult.fail(Failure.MISSING_REQUIRED_FIELD);
                }
                final Integer start = optionalInt(node, "startSec");
                final Integer end = optionalInt(node, "endSec");
                if (id == null || title == null || analysis == null || players == null
                        || !validSeconds(start, end) || !episodeIds.add(id)) {
                    return ParseResult.fail(Failure.INVALID_FIELD);
                }
                if (players.stream().anyMatch(key -> !roster.contains(key))) {
                    return ParseResult.fail(Failure.INVALID_REFERENCE);
                }
                episodes.add(new TeamAiReviewResult.Episode(id, start, end, title, analysis, players));
            }

            final List<TeamAiReviewResult.TrainingSuggestion> suggestions = new ArrayList<>();
            for (final JsonNode node : suggestionNodes) {
                if (node == null || !node.isObject()) {
                    return ParseResult.fail(Failure.INVALID_FIELD);
                }
                if (!hasOnlyFields(node, Set.of("title", "content", "episodeId"))) {
                    return ParseResult.fail(Failure.INVALID_FIELD);
                }
                if (!node.has("episodeId")) return ParseResult.fail(Failure.MISSING_REQUIRED_FIELD);
                final String title = requiredText(node, "title", MAX_TITLE_CHARS);
                final String content = requiredText(node, "content", MAX_SUGGESTION_CHARS);
                final JsonNode episodeIdNode = node.get("episodeId");
                final String episodeId = episodeIdNode.isNull()
                        ? null : optionalText(node, "episodeId", MAX_ID_CHARS);
                if (!episodeIdNode.isNull() && (episodeId == null || !episodeIdNode.isTextual())) {
                    return ParseResult.fail(Failure.INVALID_FIELD);
                }
                if (title == null || content == null
                        || (episodeId != null && !episodeIds.contains(episodeId))) {
                    return ParseResult.fail(episodeId != null ? Failure.INVALID_REFERENCE : Failure.INVALID_FIELD);
                }
                suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, episodeId));
            }

            final List<TeamAiReviewResult.ReviewFocus> focus = new ArrayList<>();
            for (final JsonNode node : focusNodes) {
                final TeamAiReviewResult.ReviewFocus item = parseFocus(node, episodeIds, roster);
                if (item == null) {
                    return ParseResult.fail(Failure.INVALID_REFERENCE);
                }
                focus.add(item);
            }
            final List<TeamAiReviewResult.HighContributor> contributors = new ArrayList<>();
            for (final JsonNode node : contributorNodes) {
                final TeamAiReviewResult.HighContributor item = parseContributor(node, episodeIds, roster);
                if (item == null) {
                    return ParseResult.fail(Failure.INVALID_REFERENCE);
                }
                contributors.add(item);
            }
            return ParseResult.ok(new TeamAiReviewResult(
                    new TeamAiReviewResult.Summary(verdict, diagnosis),
                    List.copyOf(episodes), List.copyOf(suggestions), List.copyOf(focus),
                    List.copyOf(contributors)));
        } catch (final RuntimeException e) {
            return ParseResult.fail(Failure.INVALID_JSON);
        }
    }

    private static TeamAiReviewResult.ReviewFocus parseFocus(
            final JsonNode node, final Set<String> episodeIds, final Set<String> roster) {
        if (node == null || !node.isObject()) return null;
        if (!hasOnlyFields(node, Set.of("playerKey", "episodeId", "reason"))) return null;
        final String playerKey = requiredText(node, "playerKey", MAX_ID_CHARS);
        final String episodeId = requiredText(node, "episodeId", MAX_ID_CHARS);
        final String reason = requiredText(node, "reason", MAX_REASON_CHARS);
        return playerKey != null && episodeId != null && reason != null
                && roster.contains(playerKey) && episodeIds.contains(episodeId)
                ? new TeamAiReviewResult.ReviewFocus(playerKey, episodeId, reason) : null;
    }

    private static TeamAiReviewResult.HighContributor parseContributor(
            final JsonNode node, final Set<String> episodeIds, final Set<String> roster) {
        if (node == null || !node.isObject()) return null;
        if (!hasOnlyFields(node, Set.of("playerKey", "episodeId", "reason"))) return null;
        final String playerKey = requiredText(node, "playerKey", MAX_ID_CHARS);
        final String episodeId = requiredText(node, "episodeId", MAX_ID_CHARS);
        final String reason = requiredText(node, "reason", MAX_REASON_CHARS);
        return playerKey != null && episodeId != null && reason != null
                && roster.contains(playerKey) && episodeIds.contains(episodeId)
                ? new TeamAiReviewResult.HighContributor(playerKey, episodeId, reason) : null;
    }

    private static JsonNode object(final JsonNode parent, final String name) {
        final JsonNode value = parent.get(name);
        return value != null && value.isObject() ? value : null;
    }

    private static boolean hasOnlyFields(final JsonNode object, final Set<String> allowed) {
        for (final var entry : object.properties()) {
            if (!allowed.contains(entry.getKey())) return false;
        }
        return true;
    }

    private static List<JsonNode> requiredArray(final JsonNode parent, final String name) {
        final JsonNode value = parent.get(name);
        if (value == null || !value.isArray()) return null;
        final List<JsonNode> result = new ArrayList<>();
        value.forEach(result::add);
        return result;
    }

    private static List<String> stringArray(final JsonNode parent, final String name, final int max) {
        final JsonNode value = parent.get(name);
        if (value == null || !value.isArray() || value.size() > max) return null;
        final List<String> result = new ArrayList<>();
        for (final JsonNode item : value) {
            if (item == null || !item.isTextual() || item.asText().isBlank()
                    || item.asText().length() > MAX_ID_CHARS) return null;
            result.add(item.asText());
        }
        return result;
    }

    private static String requiredText(final JsonNode parent, final String name, final int max) {
        final String value = optionalText(parent, name, max);
        return value == null || value.isBlank() ? null : value;
    }

    private static String optionalText(final JsonNode parent, final String name, final int max) {
        final JsonNode value = parent.get(name);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual() || value.asText().length() > max) return null;
        return value.asText();
    }

    private static Integer optionalInt(final JsonNode parent, final String name) {
        final JsonNode value = parent.get(name);
        if (value == null || value.isNull()) return null;
        if (!value.isIntegralNumber() || value.asLong() < 0 || value.asLong() > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("invalid integer");
        }
        return value.asInt();
    }

    private static boolean validSeconds(final Integer start, final Integer end) {
        return start == null || end == null || end >= start;
    }

    private static String extractJson(final String output) {
        final String trimmed = output.trim();
        final int start = trimmed.indexOf('{');
        final int end = trimmed.lastIndexOf('}');
        return start >= 0 && end > start ? trimmed.substring(start, end + 1) : trimmed;
    }

    public record ParseResult(TeamAiReviewResult result, Failure failure) {
        static ParseResult ok(final TeamAiReviewResult result) { return new ParseResult(result, null); }
        static ParseResult fail(final Failure failure) { return new ParseResult(null, failure); }
        public boolean failed() { return result == null; }
    }

    public enum Failure {
        EMPTY_OUTPUT, INVALID_JSON, OUTPUT_TOO_LARGE, MISSING_REQUIRED_FIELD,
        INVALID_FIELD, CARDINALITY_EXCEEDED, INVALID_REFERENCE
    }
}
