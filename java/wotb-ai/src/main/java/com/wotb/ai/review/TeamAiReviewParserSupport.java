package com.wotb.ai.review;

import tools.jackson.databind.JsonNode;

import java.util.Set;

/** Shared shape and text checks used by Team AI result parsing owners. */
final class TeamAiReviewParserSupport {

    static final int MAX_ID_CHARS = 64;
    static final int MAX_TITLE_CHARS = 240;

    private TeamAiReviewParserSupport() {
    }

    static boolean hasOnlyFields(final JsonNode node, final Set<String> allowed) {
        for (final var entry : node.properties()) {
            if (!allowed.contains(entry.getKey())) {
                return false;
            }
        }
        return true;
    }

    static String requiredText(final JsonNode parent, final String name, final int max) {
        final String value = optionalText(parent, name, max);
        return value == null || value.isBlank() ? null : value;
    }

    static String optionalText(final JsonNode parent, final String name, final int max) {
        final JsonNode value = parent.get(name);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual() || value.asText().length() > max) {
            return null;
        }
        return value.asText();
    }
}
