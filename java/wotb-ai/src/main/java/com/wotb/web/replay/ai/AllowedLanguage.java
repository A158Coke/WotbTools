package com.wotb.web.replay.ai;

import java.util.Locale;

/**
 * AI 复盘输出语言，白名单固定为 zh/en/ru（对应前端 vue-i18n 的三种 locale）。
 *
 * <p>输出语言只影响 Prompt 的「输出语言 + 称谓 + 时间格式」规则：ZH 使用原有中文 Prompt
 * （字节级不变），EN/RU 由 {@code PlayerReplayPromptBuilder} / {@code TeamReplayAnalysisService}
 * 在中文基座上替换输出强制句与语言/称谓规则块组装。业务事实约束（不编造、坦克专有名词
 * 保持原样、perspective/friendly-enemy、权威结算与观测子集、注入防护、数据限制）不随语言变化。</p>
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
