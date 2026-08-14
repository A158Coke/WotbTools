package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 验证 ZH/EN/RU 新 CAPTURE_RULE 均完成替换，EN/RU 不残留中文规则（包内生产入口）。 */
class TeamPromptLocalizerTest {

    @Test
    void localizedCaptureRulesReplaceChineseSection() {
        final String zh = AiPromptLibrary.zh("team/single");
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(zh, AllowedLanguage.EN);
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(zh, AllowedLanguage.RU);
        assertTrue(en.contains("SUPREMACY CAPTURE RULES"),
                "EN must carry the localized capture rules");
        assertTrue(en.contains("BATTLE_RESULTS") && en.contains("knownPointsSubtotal"),
                "EN must carry the resultSource evidence levels and the partial-score wording");
        assertFalse(en.contains("POINTS_INFERENCE"),
                "EN must not carry the retired points-inference rule");
        assertFalse(en.contains("争霸赛占点规则"), "EN must not retain the Chinese capture rule");
        assertFalse(en.contains("被敌方全歼"), "EN must not retain Chinese rule wording");
        assertTrue(ru.contains("ПРАВИЛА ЗАХВАТА"),
                "RU must carry the localized capture rules");
        assertTrue(ru.contains("BATTLE_RESULTS") && ru.contains("knownPointsSubtotal"),
                "RU must carry the resultSource evidence levels and the partial-score wording");
        assertFalse(ru.contains("POINTS_INFERENCE"),
                "RU must not carry the retired points-inference rule");
        assertFalse(ru.contains("争霸赛占点规则"), "RU must not retain the Chinese capture rule");
        assertFalse(ru.contains("被敌方全歼"), "RU must not retain Chinese rule wording");
        assertTrue(zh.contains("resultSource"),
                "ZH capture rule must reference resultSource");
        assertTrue(zh.contains("被敌方全歼落败"),
                "ZH capture rule must carry bidirectional annihilation wording");
    }
}
