package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamAiReviewResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Technical parser for Team AI Review v0.5.
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
    /** HTTP/OpenAPI bound for the plain-text presentation field. */
    private static final int MAX_PLAIN_TEXT_CHARS = 64_000;
    private static final int MAX_ID_CHARS = 64;
    private static final int MAX_TITLE_CHARS = 240;
    private static final int MAX_REASON_CHARS = 2_000;
    private static final int MAX_SUMMARY_CHARS = 4_000;
    private static final int MAX_ANALYSIS_CHARS = 8_000;
    private static final int MAX_SUGGESTION_CHARS = 6_000;
    private static final int MAX_PLAYER_KEYS_PER_EPISODE = 8;

    private static final Pattern TEAM_REVIEW_JSON_FIELD = Pattern.compile(
            "\\\"(?:summary|episodes|trainingSuggestions|reviewFocus|highContributors|"
                    + "verdict|primaryDiagnosis|title|analysis|playerKeys|content|playerKey|"
                    + "episodeId|reason)\\\"\\s*:");

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
            final JsonNode root = MAPPER.readTree(extractJson(output));
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
                final String id = optionalText(node, "id", MAX_ID_CHARS);
                final String title = optionalText(node, "title", MAX_TITLE_CHARS);
                final String analysis = optionalText(node, "analysis", MAX_ANALYSIS_CHARS);
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

            final List<TeamAiReviewResult.TrainingSuggestion> suggestions = new ArrayList<>();
            for (int index = 0; index < suggestionNodes.size(); index++) {
                final JsonNode node = suggestionNodes.get(index);
                final String path = "trainingSuggestions[" + index + "]";
                if (node == null || !node.isObject()) {
                    failures.add(failure(Failure.INVALID_FIELD, path,
                            FailureCategory.OPTIONAL_REFERENCE, "suggestion object required"));
                    normalizations.add(new Normalization("training_suggestion_dropped", path));
                    continue;
                }
                if (!hasOnlyFields(node, Set.of("title", "content", "episodeId"))) {
                    dropOptional(Failure.INVALID_FIELD, path, "unsupported suggestion field",
                            failures, normalizations);
                    continue;
                }
                final String title = requiredText(node, "title", MAX_TITLE_CHARS);
                final String content = requiredText(node, "content", MAX_SUGGESTION_CHARS);
                if (title == null || content == null) {
                    failures.add(failure(Failure.INVALID_FIELD, path,
                            FailureCategory.OPTIONAL_REFERENCE,
                            "title and content must be non-empty strings"));
                    normalizations.add(new Normalization("training_suggestion_dropped", path));
                    continue;
                }
                final JsonNode episodeIdNode = node.get("episodeId");
                if (episodeIdNode == null || episodeIdNode.isNull()) {
                    if (episodeIdNode == null) {
                        failures.add(failure(Failure.MISSING_REQUIRED_FIELD, path + ".episodeId",
                                FailureCategory.OPTIONAL_REFERENCE, "nullable episodeId field required"));
                        normalizations.add(new Normalization("training_suggestion_episode_cleared", path));
                    }
                    suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, null));
                    continue;
                }
                final String episodeId = optionalText(node, "episodeId", MAX_ID_CHARS);
                if (episodeId == null || !episodeIdNode.isTextual()) {
                    failures.add(failure(Failure.INVALID_FIELD, path + ".episodeId",
                            FailureCategory.OPTIONAL_REFERENCE, "episodeId must be a string or null"));
                    normalizations.add(new Normalization("training_suggestion_episode_cleared", path));
                    suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, null));
                } else if (!episodeIds.contains(episodeId)) {
                    failures.add(failure(Failure.INVALID_REFERENCE, path + ".episodeId",
                            FailureCategory.OPTIONAL_REFERENCE,
                            "must reference an existing episode id or null"));
                    normalizations.add(new Normalization("training_suggestion_episode_cleared", path));
                    suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, null));
                } else {
                    suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, episodeId));
                }
            }

            final List<TeamAiReviewResult.ReviewFocus> focus = new ArrayList<>();
            for (int index = 0; index < focusNodes.size(); index++) {
                final TeamAiReviewResult.ReviewFocus item = parseFocus(
                        focusNodes.get(index), index, episodeIds, roster, failures, normalizations);
                if (item != null) {
                    focus.add(item);
                }
            }
            final List<TeamAiReviewResult.HighContributor> contributors = new ArrayList<>();
            for (int index = 0; index < contributorNodes.size(); index++) {
                final TeamAiReviewResult.HighContributor item = parseContributor(
                        contributorNodes.get(index), index, episodeIds, roster, failures, normalizations);
                if (item != null) {
                    contributors.add(item);
                }
            }
            final TeamAiReviewResult result = new TeamAiReviewResult(
                    new TeamAiReviewResult.Summary(verdict, diagnosis),
                    List.copyOf(episodes), List.copyOf(suggestions), List.copyOf(focus),
                    List.copyOf(contributors));
            if (!hasDisplayContent(result)) {
                return fatal(Failure.NO_USABLE_CONTENT, "root",
                        "structured result contains no usable display content");
            }
            return normalizations.isEmpty()
                    ? valid(result)
                    : normalized(result, failures, normalizations);
        } catch (final RuntimeException e) {
            return fatal(Failure.INVALID_JSON, "root", "JSON could not be parsed");
        }
    }

    private static TeamAiReviewResult.ReviewFocus parseFocus(
            final JsonNode node, final int index, final Set<String> episodeIds,
            final Set<String> roster, final List<ParseFailure> failures,
            final List<Normalization> normalizations) {
        final String path = "reviewFocus[" + index + "]";
        if (node == null || !node.isObject()) {
            dropOptional(Failure.INVALID_FIELD, path, "focus object required", failures, normalizations);
            return null;
        }
        if (!hasOnlyFields(node, Set.of("playerKey", "episodeId", "reason"))) {
            dropOptional(Failure.INVALID_FIELD, path, "unsupported focus field", failures, normalizations);
            return null;
        }
        final String playerKey = requiredText(node, "playerKey", MAX_ID_CHARS);
        final String episodeId = requiredText(node, "episodeId", MAX_ID_CHARS);
        final String reason = requiredText(node, "reason", MAX_REASON_CHARS);
        if (playerKey == null || episodeId == null || reason == null) {
            dropOptional(Failure.INVALID_FIELD, path, "focus fields are invalid", failures, normalizations);
            return null;
        }
        if (!roster.contains(playerKey)) {
            addDropFailure(Failure.INVALID_REFERENCE, path + ".playerKey",
                    "must reference an authoritative roster playerKey", failures, normalizations, path);
            return null;
        }
        if (!episodeIds.contains(episodeId)) {
            addDropFailure(Failure.INVALID_REFERENCE, path + ".episodeId",
                    "must reference an existing episode id", failures, normalizations, path);
            return null;
        }
        return new TeamAiReviewResult.ReviewFocus(playerKey, episodeId, reason);
    }

    private static TeamAiReviewResult.HighContributor parseContributor(
            final JsonNode node, final int index, final Set<String> episodeIds,
            final Set<String> roster, final List<ParseFailure> failures,
            final List<Normalization> normalizations) {
        final String path = "highContributors[" + index + "]";
        if (node == null || !node.isObject()) {
            dropOptional(Failure.INVALID_FIELD, path, "contributor object required", failures, normalizations);
            return null;
        }
        if (!hasOnlyFields(node, Set.of("playerKey", "episodeId", "reason"))) {
            dropOptional(Failure.INVALID_FIELD, path, "unsupported contributor field",
                    failures, normalizations);
            return null;
        }
        final String playerKey = requiredText(node, "playerKey", MAX_ID_CHARS);
        final String episodeId = requiredText(node, "episodeId", MAX_ID_CHARS);
        final String reason = requiredText(node, "reason", MAX_REASON_CHARS);
        if (playerKey == null || episodeId == null || reason == null) {
            dropOptional(Failure.INVALID_FIELD, path, "contributor fields are invalid", failures, normalizations);
            return null;
        }
        if (!roster.contains(playerKey)) {
            addDropFailure(Failure.INVALID_REFERENCE, path + ".playerKey",
                    "must reference an authoritative roster playerKey", failures, normalizations, path);
            return null;
        }
        if (!episodeIds.contains(episodeId)) {
            addDropFailure(Failure.INVALID_REFERENCE, path + ".episodeId",
                    "must reference an existing episode id", failures, normalizations, path);
            return null;
        }
        return new TeamAiReviewResult.HighContributor(playerKey, episodeId, reason);
    }

    private static void dropOptional(final Failure code, final String path, final String constraint,
                                     final List<ParseFailure> failures,
                                     final List<Normalization> normalizations) {
        addDropFailure(code, path, constraint, failures, normalizations, path);
    }

    private static void addDropFailure(final Failure code, final String path, final String constraint,
                                       final List<ParseFailure> failures,
                                       final List<Normalization> normalizations,
                                       final String normalizationPath) {
        failures.add(failure(code, path, FailureCategory.OPTIONAL_REFERENCE, constraint));
        final String type = path.startsWith("reviewFocus") ? "review_focus_item_dropped"
                : path.startsWith("highContributors") ? "high_contributor_item_dropped"
                : "optional_item_dropped";
        normalizations.add(new Normalization(type, normalizationPath));
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

    private static boolean hasOnlyFields(final JsonNode node, final Set<String> allowed) {
        for (final var entry : node.properties()) {
            if (!allowed.contains(entry.getKey())) return false;
        }
        return true;
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
                    || item.asText().length() > MAX_ID_CHARS) {
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
        final String value = optionalText(parent, name, max);
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

    private static boolean validNullableNonNegativeInteger(final JsonNode parent, final String name) {
        final JsonNode value = parent.get(name);
        return value != null && (value.isNull()
                || (value.isIntegralNumber()
                && value.asLong() >= 0 && value.asLong() <= Integer.MAX_VALUE));
    }

    private static boolean validSeconds(final Integer start, final Integer end) {
        return start == null || end == null || end >= start;
    }

    /** Structured output is usable when at least one retained user-facing text survives salvage. */
    public static boolean hasDisplayContent(final TeamAiReviewResult result) {
        if (result == null) {
            return false;
        }
        if (isNonBlank(result.summary() == null ? null : result.summary().verdict())
                || isNonBlank(result.summary() == null ? null : result.summary().primaryDiagnosis())) {
            return true;
        }
        return result.episodes().stream().anyMatch(item ->
                        isNonBlank(item.title()) || isNonBlank(item.analysis()))
                || result.trainingSuggestions().stream().anyMatch(item ->
                        isNonBlank(item.title()) || isNonBlank(item.content()))
                || result.reviewFocus().stream().anyMatch(item -> isNonBlank(item.reason()))
                || result.highContributors().stream().anyMatch(item -> isNonBlank(item.reason()));
    }

    /** Conservative display-only check; it never judges tactical correctness or factual accuracy. */
    public static boolean isUsableDisplayText(final String output) {
        if (output == null) {
            return false;
        }
        final String trimmed = output.trim();
        if (trimmed.length() < 20 || trimmed.length() > MAX_PROVIDER_OUTPUT_CHARS) {
            return false;
        }
        final String withoutFence = trimmed.replace("```markdown", "")
                .replace("```md", "").replace("```json", "")
                .replace("```JSON", "").replace("```", "").trim();
        if (withoutFence.isBlank()) {
            return false;
        }
        if (looksLikeJsonContractFragment(withoutFence)) {
            return false;
        }
        final long readableCharacters = withoutFence.codePoints()
                .filter(character -> Character.isLetterOrDigit(character))
                .count();
        return readableCharacters >= 8;
    }

    /**
     * Keeps a displayable completion within the HTTP contract without rewriting its content.
     * Callers must first verify {@link #isUsableDisplayText(String)}.
     */
    static String boundedDisplayText(final String output) {
        final String trimmed = output.trim();
        if (trimmed.length() <= MAX_PLAIN_TEXT_CHARS) {
            return trimmed;
        }
        int end = MAX_PLAIN_TEXT_CHARS;
        if (end < trimmed.length()
                && Character.isHighSurrogate(trimmed.charAt(end - 1))
                && Character.isLowSurrogate(trimmed.charAt(end))) {
            end--;
        }
        return trimmed.substring(0, end);
    }

    private static boolean looksLikeJsonContractFragment(final String output) {
        if (output.startsWith("{") || startsLikeJsonArray(output)) {
            return true;
        }
        return TEAM_REVIEW_JSON_FIELD.matcher(output).find();
    }

    private static boolean startsLikeJsonArray(final String output) {
        if (!output.startsWith("[")) {
            return false;
        }
        if (output.length() == 1) {
            return true;
        }
        final char next = output.charAt(1);
        return next == '{' || next == '[' || next == '"' || next == ']'
                || Character.isDigit(next) || next == '-';
    }

    private static boolean isNonBlank(final String value) {
        return value != null && !value.isBlank();
    }

    private static String extractJson(final String output) {
        final String trimmed = output.trim();
        final int start = trimmed.indexOf('{');
        final int end = trimmed.lastIndexOf('}');
        return start >= 0 && end > start ? trimmed.substring(start, end + 1) : trimmed;
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
        INVALID_FIELD, CARDINALITY_EXCEEDED, INVALID_REFERENCE, NO_USABLE_CONTENT
    }
}
