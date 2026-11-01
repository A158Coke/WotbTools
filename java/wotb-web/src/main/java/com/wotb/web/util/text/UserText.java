package com.wotb.web.util.text;

public final class UserText {
    private UserText() { }

    public static boolean isStorable(final String value, final int maxCodePoints) {
        // PostgreSQL text cannot store NUL; unpaired surrogates cannot round-trip as UTF-8.
        return value.codePointCount(0, value.length()) <= maxCodePoints
                && value.codePoints().noneMatch(ch -> ch == 0 || (ch >= 0xd800 && ch <= 0xdfff));
    }

    public static boolean hasText(final String value) {
        return value != null && value.codePoints().anyMatch(ch -> !isWhitespace(ch));
    }

    // ECMAScript String.trim whitespace, shared with the browser form.
    private static boolean isWhitespace(final int ch) {
        return (ch >= 0x09 && ch <= 0x0d) || ch == 0x20 || ch == 0xa0 || ch == 0x1680
                || (ch >= 0x2000 && ch <= 0x200a) || ch == 0x2028 || ch == 0x2029
                || ch == 0x202f || ch == 0x205f || ch == 0x3000 || ch == 0xfeff;
    }
}
