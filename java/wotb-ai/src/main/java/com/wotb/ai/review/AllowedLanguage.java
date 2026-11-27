package com.wotb.ai.review;

import java.util.Locale;

public enum AllowedLanguage {
    ZH("zh"),
    EN("en"),
    RU("ru");

    private final String code;

    AllowedLanguage(final String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static AllowedLanguage fromCode(final String code) {
        if (code == null) {
            return null;
        }
        return switch (code.trim().toLowerCase(Locale.ROOT)) {
            case "zh" -> ZH;
            case "en" -> EN;
            case "ru" -> RU;
            default -> null;
        };
    }
}
