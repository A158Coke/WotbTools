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
        assertTrue(en.contains("BATTLE_RESULTS") && en.contains("business rules"),
                "EN must carry the resultSource evidence levels and the business-rule wording");
        assertFalse(en.contains("POINTS_INFERENCE"),
                "EN must not carry the retired points-inference rule");
        assertFalse(en.contains("knownPointsSubtotal"),
                "EN must not carry the retracted subtotal formula");
        assertFalse(en.contains("争霸赛占点规则"), "EN must not retain the Chinese capture rule");
        assertFalse(en.contains("被敌方全歼"), "EN must not retain Chinese rule wording");
        assertTrue(ru.contains("ПРАВИЛА ЗАХВАТА"),
                "RU must carry the localized capture rules");
        assertTrue(ru.contains("BATTLE_RESULTS") && ru.contains("бизнес-правила"),
                "RU must carry the resultSource evidence levels and the business-rule wording");
        assertFalse(ru.contains("POINTS_INFERENCE"),
                "RU must not carry the retired points-inference rule");
        assertFalse(ru.contains("knownPointsSubtotal"),
                "RU must not carry the retracted subtotal formula");
        assertFalse(ru.contains("争霸赛占点规则"), "RU must not retain the Chinese capture rule");
        assertFalse(ru.contains("被敌方全歼"), "RU must not retain Chinese rule wording");
        assertTrue(zh.contains("resultSource"),
                "ZH capture rule must reference resultSource");
        assertTrue(zh.contains("被敌方全歼落败"),
                "ZH capture rule must carry bidirectional annihilation wording");
        // 未证实的 tick 产分/超分/回放压缩不得进入三语 prompt
        assertFalse(zh.contains("略超"), "ZH must not claim overshoot");
        assertFalse(zh.contains("压缩为1000"), "ZH must not claim replay clamping");
        assertFalse(zh.contains("+3 或 +5"), "ZH must not claim an unverified per-tick value");
        assertFalse(zh.contains("15/tick"), "ZH must not claim unverified 15/tick");
        assertFalse(en.contains("+3 or +5"), "EN must not claim an unverified per-tick value");
        assertFalse(en.contains("15 per tick"), "EN must not claim unverified 15/tick");
        assertFalse(en.contains("clamped to 1000"), "EN must not claim replay clamping");
        assertFalse(en.contains("slightly exceed"), "EN must not claim overshoot");
        assertFalse(ru.contains("+3 или +5"), "RU must not claim an unverified per-tick value");
        assertFalse(ru.contains("15 за тик"), "RU must not claim unverified 15/tick");
        assertFalse(ru.contains("сжат до 1000"), "RU must not claim replay clamping");
        // 胜方未知时三语都保留已证明的结束原因（达到 1000 分提前结束），而不是降级为「点数判定」
        assertTrue(zh.contains("某一方达到 1000 分导致提前结束，具体胜方未知"),
                "ZH must keep the proven end reason with unknown winner");
        assertTrue(en.contains("a team reached 1000 points, ending the battle early; the winning team is unknown"),
                "EN must keep the proven end reason with unknown winner");
        assertTrue(ru.contains("одна из команд достигла 1000 очков, бой завершён досрочно; победитель неизвестен"),
                "RU must keep the proven end reason with unknown winner");
        // 点数局势与攻防姿态（规则 8）：三语必须携带，EN/RU 不得残留中文
        assertTrue(zh.contains("点数局势与攻防姿态（只基于可证明信号）"),
                "ZH must carry the points-situation rule");
        assertTrue(zh.contains("过路费：对方进攻推进窗口（PUSH_WINDOWS）"),
                "ZH must carry the toll rule");
        assertTrue(en.contains("Points situation and attack/defense posture"),
                "EN must carry the points-situation rule");
        assertTrue(en.contains("Toll: inside the opposing team's push window (PUSH_WINDOWS)"),
                "EN must carry the toll rule");
        assertTrue(ru.contains("Ситуация по очкам и стойка атаки/обороны"),
                "RU must carry the points-situation rule");
        assertTrue(ru.contains("Плата за проезд: в окне продвижения противника (PUSH_WINDOWS)"),
                "RU must carry the toll rule");
        assertFalse(en.contains("点数局势与攻防姿态"), "EN must not retain the Chinese rule");
        assertFalse(ru.contains("点数局势与攻防姿态"), "RU must not retain the Chinese rule");
    }
}
