package com.wotb.ai.review;

import java.util.Locale;

/**
 * AI 复盘输出语言，白名单固定为 zh/en/ru（对应前端 vue-i18n 的三种 locale）。
 *
 * <p>复盘 system prompt 按语言从 Markdown 资源加载，业务事实约束不随语言变化。
 * ZH tactical harness 与非 ZH fallback 的分派由 TacticalReviewHarness 负责。</p>
 */
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

    /**
     * 严格解析白名单；未知/非法/大小写变体返回 {@code null}（由调用方决定 400 或默认值）。
     */
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
