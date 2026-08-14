package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 点数局势与攻防姿态规则契约：player 三 prompt 逐字携带 ZH 规则，EN/RU 替换后不残留中文。 */
class PlayerPointsSituationRuleTest {

    @Test
    void zhPromptsCarryTheRuleVerbatim() {
        final String single = AiPromptLibrary.zh("player/single");
        final String fallback = AiPromptLibrary.zh("player/fallback");
        final String tactical = AiPromptLibrary.zh("player/tactical");
        for (final String prompt : new String[]{single, fallback, tactical}) {
            assertTrue(prompt.contains("=== 点数局势与攻防姿态（强制，随机战个人复盘） ==="), prompt);
            assertTrue(prompt.contains("过路费：对方进攻推进窗口（PUSH_WINDOWS）内，你方对推进方造成的伤害就是过路费"), prompt);
            assertTrue(prompt.contains("禁止编造任何中间比分"), prompt);
        }
    }

    @Test
    void localizedSingleAndFallbackReplaceTheChineseRule() {
        final String single = AiPromptLibrary.zh("player/single");
        final String fallback = AiPromptLibrary.zh("player/fallback");
        final String en = PlayerPromptRules.localizePlayerSystemPrompt(single, AllowedLanguage.EN);
        final String ru = PlayerPromptRules.localizePlayerSystemPrompt(single, AllowedLanguage.RU);
        final String enFallback = PlayerPromptRules.localizePlayerSystemPrompt(fallback, AllowedLanguage.EN);
        final String ruFallback = PlayerPromptRules.localizePlayerSystemPrompt(fallback, AllowedLanguage.RU);
        assertTrue(en.contains("=== POINTS SITUATION AND ATTACK/DEFENSE POSTURE (mandatory, random-battle personal review) ==="));
        assertTrue(ru.contains("=== СИТУАЦИЯ ПО ОЧКАМ И СТОЙКА АТАКИ/ОБОРОНЫ (обязательно, личный разбор случайного боя) ==="));
        assertFalse(en.contains("点数局势与攻防姿态"), "EN must not retain the Chinese rule");
        assertFalse(ru.contains("点数局势与攻防姿态"), "RU must not retain the Chinese rule");
        assertTrue(enFallback.contains("POINTS SITUATION AND ATTACK/DEFENSE POSTURE"));
        assertTrue(ruFallback.contains("СИТУАЦИЯ ПО ОЧКАМ"));
        assertFalse(enFallback.contains("点数局势与攻防姿态"));
        assertFalse(ruFallback.contains("点数局势与攻防姿态"));
    }
}
