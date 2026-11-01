package com.wotb.ai.review;

import com.wotb.ai.prompt.AiPromptLibrary;

/** 提示词资源入口；规则正文由三语 Markdown 资源维护。 */
final class PlayerPromptRules {

    private PlayerPromptRules() {
    }

    static final String COMMON_TANK_PROPER_NOUN_RULE = AiPromptLibrary.text("common/tank-noun", "zh");
    static final String SOLO_STANDARD_RULE = AiPromptLibrary.text("tactical-skills/solo-standard", "zh");
    static final String SOLO_STANDARD_RULE_EN = AiPromptLibrary.text("tactical-skills/solo-standard", "en");
    static final String SOLO_STANDARD_RULE_RU = AiPromptLibrary.text("tactical-skills/solo-standard", "ru");
    static final String SYSTEM_PROMPT = AiPromptLibrary.text("player/fallback", "zh");
    static final String SINGLE_PLAYER_PROMPT = AiPromptLibrary.text("player/single", "zh");

    static String systemPrompt(final String key, final AllowedLanguage language) {
        return AiPromptLibrary.text(key, language == null ? "zh" : language.code());
    }
}
