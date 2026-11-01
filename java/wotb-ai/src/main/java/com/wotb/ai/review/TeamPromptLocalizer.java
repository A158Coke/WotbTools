package com.wotb.ai.review;

import com.wotb.ai.prompt.AiPromptLibrary;

/** 提示词资源入口；规则正文由三语 Markdown 资源维护。 */
final class TeamPromptLocalizer {

    private TeamPromptLocalizer() {
    }

    static final String COACH_STANDARD_RULE = AiPromptLibrary.text("tactical-skills/coach-standard", "zh");
    static final String COACH_STANDARD_RULE_EN = AiPromptLibrary.text("tactical-skills/coach-standard", "en");
    static final String COACH_STANDARD_RULE_RU = AiPromptLibrary.text("tactical-skills/coach-standard", "ru");
    static final String SINGLE_TEAM_PROMPT = AiPromptLibrary.text("team/single", "zh");

    static String systemPrompt(final AllowedLanguage language) {
        return AiPromptLibrary.text("team/single", language == null ? "zh" : language.code());
    }
}
