package com.wotb.ai.review;

import com.wotb.core.replay.evidence.TeamAiReviewResult;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Parses Team Review sections whose invalid references can be dropped locally. */
final class TeamAiReviewOptionalSectionsParser {

    private static final int MAX_REASON_CHARS = 2_000;
    private static final int MAX_SUGGESTION_CHARS = 6_000;

    private TeamAiReviewOptionalSectionsParser() {
    }

    static Sections parse(final List<JsonNode> suggestionNodes, final List<JsonNode> focusNodes,
                          final List<JsonNode> contributorNodes, final Set<String> episodeIds,
                          final Set<String> roster) {
        final List<Diagnostic> failures = new ArrayList<>();
        final List<Normalization> normalizations = new ArrayList<>();
        final List<TeamAiReviewResult.TrainingSuggestion> suggestions = parseSuggestions(
                suggestionNodes, episodeIds, failures, normalizations);
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
        return new Sections(List.copyOf(suggestions), List.copyOf(focus), List.copyOf(contributors),
                List.copyOf(failures), List.copyOf(normalizations));
    }

    private static List<TeamAiReviewResult.TrainingSuggestion> parseSuggestions(
            final List<JsonNode> nodes, final Set<String> episodeIds,
            final List<Diagnostic> failures, final List<Normalization> normalizations) {
        final List<TeamAiReviewResult.TrainingSuggestion> suggestions = new ArrayList<>();
        for (int index = 0; index < nodes.size(); index++) {
            final JsonNode node = nodes.get(index);
            final String path = "trainingSuggestions[" + index + "]";
            if (node == null || !node.isObject()) {
                failures.add(failure(FailureCode.INVALID_FIELD, path, "suggestion object required"));
                normalizations.add(new Normalization("training_suggestion_dropped", path));
                continue;
            }
            if (!TeamAiReviewParserSupport.hasOnlyFields(node, Set.of("title", "content", "episodeId"))) {
                dropOptional(FailureCode.INVALID_FIELD, path, "unsupported suggestion field", failures, normalizations);
                continue;
            }
            final String title = TeamAiReviewParserSupport.requiredText(
                    node, "title", TeamAiReviewParserSupport.MAX_TITLE_CHARS);
            final String content = TeamAiReviewParserSupport.requiredText(node, "content", MAX_SUGGESTION_CHARS);
            if (title == null || content == null) {
                failures.add(failure(FailureCode.INVALID_FIELD, path, "title and content must be non-empty strings"));
                normalizations.add(new Normalization("training_suggestion_dropped", path));
                continue;
            }
            final JsonNode episodeIdNode = node.get("episodeId");
            if (episodeIdNode == null || episodeIdNode.isNull()) {
                if (episodeIdNode == null) {
                    failures.add(new Diagnostic(FailureCode.MISSING_REQUIRED_FIELD, path + ".episodeId",
                            "nullable episodeId field required"));
                    normalizations.add(new Normalization("training_suggestion_episode_cleared", path));
                }
                suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, null));
                continue;
            }
            final String episodeId = TeamAiReviewParserSupport.optionalText(
                    node, "episodeId", TeamAiReviewParserSupport.MAX_ID_CHARS);
            if (episodeId == null || !episodeIdNode.isTextual()) {
                failures.add(failure(FailureCode.INVALID_FIELD, path + ".episodeId",
                        "episodeId must be a string or null"));
                normalizations.add(new Normalization("training_suggestion_episode_cleared", path));
                suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, null));
            } else if (!episodeIds.contains(episodeId)) {
                failures.add(failure(FailureCode.INVALID_REFERENCE, path + ".episodeId",
                        "must reference an existing episode id or null"));
                normalizations.add(new Normalization("training_suggestion_episode_cleared", path));
                suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, null));
            } else {
                suggestions.add(new TeamAiReviewResult.TrainingSuggestion(title, content, episodeId));
            }
        }
        return List.copyOf(suggestions);
    }

    private static TeamAiReviewResult.ReviewFocus parseFocus(
            final JsonNode node, final int index, final Set<String> episodeIds,
            final Set<String> roster, final List<Diagnostic> failures,
            final List<Normalization> normalizations) {
        final String path = "reviewFocus[" + index + "]";
        if (node == null || !node.isObject()) {
            dropOptional(FailureCode.INVALID_FIELD, path, "focus object required", failures, normalizations);
            return null;
        }
        if (!TeamAiReviewParserSupport.hasOnlyFields(node, Set.of("playerKey", "episodeId", "reason"))) {
            dropOptional(FailureCode.INVALID_FIELD, path, "unsupported focus field", failures, normalizations);
            return null;
        }
        final String playerKey = TeamAiReviewParserSupport.requiredText(
                node, "playerKey", TeamAiReviewParserSupport.MAX_ID_CHARS);
        final String episodeId = TeamAiReviewParserSupport.requiredText(
                node, "episodeId", TeamAiReviewParserSupport.MAX_ID_CHARS);
        final String reason = TeamAiReviewParserSupport.requiredText(node, "reason", MAX_REASON_CHARS);
        if (playerKey == null || episodeId == null || reason == null) {
            dropOptional(FailureCode.INVALID_FIELD, path, "focus fields are invalid", failures, normalizations);
            return null;
        }
        if (!roster.contains(playerKey)) {
            addDropFailure(FailureCode.INVALID_REFERENCE, path + ".playerKey",
                    "must reference an authoritative roster playerKey", failures, normalizations, path);
            return null;
        }
        if (!episodeIds.contains(episodeId)) {
            addDropFailure(FailureCode.INVALID_REFERENCE, path + ".episodeId",
                    "must reference an existing episode id", failures, normalizations, path);
            return null;
        }
        return new TeamAiReviewResult.ReviewFocus(playerKey, episodeId, reason);
    }

    private static TeamAiReviewResult.HighContributor parseContributor(
            final JsonNode node, final int index, final Set<String> episodeIds,
            final Set<String> roster, final List<Diagnostic> failures,
            final List<Normalization> normalizations) {
        final String path = "highContributors[" + index + "]";
        if (node == null || !node.isObject()) {
            dropOptional(FailureCode.INVALID_FIELD, path, "contributor object required", failures, normalizations);
            return null;
        }
        if (!TeamAiReviewParserSupport.hasOnlyFields(node, Set.of("playerKey", "episodeId", "reason"))) {
            dropOptional(FailureCode.INVALID_FIELD, path, "unsupported contributor field", failures, normalizations);
            return null;
        }
        final String playerKey = TeamAiReviewParserSupport.requiredText(
                node, "playerKey", TeamAiReviewParserSupport.MAX_ID_CHARS);
        final String episodeId = TeamAiReviewParserSupport.requiredText(
                node, "episodeId", TeamAiReviewParserSupport.MAX_ID_CHARS);
        final String reason = TeamAiReviewParserSupport.requiredText(node, "reason", MAX_REASON_CHARS);
        if (playerKey == null || episodeId == null || reason == null) {
            dropOptional(FailureCode.INVALID_FIELD, path, "contributor fields are invalid", failures, normalizations);
            return null;
        }
        if (!roster.contains(playerKey)) {
            addDropFailure(FailureCode.INVALID_REFERENCE, path + ".playerKey",
                    "must reference an authoritative roster playerKey", failures, normalizations, path);
            return null;
        }
        if (!episodeIds.contains(episodeId)) {
            addDropFailure(FailureCode.INVALID_REFERENCE, path + ".episodeId",
                    "must reference an existing episode id", failures, normalizations, path);
            return null;
        }
        return new TeamAiReviewResult.HighContributor(playerKey, episodeId, reason);
    }

    private static void dropOptional(final FailureCode code, final String path, final String constraint,
                                     final List<Diagnostic> failures,
                                     final List<Normalization> normalizations) {
        addDropFailure(code, path, constraint, failures, normalizations, path);
    }

    private static void addDropFailure(final FailureCode code, final String path, final String constraint,
                                       final List<Diagnostic> failures,
                                       final List<Normalization> normalizations,
                                       final String normalizationPath) {
        failures.add(failure(code, path, constraint));
        final String type = path.startsWith("reviewFocus") ? "review_focus_item_dropped"
                : path.startsWith("highContributors") ? "high_contributor_item_dropped"
                : "optional_item_dropped";
        normalizations.add(new Normalization(type, normalizationPath));
    }

    private static Diagnostic failure(final FailureCode code, final String path, final String constraint) {
        return new Diagnostic(code, path, constraint);
    }

    record Sections(List<TeamAiReviewResult.TrainingSuggestion> suggestions,
                    List<TeamAiReviewResult.ReviewFocus> focus,
                    List<TeamAiReviewResult.HighContributor> contributors,
                    List<Diagnostic> failures, List<Normalization> normalizations) {
    }

    record Diagnostic(FailureCode code, String path, String constraint) {
    }

    enum FailureCode {
        MISSING_REQUIRED_FIELD, INVALID_FIELD, INVALID_REFERENCE
    }

    record Normalization(String type, String path, int count) {
        Normalization(final String type, final String path) {
            this(type, path, 1);
        }
    }
}
