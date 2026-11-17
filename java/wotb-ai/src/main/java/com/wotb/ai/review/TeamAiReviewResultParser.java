package com.wotb.ai.review;

import com.wotb.core.replay.evidence.TeamAiReviewResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Technical parser for Team AI Review.
 *
 * <p>The parser never changes tactical text. It only validates the wire shape and
 * deterministically removes or clears unsupported optional references.</p>
 */
public final class TeamAiReviewResultParser {

    public static final int MAX_EPISODES = 6;
    public static final int MAX_REVIEW_FOCUS = 2;
    public static final int MAX_HIGH_CONTRIBUTORS = 2;
    public static final int MAX_TRAINING_SUGGESTIONS = 12;

    /** Bounded UTF-16 envelope for one provider completion (8192 output tokens by default). */
    private static final int MAX_PROVIDER_OUTPUT_CHARS = 256_000;
    private static final int MAX_SUMMARY_CHARS = 4_000;
    private static final int MAX_ANALYSIS_CHARS = 8_000;
    private static final int MAX_PLAYER_KEYS_PER_EPISODE = 8;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private TeamAiReviewResultParser() {
    }

    public static ParseResult parse(final String output, final Set<String> rosterPlayerKeys) {
        if (output == null || output.isBlank()) {
            return fatal(Failure.EMPTY_OUTPUT, "root", "non-empty JSON object required");
        }
        if (output.length() > MAX_PROVIDER_OUTPUT_CHARS) {
            return fatal(Failure.OUTPUT_TOO_LARGE, "root", "output exceeds safe character limit");
        }
        try {
            final JsonNode root = MAPPER.readTree(output);
            if (root == null || !root.isObject()) {
                return fatal(Failure.INVALID_JSON, "root", "JSON object required");
            }
            final List<ParseFailure> failures = new ArrayList<>();
            final List<Normalization> normalizations = new ArrayList<>();
            collectUnknownFields(root, Set.of("summary", "episodes", "trainingSuggestions",
                    "reviewFocus", "highContributors"), "root", failures, normalizations);

            final JsonNode summaryNode = object(root, "summary");
            if (summaryNode == null) {
                failures.add(failure(Failure.MISSING_REQUIRED_FIELD, "summary",
                        FailureCategory.SALVAGEABLE, "summary object omitted"));
                normalizations.add(new Normalization("summary_defaulted", "summary"));
            }
            if (summaryNode != null) {
                collectUnknownFields(summaryNode, Set.of("verdict", "primaryDiagnosis"),
                        "summary", failures, normalizations);
            }
            final String verdict = salvageText(summaryNode, "verdict", MAX_SUMMARY_CHARS,
                    "summary_verdict_omitted", failures, normalizations);
            final String diagnosis = salvageText(summaryNode, "primaryDiagnosis", MAX_SUMMARY_CHARS,
                    "summary_primary_diagnosis_omitted", failures, normalizations);

            final List<JsonNode> episodeNodes = boundedNodes(arrayOrEmpty(root, "episodes",
                            normalizations, failures, true), MAX_EPISODES, "episodes",
                    failures, normalizations);
            final List<JsonNode> suggestionNodes = boundedNodes(arrayOrEmpty(root,
                            "trainingSuggestions", normalizations, failures, false),
                    MAX_TRAINING_SUGGESTIONS, "trainingSuggestions", failures, normalizations);
            final List<JsonNode> focusNodes = boundedNodes(arrayOrEmpty(root, "reviewFocus",
                            normalizations, failures, false), MAX_REVIEW_FOCUS, "reviewFocus",
                    failures, normalizations);
            final List<JsonNode> contributorNodes = boundedNodes(arrayOrEmpty(root,
                            "highContributors", normalizations, failures, false),
                    MAX_HIGH_CONTRIBUTORS, "highContributors", failures, normalizations);
            final Set<String> roster = rosterPlayerKeys == null ? Set.of() : Set.copyOf(rosterPlayerKeys);
            final Set<String> episodeIds = new HashSet<>();
            final List<TeamAiReviewResult.Episode> episodes = new ArrayList<>();
            for (int index = 0; index < episodeNodes.size(); index++) {
                final JsonNode node = episodeNodes.get(index);
                final String path = "episodes[" + index + "]";
                if (node == null || !node.isObject()) {
                    dropOptional(Failure.INVALID_FIELD, path, "episode object required",
                            failures, normalizations);
                    continue;
                }
                collectUnknownFields(node, Set.of("id", "startSec", "endSec", "title", "analysis",
                        "playerKeys"), path, failures, normalizations);
                final String id = TeamAiReviewParserSupport.optionalText(
                        node, "id", TeamAiReviewParserSupport.MAX_ID_CHARS);
                final String title = TeamAiReviewParserSupport.optionalText(
                        node, "title", TeamAiReviewParserSupport.MAX_TITLE_CHARS);
                final String analysis = TeamAiReviewParserSupport.optionalText(node, "analysis", MAX_ANALYSIS_CHARS);
                if (id == null || title == null || analysis == null) {
                    dropOptional(Failure.MISSING_REQUIRED_FIELD, path,
                            "episode id, title and analysis must be non-empty strings",
                            failures, normalizations);
                    continue;
                }
                if (!node.has("startSec")) {
                    normalizations.add(new Normalization("episode_start_sec_defaulted", path + ".startSec"));
                }
                if (!node.has("endSec")) {
                    normalizations.add(new Normalization("episode_end_sec_defaulted", path + ".endSec"));
                }
                final Integer start = salvageInt(node, "startSec", path, failures, normalizations);
                final Integer end = salvageInt(node, "endSec", path, failures, normalizations);
                Integer normalizedStart = start;
                Integer normalizedEnd = end;
                if (!validSeconds(start, end)) {
                    failures.add(failure(Failure.INVALID_FIELD, path + ".time",
                            FailureCategory.SALVAGEABLE,
                            "endSec must be greater than or equal to startSec"));
                    normalizations.add(new Normalization("episode_time_cleared", path + ".time"));
                    normalizedStart = null;
                    normalizedEnd = null;
                }
                if (!episodeIds.add(id)) {
                    dropOptional(Failure.INVALID_FIELD, path + ".id", "episode id must be unique",
                            failures, normalizations);
                    continue;
                }
                final List<String> players = stringArray(node, "playerKeys", MAX_PLAYER_KEYS_PER_EPISODE,
                        path, failures, normalizations);
                final List<String> validPlayers = new ArrayList<>(players.size());
                for (int playerIndex = 0; playerIndex < players.size(); playerIndex++) {
                    final String playerKey = players.get(playerIndex);
                    if (roster.contains(playerKey)) {
                        validPlayers.add(playerKey);
                    } else {
                        final String playerPath = path + ".playerKeys[" + playerIndex + "]";
                        failures.add(failure(Failure.INVALID_REFERENCE, playerPath,
                                FailureCategory.OPTIONAL_REFERENCE,
                                "must reference an authoritative roster playerKey"));
                        normalizations.add(new Normalization("episode_player_key_dropped", playerPath));
                    }
                }
                episodes.add(new TeamAiReviewResult.Episode(id, normalizedStart, normalizedEnd,
                        title, analysis, validPlayers));
            }

            final TeamAiReviewOptionalSectionsParser.Sections optionalSections =
                    TeamAiReviewOptionalSectionsParser.parse(suggestionNodes, focusNodes,
                            contributorNodes, episodeIds, roster);
            optionalSections.failures().forEach(issue -> failures.add(new ParseFailure(
                    mapFailureCode(issue.code()), issue.path(), FailureCategory.OPTIONAL_REFERENCE,
                    issue.constraint())));
            optionalSections.normalizations().forEach(item -> normalizations.add(
                    new Normalization(item.type(), item.path(), item.count())));
            final TeamAiReviewResult result = new TeamAiReviewResult(
                    new TeamAiReviewResult.Summary(verdict, diagnosis),
                    List.copyOf(episodes), optionalSections.suggestions(), optionalSections.focus(),
                    optionalSections.contributors());
            return normalizations.isEmpty()
                    ? valid(result)
                    : normalized(result, failures, normalizations);
        } catch (final RuntimeException e) {
            return fatal(Failure.INVALID_JSON, "root", "JSON could not be parsed");
        }
    }

    private static void collectUnknownFields(final JsonNode node, final Set<String> allowed,
                                             final String path, final List<ParseFailure> failures,
                                             final List<Normalization> normalizations) {
        if (node == null) {
            return;
        }
        for (final var entry : node.properties()) {
            if (!allowed.contains(entry.getKey())) {
                failures.add(failure(Failure.INVALID_FIELD, path + "." + entry.getKey(),
                        FailureCategory.SALVAGEABLE, "field is not part of TeamAiReviewResult"));
                normalizations.add(new Normalization("unknown_field_omitted",
                        path + "." + entry.getKey()));
            }
        }
    }

    private static Failure mapFailureCode(final TeamAiReviewOptionalSectionsParser.FailureCode code) {
        return switch (code) {
            case MISSING_REQUIRED_FIELD -> Failure.MISSING_REQUIRED_FIELD;
            case INVALID_FIELD -> Failure.INVALID_FIELD;
            case INVALID_REFERENCE -> Failure.INVALID_REFERENCE;
        };
    }

    private static void dropOptional(final Failure code, final String path, final String constraint,
                                     final List<ParseFailure> failures,
                                     final List<Normalization> normalizations) {
        failures.add(failure(code, path, FailureCategory.OPTIONAL_REFERENCE, constraint));
        normalizations.add(new Normalization("optional_item_dropped", path));
    }

    private static List<JsonNode> boundedNodes(final List<JsonNode> nodes, final int max,
                                               final String path,
                                               final List<ParseFailure> failures,
                                               final List<Normalization> normalizations) {
        if (nodes.size() <= max) {
            return nodes;
        }
        final int dropped = nodes.size() - max;
        failures.add(failure(Failure.CARDINALITY_EXCEEDED, path, FailureCategory.SALVAGEABLE,
                "array items beyond " + max + " were dropped"));
        normalizations.add(new Normalization(path + "_truncated", path, dropped));
        return List.copyOf(nodes.subList(0, max));
    }

    private static ParseFailure failure(final Failure code, final String path,
                                        final FailureCategory category, final String constraint) {
        return new ParseFailure(code, path, category, constraint);
    }

    private static ParseResult valid(final TeamAiReviewResult result) {
        return new ParseResult(result, List.of(), List.of(), ParseStatus.VALID);
    }

    private static ParseResult normalized(final TeamAiReviewResult result,
                                          final List<ParseFailure> failures,
                                          final List<Normalization> normalizations) {
        return new ParseResult(result, List.copyOf(failures), List.copyOf(normalizations),
                ParseStatus.VALID_WITH_NORMALIZATION);
    }

    private static ParseResult fatal(final Failure code, final String path, final String constraint) {
        return new ParseResult(null,
                List.of(failure(code, path, FailureCategory.CORE_SCHEMA, constraint)),
                List.of(), ParseStatus.FATAL);
    }

    private static JsonNode object(final JsonNode parent, final String name) {
        final JsonNode value = parent.get(name);
        return value != null && value.isObject() ? value : null;
    }

    private static List<JsonNode> arrayOrEmpty(final JsonNode parent, final String name,
                                                final List<Normalization> normalizations,
                                                final List<ParseFailure> failures,
                                                final boolean preferred) {
        final JsonNode value = parent.get(name);
        if (value == null) {
            normalizations.add(new Normalization(name + "_defaulted", name));
            if (preferred) {
                failures.add(failure(Failure.MISSING_REQUIRED_FIELD, name,
                        FailureCategory.SALVAGEABLE, "preferred array omitted"));
            }
            return List.of();
        }
        if (!value.isArray()) {
            failures.add(failure(Failure.INVALID_FIELD, name, FailureCategory.SALVAGEABLE,
                    "array expected; section omitted"));
            normalizations.add(new Normalization(name + "_dropped", name));
            return List.of();
        }
        final List<JsonNode> result = new ArrayList<>();
        value.forEach(result::add);
        return result;
    }

    private static List<String> stringArray(final JsonNode parent, final String name, final int max,
                                            final String path,
                                            final List<ParseFailure> failures,
                                            final List<Normalization> normalizations) {
        final JsonNode value = parent.get(name);
        if (value == null || !value.isArray()) {
            failures.add(failure(Failure.INVALID_FIELD, path + "." + name,
                    FailureCategory.SALVAGEABLE, "playerKeys array omitted"));
            normalizations.add(new Normalization("episode_player_keys_defaulted", path + "." + name));
            return List.of();
        }
        final List<String> result = new ArrayList<>();
        final int limit = Math.min(value.size(), max);
        if (value.size() > max) {
            final int dropped = value.size() - max;
            failures.add(failure(Failure.CARDINALITY_EXCEEDED, path + "." + name,
                    FailureCategory.SALVAGEABLE, "playerKeys beyond " + max + " were dropped"));
            normalizations.add(new Normalization("episode_player_keys_truncated",
                    path + "." + name, dropped));
        }
        for (int index = 0; index < limit; index++) {
            final JsonNode item = value.get(index);
            if (item == null || !item.isTextual() || item.asText().isBlank()
                    || item.asText().length() > TeamAiReviewParserSupport.MAX_ID_CHARS) {
                failures.add(failure(Failure.INVALID_FIELD, path + "." + name + "[" + index + "]",
                        FailureCategory.SALVAGEABLE, "invalid playerKey dropped"));
                normalizations.add(new Normalization("episode_player_key_dropped",
                        path + "." + name + "[" + index + "]"));
                continue;
            }
            result.add(item.asText());
        }
        return result;
    }

    private static String salvageText(final JsonNode parent, final String name, final int max,
                                      final String normalizationType,
                                      final List<ParseFailure> failures,
                                      final List<Normalization> normalizations) {
        if (parent == null || !parent.has(name)) {
            failures.add(failure(Failure.MISSING_REQUIRED_FIELD, "summary." + name,
                    FailureCategory.SALVAGEABLE, "text omitted"));
            normalizations.add(new Normalization(normalizationType, "summary." + name));
            return null;
        }
        final String value = TeamAiReviewParserSupport.optionalText(parent, name, max);
        if (value == null || value.isBlank()) {
            failures.add(failure(Failure.INVALID_FIELD, "summary." + name,
                    FailureCategory.SALVAGEABLE, "non-empty text omitted"));
            normalizations.add(new Normalization(normalizationType, "summary." + name));
            return null;
        }
        return value;
    }

    private static Integer salvageInt(final JsonNode parent, final String name, final String path,
                                      final List<ParseFailure> failures,
                                      final List<Normalization> normalizations) {
        if (!parent.has(name)) {
            return null;
        }
        if (!validNullableNonNegativeInteger(parent, name)) {
            failures.add(failure(Failure.INVALID_FIELD, path + ".time",
                    FailureCategory.SALVAGEABLE, name + " omitted because it is not a non-negative integer"));
            normalizations.add(new Normalization("episode_time_field_cleared", path + "." + name));
            return null;
        }
        return optionalInt(parent, name);
    }

    private static Integer optionalInt(final JsonNode parent, final String name) {
        final JsonNode value = parent.get(name);
        if (value == null || value.isNull()) return null;
        if (!value.isIntegralNumber() || value.asLong() < 0 || value.asLong() > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("invalid integer");
        }
        return value.asInt();
    }

    private static boolean validNullableNonNegativeInteger(final JsonNode parent, final String name) {
        final JsonNode value = parent.get(name);
        return value != null && (value.isNull()
                || (value.isIntegralNumber()
                && value.asLong() >= 0 && value.asLong() <= Integer.MAX_VALUE));
    }

    private static boolean validSeconds(final Integer start, final Integer end) {
        return start == null || end == null || end >= start;
    }

    public record ParseResult(TeamAiReviewResult result, List<ParseFailure> failures,
                              List<Normalization> normalizations, ParseStatus status) {
        public ParseResult {
            failures = failures == null ? List.of() : List.copyOf(failures);
            normalizations = normalizations == null ? List.of() : List.copyOf(normalizations);
        }

        /** Backward-compatible coarse accessor for older callers/tests. */
        public Failure failure() {
            return failures.isEmpty() ? null : failures.getFirst().code();
        }

        public boolean failed() {
            return result == null;
        }

        public boolean fatal() {
            return status == ParseStatus.FATAL;
        }

        public boolean normalized() {
            return status == ParseStatus.VALID_WITH_NORMALIZATION;
        }

        /**
         * Returns whether deterministic normalization still produced the minimum
         * structured result needed by the Team Call #2 consumer.
         *
         * <p>Optional sections and optional references may be dropped. The summary
         * and the preferred episodes root sections are the minimum contract; a
         * response missing either cannot be made useful locally and must use the
         * bounded recovery path.</p>
         */
        public boolean usable() {
            if (result == null) {
                return false;
            }
            return failures.stream().noneMatch(TeamAiReviewResultParser::isMinimumContractFailure);
        }
    }

    private static boolean isMinimumContractFailure(final ParseFailure failure) {
        if (failure.category() == FailureCategory.CORE_SCHEMA) {
            return true;
        }
        return switch (failure.path()) {
            case "summary", "episodes", "summary.verdict", "summary.primaryDiagnosis" ->
                    failure.code() == Failure.MISSING_REQUIRED_FIELD || failure.code() == Failure.INVALID_FIELD;
            default -> false;
        };
    }

    public record ParseFailure(Failure code, String path, FailureCategory category, String constraint) {
    }

    public record Normalization(String type, String path, int count) {
        public Normalization(final String type, final String path) {
            this(type, path, 1);
        }
    }

    public enum ParseStatus {
        VALID, VALID_WITH_NORMALIZATION, FATAL
    }

    public enum FailureCategory {
        OPTIONAL_REFERENCE, SALVAGEABLE, CORE_SCHEMA
    }

    public enum Failure {
        EMPTY_OUTPUT, INVALID_JSON, OUTPUT_TOO_LARGE, MISSING_REQUIRED_FIELD,
        INVALID_FIELD, CARDINALITY_EXCEEDED, INVALID_REFERENCE
    }
}
