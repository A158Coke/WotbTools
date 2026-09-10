package com.wotb.web.replay.ai.gateway;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Centralized secret redaction. Not a single regex: covers header-like
 * Authorization, JSON/key-value api-key/api_key/apiKey/apikey, sensitive keys
 * such as token/secret/password, query parameters and Bearer tokens. All
 * patterns are case-insensitive and safe for arbitrary text (including nested
 * JSON and exception messages).
 */
public final class AiSecretRedactor {

    private static final String REDACTED = "***";

    private static final List<Pattern> PATTERNS = List.of(
            // Authorization header / Bearer token (header-like and JSON value forms)
            Pattern.compile("(?i)(authorization\\s*[:=]\\s*[\"']?\\s*Bearer\\s+)[A-Za-z0-9._~+/=-]+"),
            Pattern.compile("(?i)(Bearer\\s+)[A-Za-z0-9._~+/=-]+"),
            // api-key / api_key / apikey / apiKey
            Pattern.compile("(?i)(\"?api[_-]?key\"?\\s*[:=]\\s*[\"']?)[A-Za-z0-9._~+/=-]+"),
            // generic sensitive keys
            Pattern.compile("(?i)(\"?(?:access[-_]?token|refresh[-_]?token|client[-_]?secret|secret|password|passwd|token)\"?\\s*[:=]\\s*[\"']?)[A-Za-z0-9._~+/=-]+"),
            // query parameters
            Pattern.compile("(?i)([?&](?:api[_-]?key|apikey|key|access[-_]?token|refresh[-_]?token|client[-_]?secret|secret|password|token)=)[^&#\\s]+"));

    private AiSecretRedactor() {
    }

    public static String redact(final String text) {
        if (text == null || text.isBlank()) {
            return text;
        }
        String redacted = text;
        for (final Pattern pattern : PATTERNS) {
            redacted = pattern.matcher(redacted).replaceAll("$1" + REDACTED);
        }
        return redacted;
    }
}
