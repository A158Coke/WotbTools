package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 坦克名称必须作为不可推断的专有名词。
 * <p>断言真实生成的 system prompt 与真实生成的证据内容，而不是只验证常量存在。
 * SPHT（tankId 29985，tankopedia 中为 tier 10 美系重坦）只是暴露问题的样例，
 * 规则和实现都必须是通用的。</p>
 */
class TankNameProperNounTest {

    /** tankopedia.json: {"name":"SPHT","tier":10,"class":"重坦","nation":"美国"} */
    private static final long SPHT_TANK_ID = 29985L;
    /** tankopedia 中不存在的 tankId，用于验证「无类型数据」路径。 */
    private static final long UNKNOWN_TANK_ID = 999_999_999L;

    private static Stream<String> allSystemPrompts() {
        return Stream.of(
                AiReplayAnalysisService.SYSTEM_PROMPT,
                AiReplayAnalysisService.SINGLE_PLAYER_PROMPT,
                AiReplayAnalysisService.SINGLE_TEAM_PROMPT,
                AiReplayAnalysisService.MULTI_TEAM_PROMPT,
                AiReplayAnalysisService.MULTI_SYSTEM_PROMPT);
    }

    // ---- 1 & 2：Player 与 Team system prompt 都包含专有名词规则 ----

    @Test
    void playerSystemPromptsRequireTankNamesToBeKeptVerbatim() {
        for (final String prompt : List.of(
                AiReplayAnalysisService.SYSTEM_PROMPT,
                AiReplayAnalysisService.SINGLE_PLAYER_PROMPT,
                AiReplayAnalysisService.MULTI_SYSTEM_PROMPT)) {
            assertTrue(prompt.contains("专有名词"), prompt);
            assertTrue(prompt.contains("必须原样使用"), prompt);
            assertTrue(prompt.contains("禁止拆分、翻译、展开"), prompt);
        }
    }

    @Test
    void teamSystemPromptsContainTheSameRule() {
        for (final String prompt : List.of(
                AiReplayAnalysisService.SINGLE_TEAM_PROMPT,
                AiReplayAnalysisService.MULTI_TEAM_PROMPT)) {
            assertTrue(prompt.contains("专有名词"), prompt);
            assertTrue(prompt.contains("必须原样使用"), prompt);
            assertTrue(prompt.contains("vehicleClass"), prompt);
        }
    }

    // ---- 3 & 4 & 5：SPHT 不是 SPG、不是自行火炮、禁止由名称推断车种 ----

    @Test
    void everySystemPromptStatesSphtIsNotSpg() {
        allSystemPrompts().forEach(prompt ->
                assertTrue(prompt.contains("SPHT 就是完整的坦克名称，它不是 SPG"), prompt));
    }

    @Test
    void everySystemPromptForbidsCallingSphtArtillery() {
        allSystemPrompts().forEach(prompt -> {
            assertTrue(prompt.contains("也不代表自行火炮"), prompt);
            assertTrue(prompt.contains("不存在自行火炮车种"), prompt);
        });
    }

    @Test
    void everySystemPromptForbidsInferringClassFromName() {
        allSystemPrompts().forEach(prompt -> {
            assertTrue(prompt.contains("禁止根据坦克名称推断车辆类型"), prompt);
            assertTrue(prompt.contains("只有证据显式给出"), prompt);
            assertTrue(prompt.contains("证据未提供的坦克属性一律不得自行补充"), prompt);
        });
    }

    @Test
    void ruleAppliesToLineupDamageThreatAndSummary() {
        allSystemPrompts().forEach(prompt -> assertTrue(
                prompt.contains("阵容分析、伤害交换描述、威胁分析、战术建议与最终总结"), prompt));
    }

    // ---- 6：阵容证据把 SPHT 作为坦克名称输出，车种来自结构化字段 ----

    @Test
    void enemyLineupEvidenceEmitsSphtAsTankNameWithStructuredClass() {
        final StringBuilder sb = new StringBuilder();
        AiReplayAnalysisService.appendPlayerLine(sb, spht("EnemyAce", 386), false);
        final String evidence = sb.toString();

        assertTrue(evidence.contains("敌方 \"EnemyAce\""), evidence);
        assertTrue(evidence.contains("坦克: \"SPHT\""), evidence);
        // 车种来自 tankopedia 的 class 字段，而不是名称推断
        assertTrue(evidence.contains("车种: 重坦"), evidence);
        assertTrue(evidence.contains("输出386"), evidence);
    }

    // ---- 8：后端证据绝不生成「自行火炮 SPHT」之类的推断文本 ----

    @Test
    void backendEvidenceNeverLabelsSphtAsArtilleryOrSpg() {
        final StringBuilder sb = new StringBuilder();
        AiReplayAnalysisService.appendPlayerLine(sb, spht("EnemyAce", 386), false);
        AiReplayAnalysisService.appendPlayerLine(sb, spht("FriendlyAce", 120), true);
        final String evidence = sb.toString();

        assertFalse(evidence.contains("自行火炮"), evidence);
        assertFalse(evidence.contains("SPG"), evidence);
        assertFalse(evidence.contains("火炮 SPHT"), evidence);
        // 名称原样保留，未被拆分或展开
        assertEquals(2, countOccurrences(evidence, "\"SPHT\""), evidence);
    }

    // ---- 7：伤害交换证据可支撑「你对敌方 SPHT 造成了 X 点伤害」 ----

    @Test
    void damageExchangeEvidenceAttributesDamageToNamedEnemyTank() {
        final Battle battle = new Battle();
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = 1L;
        recorder.nickname = "Recorder";
        recorder.team = 1;
        recorder.survived = true;
        final PlayerResult victim = spht("EnemyAce", 0);
        victim.accountId = 2L;
        victim.team = 2;
        battle.players = List.of(recorder, victim);
        battle.winnerTeam = 1;
        recorder.killVictims.add(new com.wotb.core.stats.PotentialDamage.KillVictim(2L, 780, 2));

        final StringBuilder sb = new StringBuilder();
        AiReplayAnalysisService.appendRecorderDamageExchange(sb, battle, recorder);
        final String evidence = sb.toString();

        assertTrue(evidence.contains("RECORDER_DAMAGE_EXCHANGE_OBSERVED"), evidence);
        assertTrue(evidence.contains("坦克: \"SPHT\""), evidence);
        assertTrue(evidence.contains("车种: 重坦"), evidence);
        assertTrue(evidence.contains("直接伤害780"), evidence);
        assertFalse(evidence.contains("自行火炮"), evidence);
        assertFalse(evidence.contains("SPG"), evidence);
    }

    @Test
    void damageExchangeSectionIsOmittedWithoutVictimData() {
        final Battle battle = new Battle();
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = 1L;
        battle.players = List.of(recorder);

        final StringBuilder sb = new StringBuilder();
        AiReplayAnalysisService.appendRecorderDamageExchange(sb, battle, recorder);

        assertEquals("", sb.toString());
    }

    // ---- Team 证据：tank 名称 + 结构化 vehicleClass ----

    @Test
    void teamMemberEvidenceEmitsTankNameAndStructuredVehicleClass() {
        final String content = TeamAiPromptBuilder.single(teamContextWithTank(SPHT_TANK_ID)).content();

        assertTrue(content.contains("tank=\"SPHT\""), content);
        assertTrue(content.contains("vehicleClass=重坦"), content);
        assertFalse(content.contains("自行火炮"), content);
        assertFalse(content.contains("SPG"), content);
    }

    // ---- 9：通用规则，不是针对 SPHT 的硬编码分支 ----

    @Test
    void unknownTankIdYieldsUnknownClassInsteadOfAGuess() {
        final PlayerResult p = new PlayerResult();
        p.accountId = 7L;
        p.nickname = "Someone";
        p.tankId = UNKNOWN_TANK_ID;
        p.tankName = "SPHT-LIKE-NAME";
        p.survived = true;

        final StringBuilder sb = new StringBuilder();
        AiReplayAnalysisService.appendPlayerLine(sb, p, false);
        final String evidence = sb.toString();

        // 名称原样保留；tankopedia 无类型数据时只输出「未知」，绝不由名称猜测
        assertTrue(evidence.contains("坦克: \"SPHT-LIKE-NAME\""), evidence);
        assertTrue(evidence.contains("车种: " + ReplayDisplayNames.UNKNOWN_TANK_CLASS), evidence);
        assertFalse(evidence.contains("自行火炮"), evidence);
    }

    @Test
    void tankClassResolutionIsDrivenByTankIdNotByNameText() {
        // 同一个名称文本配不同 tankId → 车种完全由结构化查表决定
        assertEquals("重坦", ReplayDisplayNames.tankClass(SPHT_TANK_ID));
        assertEquals(ReplayDisplayNames.UNKNOWN_TANK_CLASS,
                ReplayDisplayNames.tankClass(UNKNOWN_TANK_ID));
        assertEquals(ReplayDisplayNames.UNKNOWN_TANK_CLASS, ReplayDisplayNames.tankClass(0L));
        assertEquals(ReplayDisplayNames.UNKNOWN_TANK_CLASS, ReplayDisplayNames.tankClass(-1L));
    }

    @Test
    void ruleTextIsGenericAndNotLimitedToSpht() {
        final String rule = AiReplayAnalysisService.TANK_NAME_PROPER_NOUN_RULE;
        // SPHT 只作为举例出现一次，规则主体覆盖「所有坦克名称」
        assertTrue(rule.contains("都是由 tankId 经权威车辆库映射得到的完整专有名词"), rule);
        assertEquals(1, countOccurrences(rule, "SPHT"), rule);
    }

    // ---- 10：现有坦克名称映射不被破坏 ----

    @Test
    void existingTankNameMappingStillResolvesFromTankopedia() {
        assertEquals("SPHT", ReplayDisplayNames.tankName(SPHT_TANK_ID, null));
        // tankopedia 命中时优先于回放自带名称，名称原样返回
        assertEquals("SPHT", ReplayDisplayNames.tankName(SPHT_TANK_ID, "ignored"));
        // 无映射时回落到回放名称，仍不做任何解释
        assertEquals("SPHT-LIKE-NAME",
                ReplayDisplayNames.tankName(UNKNOWN_TANK_ID, "SPHT-LIKE-NAME"));
        assertEquals("未知坦克", ReplayDisplayNames.tankName(0L, null));
    }

    // ---- helpers ----

    private static PlayerResult spht(final String nickname, final int damageDealt) {
        final PlayerResult p = new PlayerResult();
        p.nickname = nickname;
        p.tankId = SPHT_TANK_ID;
        p.damageDealt = damageDealt;
        p.survived = true;
        return p;
    }

    private static int countOccurrences(final String haystack, final String needle) {
        int count = 0;
        int idx = haystack.indexOf(needle);
        while (idx >= 0) {
            count++;
            idx = haystack.indexOf(needle, idx + needle.length());
        }
        return count;
    }

    /** 走真实管线构造 team 上下文（与 TeamAiPromptBuilderTest 相同的方式）。 */
    private static SingleTeamBattleAnalysisContext teamContextWithTank(final long tankId) {
        final PlayerResult player = new PlayerResult();
        player.accountId = 10_001L;
        player.nickname = "Alpha";
        player.team = 1;
        player.tankId = tankId;
        player.damageDealt = 1_000;
        player.survived = true;

        final Battle battle = new Battle();
        battle.arenaId = "tank-name-arena";
        battle.mapName = "budget_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.players = List.of(player);
        battle.recorder = player.nickname;

        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        final var result = new ReplayProcessingResult(
                "tank-name.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "tank-name-hash", "tank-name-arena", "11.0",
                        "budget_map", player.accountId, null),
                battle, null, null, capabilities, null, null);
        final var group = new BatchAnalyzer().analyze(List.of(result))
                .groups()
                .getFirst();
        return new AiReplayAnalysisService("", "", "", 1, 30000)
                .buildSingleTeamContext(group);
    }
}
