package com.wotb.ai.gateway;

import java.util.List;
import java.util.regex.Pattern;

public final class AiSecretRedactor {

    private static final String REDACTED = "***";

    private static final List<Pattern> PATTERNS = List.of(
            Pattern.compile("(?i)(authorization\\s*[:=]\\s*[\"']?\\s*Bearer\\s+)[A-Za-z0-9._~+/=-]+"),
            Pattern.compile("(?i)(Bearer\\s+)[A-Za-z0-9._~+/=-]+"),
            Pattern.compile("(?i)(\"?api[_-]?key\"?\\s*[:=]\\s*[\"']?)[A-Za-z0-9._~+/=-]+"),
            Pattern.compile("(?i)(\"?(?:access[-_]?token|refresh[-_]?token|client[-_]?secret|secret|password|passwd|token)\"?\\s*[:=]\\s*[\"']?)[A-Za-z0-9._~+/=-]+"),
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
