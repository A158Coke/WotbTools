package com.wotb.web.replay.ai;

import java.util.Locale;

/**
 * AI 复盘输出语言，白名单固定为 zh/en/ru（对应前端 vue-i18n 的三种 locale）。
 *
 * <p>语言只影响 system prompt 末尾追加的「输出语言 + 时间格式」指令；Prompt 规则文案
 * 保持中文，由模型按指令输出对应语言。zh 为默认且指令为空（保持现有 prompt 字节不变）。</p>
 */
public enum OutputLanguage {
    ZH("zh", ""),
    EN("en", """

            请使用英文输出复盘内容。战斗时间请使用 Xm Xs 格式（例如 75 秒写作 1min 15s、180 秒写作 3min 0s）。
            """),
    RU("ru", """

            请使用俄语输出复盘内容。战斗时间请使用 X мин X с 格式（例如 75 秒写作 1 мин 15 с、180 秒写作 3 мин 0 с）。
            """);

    private final String code;
    private final String directive;

    OutputLanguage(final String code, final String directive) {
        this.code = code;
        this.directive = directive;
    }

    public String code() {
        return code;
    }

    /**
     * 追加到 system prompt 末尾的语言指令；{@link #ZH} 为空。
     */
    public String directive() {
        return directive;
    }

    /**
     * 严格解析白名单；未知/非法/大小写变体返回 {@code null}（由调用方决定 400 或默认值）。
     */
    public static OutputLanguage fromCode(final String code) {
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
