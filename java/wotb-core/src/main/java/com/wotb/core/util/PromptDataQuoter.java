package com.wotb.core.util;

import org.springframework.util.StringUtils;

import java.util.Locale;

public final class PromptDataQuoter {

    private PromptDataQuoter() {
    }

    public static String quote(final String s, final String fallback) {
        if (!StringUtils.hasText(s)) {
            return "\"" + fallback + "\"";
        }
        final StringBuilder quoted = new StringBuilder(s.length() + 2);
        quoted.append('"');
        for (int index = 0; index < s.length(); index++) {
            final char c = s.charAt(index);
            switch (c) {
                case '"' -> quoted.append("\\\"");
                case '\\' -> quoted.append("\\\\");
                case '\b' -> quoted.append("\\b");
                case '\f' -> quoted.append("\\f");
                case '\n' -> quoted.append("\\n");
                case '\r' -> quoted.append("\\r");
                case '\t' -> quoted.append("\\t");
                default -> {
                    if (c < 0x20) {
                        quoted.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        quoted.append(c);
                    }
                }
            }
        }
        quoted.append('"');
        return quoted.toString();
    }

    public static String quote(final Object value, final String fallback) {
        if (value == null) {
            return quote((String) null, fallback);
        }
        return quote(value.toString(), fallback);
    }
}
