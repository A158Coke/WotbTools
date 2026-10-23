package com.wotb.ai.review;

import com.wotb.ai.prompt.AiPromptLibrary;

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
                    PlayerPromptRules.RELATIVE_DEPTH_HP_RULE,
                    PlayerPromptRules.SOLO_STANDARD_RULE),
            "player/fallback", List.of(
                    PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE,
                    PlayerPromptRules.COMMON_CHINESE_LANGUAGE_RULE,
                    PlayerPromptRules.PLAYER_PERSON_RULE,
                    PlayerPromptRules.PLAYER_ENEMY_DAMAGE_RULE,
                    PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE,
                    PlayerPromptRules.HP_LOSS_TIME_RULE,
                    PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE,
                    PlayerPromptRules.SEPARATION_EVIDENCE_RULE,
                    PlayerPromptRules.POINTS_SITUATION_RULE,
                    PlayerPromptRules.SOLO_STANDARD_RULE),
            "player/tactical", List.of(
                    PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE,
                    PlayerPromptRules.COMMON_CHINESE_LANGUAGE_RULE,
                    PlayerPromptRules.PLAYER_PERSON_RULE,
                    PlayerPromptRules.PLAYER_ENEMY_DAMAGE_RULE,
                    PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE,
                    PlayerPromptRules.HP_LOSS_TIME_RULE,
                    PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE,
                    PlayerPromptRules.SEPARATION_EVIDENCE_RULE,
                    PlayerPromptRules.POINTS_SITUATION_RULE,
                    PlayerPromptRules.SOLO_STANDARD_RULE),
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
                    TeamPromptLocalizer.COACH_STANDARD_RULE,
                    TeamPromptLocalizer.TEAM_PRIOR_RULE,
                    TeamPromptLocalizer.TEAM_REGION_RULE,
                    TeamPromptLocalizer.SEPARATION_EVIDENCE_RULE,
                    TeamPromptLocalizer.TEAM_REGROUP_INFERENCE_RULE,
                    TeamPromptLocalizer.CAPTURE_RULE,
                    TeamPromptLocalizer.RELATIVE_DEPTH_HP_RULE,
                    TeamPromptLocalizer.TEAM_OUTPUT_STRUCTURE_RULE,
                    TeamPromptLocalizer.TEAM_PRIMARY_DIAGNOSIS_RULE,
                    TeamPromptLocalizer.TEAM_EVIDENCE_CONTRACT_RULE,
                    TeamPromptLocalizer.TEAM_REASONING_CONTRACT_RULE));

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
                assertFalse(localized.contains("=== 随机战个人复盘规范 v1.1（Coach Lab） ==="), lang + " 残留中文个人复盘规范");
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
            assertFalse(localized.contains("=== 争霸赛复盘规范 v1.1（Coach Lab） ==="), lang + " 残留中文复盘规范");
            assertFalse(localized.contains("=== 团队推理顺序与质量约束（强制） ==="),
                    lang + " 残留中文 reasoning contract");
        }
        assertTrue(TeamPromptLocalizer.localizeTeamSystemPrompt(team, AllowedLanguage.EN)
                        .contains("TEAM REVIEW V0.6 REASONING ORDER AND CAUSAL QUALITY CONTRACT"));
        assertTrue(TeamPromptLocalizer.localizeTeamSystemPrompt(team, AllowedLanguage.RU)
                        .contains("ПОРЯДОК РАССУЖДЕНИЯ КОМАНДНОГО РАЗБОРА V0.6 И КОНТРАКТ ПРИЧИННОСТИ"));
    }

    @Test
    void coachStandardKillValueUsesConsistentScoreBasis() {
        // 80-point swing (+40/-40) vs one base's measured income r: 80/r and 40/r; r is not inferred from the base count
        // (lagoon and forgecity have 3 bases but 1.5 points/s).
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE.contains("80/r 秒"));
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE.contains("r = 2.5 时约 32 / 16 秒，r = 1.5 时约 53 / 27 秒"));
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE_EN.contains("about 32 / 16 seconds at r = 2.5 and about 53 / 27 seconds at r = 1.5"));
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE_RU.contains("около 32 / 16 секунд при r = 2,5 и около 53 / 27 секунд при r = 1,5"));
        for (final String rule : List.of(TeamPromptLocalizer.COACH_STANDARD_RULE,
                TeamPromptLocalizer.COACH_STANDARD_RULE_EN, TeamPromptLocalizer.COACH_STANDARD_RULE_RU)) {
            assertFalse(rule.contains("一个点 27 秒的收入") || rule.contains("worth about 27 seconds")
                    || rule.contains("стоит примерно 27 секунд"), "80 分摇摆不能等同于 27 秒单点收入");
            assertFalse(rule.contains("3 点图（2.5 分/秒）") || rule.contains("3-base maps (2.5 points/s)")
                    || rule.contains("картах с 3 базами (2,5"), "产分速率不能按点数固定");
        }
    }

    @Test
    void coachStandardRulesKeepPreconditionsAndDoNotOverrideReasoning() {
        final String zh = TeamPromptLocalizer.COACH_STANDARD_RULE;
        assertTrue(zh.contains("只在列出的前提都有当时证据"));
        assertTrue(zh.contains("前提缺证据或命中例外时不套用规则"));
        assertFalse(zh.contains("最高优先级") || zh.contains("以本规范为准"), "压缩规则不得声明覆盖其他模块");
        // RULE-003 / RULE-010 keep the preconditions the Coach Book states.
        assertTrue(zh.contains("第二个方向的敌车当时 CURRENT") && zh.contains("自身血量只够再吃 2–3 发") && zh.contains("有撤离路线"));
        assertTrue(zh.contains("唯一在点里卡点或拒止的车"));
        // RULE-003 keeps two separate fixing exceptions: sustained damage for numbers, and holding the main body for income (no damage needed).
        assertTrue(zh.contains("它拖住对方主力、用时间保住己方收入，不要求持续输出"));
        assertFalse(zh.contains("以多打少或保住收入"));
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE_EN.contains("with no sustained damage required"));
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE_RU.contains("постоянный урон не требуется"));
        assertTrue(zh.contains("对方只剩 1 辆或极少数车"));
        // RULE-011's 5 m figure is not a verified threshold.
        for (final String rule : List.of(zh, TeamPromptLocalizer.COACH_STANDARD_RULE_EN, TeamPromptLocalizer.COACH_STANDARD_RULE_RU)) {
            assertFalse(rule.contains("5 米以上") || rule.contains("at least 5 m") || rule.contains("минимум на 5 м"));
        }
        assertFalse(zh.contains("010 多打一时优先全歼"));
        // Support: a hit proves a firing line; no hit never proves no support. Only human-confirmed roles carry a verdict.
        assertTrue(zh.contains("没有命中不能反推没有支援"));
        assertFalse(zh.contains("看队友是否实际打到攻击者，不看距离"));
        assertTrue(zh.contains("只有标“人工确认”的定位能单独支撑"));
        assertTrue(AiPromptLibrary.zh("team/reasoning-contract").contains("只有争霸赛复盘规范里人工确认的版本定位可以作为角色依据"));
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE_EN.contains("only when every listed precondition is supported"));
        assertTrue(TeamPromptLocalizer.COACH_STANDARD_RULE_RU.contains("только когда каждая перечисленная предпосылка подтверждена"));
        for (final String rule : List.of(TeamPromptLocalizer.COACH_STANDARD_RULE_EN, TeamPromptLocalizer.COACH_STANDARD_RULE_RU)) {
            assertFalse(rule.contains("highest priority") || rule.contains("высший приоритет"));
        }
    }

    @Test
    void soloStandardIsInjectedIntoRandomBattlePromptsInAllLanguages() {
        final String single = AiPromptLibrary.zh("player/single");
        final String fallback = AiPromptLibrary.zh("player/fallback");
        final String tactical = AiPromptLibrary.zh("player/tactical");
        for (final String zh : List.of(single, fallback, tactical)) {
            assertTrue(zh.contains("=== 随机战个人复盘规范 v1.1（Coach Lab） ==="));
            assertTrue(zh.contains("5. 谁在打你先处理谁"));
            assertTrue(PlayerPromptRules.localizePlayerSystemPrompt(zh, AllowedLanguage.EN)
                    .contains("5. Deal first with whoever is shooting you"));
            assertTrue(PlayerPromptRules.localizePlayerSystemPrompt(zh, AllowedLanguage.RU)
                    .contains("5. Сначала разберитесь с тем, кто по вам стреляет"));
        }
        // Team review keeps its own supremacy standard; the solo standard is random-battle only.
        assertFalse(AiPromptLibrary.zh("team/single").contains("随机战个人复盘规范"));
    }

    @Test
    void soloStandardUsesOnlyProductionEvidenceAndNoSamplePrior() {
        // ClientAiReviewProjection marks SHOT_LIFECYCLE / TARGETING / AMMUNITION unavailable: no rule may need
        // shot timing, aimed target or reload state, and tournament sample statistics are not a prior.
        for (final String rule : List.of(PlayerPromptRules.SOLO_STANDARD_RULE,
                PlayerPromptRules.SOLO_STANDARD_RULE_EN, PlayerPromptRules.SOLO_STANDARD_RULE_RU)) {
            for (final String banned : List.of("90%", "81%", "八成", "两成", "80%", "20%",
                    "装好就打", "残血先收", "装填周期", "消耗品",
                    "Fire as soon as", "Finish low-HP", "consumable")) {
                assertFalse(rule.contains(banned), "solo-standard 不应包含：" + banned);
            }
        }
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("没有伤害记录不等于没开炮"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("不得把它当成本局的先验"));
        // No hindsight: a later double hit or third hit alone does not make the earlier decision a mistake.
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("本身不证明前压是错的"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("前压前至少两条威胁已经 CURRENT 或可靠的 LAST_KNOWN"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("它的方向对你已经已知"));
        // Rule 5 judges sustained exposure only; no damage is a trade result, never proof the player did not respond.
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("不作为判失误的依据"));
        // Random teammates are not trusted by default; reliance is judged by the information at decision time.
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("7. 野队队友不可靠"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("判的是依赖本身，不得从队友后来没来或数据缺失反推"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_EN.contains("7. Random teammates are unreliable"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_RU.contains("7. Союзники в случайном бою ненадёжны"));
        // Teammate support is proven only by positive evidence; partial coverage or missing hits never prove absence.
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("位置或距离单独不够"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE.contains("不得从队友后来没来或数据缺失反推"));
        assertFalse(PlayerPromptRules.SOLO_STANDARD_RULE.contains("也没有交火证据的队友"));
        assertFalse(PlayerPromptRules.SOLO_STANDARD_RULE.contains("或 CURRENT 位置显示能打到"));
        for (final String rule : List.of(PlayerPromptRules.SOLO_STANDARD_RULE,
                PlayerPromptRules.SOLO_STANDARD_RULE_EN, PlayerPromptRules.SOLO_STANDARD_RULE_RU)) {
            assertTrue(rule.contains("OBSERVED_DAMAGE_IS_PARTIAL"), "partial coverage guard missing");
        }
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_EN.contains("position or distance alone is not enough"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_RU.contains("одной позиции или дистанции недостаточно"));
        assertFalse(PlayerPromptRules.SOLO_STANDARD_RULE.contains("而你对它没有造成伤害"));
        assertFalse(PlayerPromptRules.SOLO_STANDARD_RULE.contains("写明应该回击它"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_EN.contains("never as grounds for a mistake"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_RU.contains("не служит основанием для ошибки"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_EN.contains("does not by itself prove the advance was wrong"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_RU.contains("сами по себе не доказывают, что выезд был ошибкой"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_EN.contains("No damage record does not mean no shot was fired"));
        assertTrue(PlayerPromptRules.SOLO_STANDARD_RULE_RU.contains("Отсутствие записи урона не значит, что выстрела не было"));
    }
}
