package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Prompt md ↔ Java 常量逐字一致契约（P2-B4）。
 *
 * <p>EN/RU 本地化依赖 {@code .replace(ZH_常量, EN/RU)} 锚点：md 内 ZH 规则片段必须与
 * Java 常量逐字一致（忽略首尾空白），否则替换静默失效（no-op），EN/RU 复盘会残留中文规则段。
 * 本测试同时是 P2-B1 的漂移发现工具：断言失败 = md 与常量已漂移，须先对齐再继续。</p>
 */
class PromptRuleContractTest {

    /** md key → 必须逐字携带的 ZH 规则常量（strip 后）。 */
    private static final Map<String, List<String>> MD_RULES = Map.of(
            "player/single", List.of(
                    PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE,
                    PlayerPromptRules.COMMON_CHINESE_LANGUAGE_RULE,
                    PlayerPromptRules.PLAYER_PERSON_RULE,
                    PlayerPromptRules.PLAYER_ENEMY_DAMAGE_RULE,
                    PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE,
                    PlayerPromptRules.HP_LOSS_TIME_RULE,
                    PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE,
                    PlayerPromptRules.SEPARATION_EVIDENCE_RULE,
                    PlayerPromptRules.POINTS_SITUATION_RULE,
                    PlayerPromptRules.RELATIVE_DEPTH_HP_RULE),
            "player/fallback", List.of(
                    PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE,
                    PlayerPromptRules.COMMON_CHINESE_LANGUAGE_RULE,
                    PlayerPromptRules.PLAYER_PERSON_RULE,
                    PlayerPromptRules.PLAYER_ENEMY_DAMAGE_RULE,
                    PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE,
                    PlayerPromptRules.HP_LOSS_TIME_RULE,
                    PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE,
                    PlayerPromptRules.SEPARATION_EVIDENCE_RULE,
                    PlayerPromptRules.POINTS_SITUATION_RULE),
            "player/tactical", List.of(
                    PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE,
                    PlayerPromptRules.COMMON_CHINESE_LANGUAGE_RULE,
                    PlayerPromptRules.PLAYER_PERSON_RULE,
                    PlayerPromptRules.PLAYER_ENEMY_DAMAGE_RULE,
                    PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE,
                    PlayerPromptRules.HP_LOSS_TIME_RULE,
                    PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE,
                    PlayerPromptRules.SEPARATION_EVIDENCE_RULE,
                    PlayerPromptRules.POINTS_SITUATION_RULE),
            "team/single", List.of(
                    PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE,
                    PlayerPromptRules.COMMON_CHINESE_LANGUAGE_RULE,
                    TeamPromptLocalizer.TEAM_ANALYSIS_RULE,
                    TeamPromptLocalizer.TEAM_INTERNAL_VS_USER_FACING_RULE,
                    TeamPromptLocalizer.FORMATION_DEPTH_RULE,
                    PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE,
                    PlayerPromptRules.HP_LOSS_TIME_RULE,
                    PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE,
                    TeamPromptLocalizer.INFORMATION_VISION_SKILL_RULE,
                    TeamPromptLocalizer.LOCAL_ENGAGEMENTS_SKILL_RULE,
                    TeamPromptLocalizer.TEAM_EXECUTION_SKILL_RULE,
                    TeamPromptLocalizer.POSITION_TEMPO_SKILL_RULE,
                    TeamPromptLocalizer.HP_TRADES_SKILL_RULE,
                    TeamPromptLocalizer.MODE_OBJECTIVES_SKILL_RULE,
                    TeamPromptLocalizer.TEAM_PRIOR_RULE,
                    TeamPromptLocalizer.TEAM_REGION_RULE,
                    TeamPromptLocalizer.SEPARATION_EVIDENCE_RULE,
                    TeamPromptLocalizer.TEAM_REGROUP_INFERENCE_RULE,
                    TeamPromptLocalizer.CAPTURE_RULE,
                    TeamPromptLocalizer.RELATIVE_DEPTH_HP_RULE,
                    TeamPromptLocalizer.TEAM_OUTPUT_STRUCTURE_RULE,
                    TeamPromptLocalizer.TEAM_PRIMARY_DIAGNOSIS_RULE,
                    TeamPromptLocalizer.TEAM_GROUNDING_RULE,
                    TeamPromptLocalizer.TEAM_EVIDENCE_CONTRACT_RULE));

    @Test
    void mdPromptsCarryRuleConstantsVerbatim() {
        for (final Map.Entry<String, List<String>> entry : MD_RULES.entrySet()) {
            final String prompt = AiPromptLibrary.zh(entry.getKey());
            assertFalse(prompt.contains("{{"), entry.getKey() + " 展开后不得残留 include 占位符");
            for (final String constant : entry.getValue()) {
                assertTrue(prompt.contains(constant.strip()),
                        entry.getKey() + " 必须逐字携带规则常量（否则 EN/RU 替换锚点失效）:\n"
                                + constant.strip().lines().findFirst().orElse(""));
            }
        }
    }

    @Test
    void playerLocalizeReplacesLocalizedRulesWithoutChineseResidue() {
        final String single = AiPromptLibrary.zh("player/single");
        final String fallback = AiPromptLibrary.zh("player/fallback");
        final String tactical = AiPromptLibrary.zh("player/tactical");
        for (final String zh : List.of(single, fallback, tactical)) {
            for (final AllowedLanguage lang : List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
                final String localized = PlayerPromptRules.localizePlayerSystemPrompt(zh, lang);
                assertFalse(localized.contains("=== 掉血时间范围（强制） ==="), lang + " 残留中文掉血规则");
                assertFalse(localized.contains("=== 伤害语义（强制） ==="), lang + " 残留中文伤害语义");
                assertFalse(localized.contains("=== 证据逻辑与术语（强制） ==="), lang + " 残留中文证据逻辑");
                assertFalse(localized.contains("=== 语言规则（强制） ==="), lang + " 残留中文语言规则");
            }
        }
    }

    @Test
    void teamLocalizeReplacesLocalizedRulesWithoutChineseResidue() {
        final String team = AiPromptLibrary.zh("team/single");
        for (final AllowedLanguage lang : List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(team, lang);
            assertFalse(localized.contains("=== 掉血时间范围（强制） ==="), lang + " 残留中文掉血规则");
            assertFalse(localized.contains("=== 伤害语义（强制） ==="), lang + " 残留中文伤害语义");
            assertFalse(localized.contains("=== 证据逻辑与术语（强制） ==="), lang + " 残留中文证据逻辑");
            assertFalse(localized.contains("=== 团队复盘规则（强制，仅训练房/联赛团队复盘） ==="), lang + " 残留中文团队规则");
            assertFalse(localized.contains("=== 争霸赛占点规则（强制，训练房/联赛恒为争霸赛） ==="), lang + " 残留中文占点规则");
            assertFalse(localized.contains("=== 信息与视野战术技能 v0.2 ==="), lang + " 残留中文信息技能");
            assertFalse(localized.contains("=== 局部战场与传播战术技能 v0.2 ==="), lang + " 残留中文局部技能");
        }
    }
}
