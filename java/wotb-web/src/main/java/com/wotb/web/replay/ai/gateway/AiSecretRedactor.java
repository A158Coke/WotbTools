package com.wotb.web.replay.ai.gateway;

import java.util.List;
import java.util.regex.Pattern;

/**
 * é›†ä¸­çš„ secret æ¶ˆæ¯’å™¨ã€‚
 * <p>ä¸åªä¾èµ–ä¸€æ¡æ­£åˆ™ï¼›è¦†ç›– header-like Authorizationã€JSON/å€¼å¯¹å½¢å¼çš„
 * api-key/api_key/apiKey/apikeyã€token/secret/password ç­‰å¯†é’¥å­—æ®µã€query parameter
 * ä»¥åŠ Bearer tokenã€‚æ‰€æœ‰é…åˆ™ä¸åŒºåˆ†å¤§å°å†™ï¼Œå¯¹ä»»ä½•å­—ç¬¦ä¸²ï¼ˆåŒ…æ‹¬åµŒå¥— JSON
 * ä¸Žå¼‚å¸¸æ¶ˆæ¯ï¼‰éƒ½å®‰å…¨ã€‚</p>
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
