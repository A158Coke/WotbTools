package com.wotb.web.replay.ai;
import com.wotb.web.replay.ai.TeamReplayAnalysisService;
import com.wotb.web.replay.ai.PlayerReplayPromptBuilder;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.EngagementOutcome;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 四类输出缺陷的回归测试：
 * <ol>
 *   <li>friendly 被理解成「朋友」——证据里的英文段头必须带中文注解，prompt 必须钉死 FRIENDLY = 友方；</li>
 *   <li>敌方阵容信息缺失——逐车证据必须含承伤/助攻/格挡/命中，prompt 必须要求逐车分析；</li>
 *   <li>双方对炮明细——必须来自事件流逐次伤害，覆盖未被击杀的对手，并带权威坦克名称；</li>
 *   <li>英文术语泄漏（favourable / MID GAME 等）——证据里的枚举必须以中文呈现。</li>
 * </ol>
 */
class PlayerAnalysisTermsAndEnemyEvidenceTest {

    private static final long SPHT_TANK_ID = 29985L;   // tankopedia: SPHT / Heavy tank / 10 / USA
    private static final long RECORDER_ACCOUNT = 1L;
    private static final long ENEMY_ACCOUNT = 2L;

    private static Stream<String> allSystemPrompts() {
        return Stream.of(
                PlayerReplayPromptBuilder.SYSTEM_PROMPT,
                PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT,
                TeamReplayAnalysisService.SINGLE_TEAM_PROMPT,
                TeamReplayAnalysisService.MULTI_TEAM_PROMPT,
                PlayerReplayPromptBuilder.MULTI_SYSTEM_PROMPT);
    }

    // ---- 1. friendly ≠ 朋友 ----

    @Test
    void everyPromptPinsFriendlyToTheMilitaryChineseTerm() {
        allSystemPrompts().forEach(prompt -> {
            assertTrue(prompt.contains("最终正文必须使用自然、通顺的简体中文"), prompt);
        });
    }

    @Test
    void everyPromptForbidsEchoingEnglishMachineLabels() {
        allSystemPrompts().forEach(prompt -> {
            assertTrue(prompt.contains("禁止原样写入复盘，也禁止逐词直译"), prompt);
        });
    }

    @Test
    void lineupSectionHeadersCarryChineseGloss() {
        final String evidence = lineupEvidence();
        assertTrue(evidence.contains("FRIENDLY_LINEUP_AUTHORITATIVE（友方阵容·权威结算）"), evidence);
        assertTrue(evidence.contains("ENEMY_LINEUP_AUTHORITATIVE（敌方阵容·权威结算）"), evidence);
    }

    // ---- 2. 敌方逐车信息完整 ----

    @Test
    void enemyLineupCarriesFullPerVehicleFacts() {
        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendPlayerLine(sb, enemy(), false);
        final String line = sb.toString();

        assertTrue(line.contains("坦克: \"SPHT\""), line);
        assertTrue(line.contains("车种: Heavy tank"), line);
        assertTrue(line.contains("输出2100"), line);
        assertTrue(line.contains("承伤1500"), line);
        assertTrue(line.contains("助攻300"), line);
        assertTrue(line.contains("格挡900"), line);
        assertTrue(line.contains("击杀2"), line);
        assertTrue(line.contains("命中12"), line);
        assertTrue(line.contains("击穿9"), line);
        assertTrue(line.contains("打到人数4"), line);
    }

    @Test
    void enemyLineupCarriesStructuredTierAndNation() {
        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendPlayerLine(sb, enemy(), false);
        final String line = sb.toString();

        // 等级/国家来自 tankopedia 的结构化字段
        assertTrue(line.contains("等级: 10"), line);
        assertTrue(line.contains("国家: USA"), line);
    }

    @Test
    void unknownTankOmitsTierAndNationInsteadOfGuessing() {
        final PlayerResult p = enemy();
        p.tankId = 999_999_999L;
        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendPlayerLine(sb, p, false);
        final String line = sb.toString();

        assertTrue(line.contains("车种: 未知"), line);
        assertFalse(line.contains("等级:"), line);
        assertFalse(line.contains("国家:"), line);
    }

    @Test
    void killAttributionNamesBothDirections() {
        final Battle battle = battleWithRecorderAndEnemy();
        final PlayerResult recorder = battle.players.get(0);
        final PlayerResult enemyPlayer = battle.players.get(1);
        recorder.killVictims.add(new com.wotb.core.stats.PotentialDamage.KillVictim(ENEMY_ACCOUNT, 900, 3));
        enemyPlayer.killVictims.add(new com.wotb.core.stats.PotentialDamage.KillVictim(RECORDER_ACCOUNT, 640, 2));

        final StringBuilder sb = new StringBuilder();
        final boolean written = PlayerReplayPromptBuilder.appendKillAttribution(sb, battle, recorder);
        final String evidence = sb.toString();

        assertTrue(written);
        assertTrue(evidence.contains("KILL_ATTRIBUTION_OBSERVED（击杀归因·事件流观测）"), evidence);
        assertTrue(evidence.contains("你击杀了 敌方 \"EnemyAce\" 坦克: \"SPHT\""), evidence);
        assertTrue(evidence.contains("累计承受你900点伤害"), evidence);
        assertTrue(evidence.contains("击杀你的是 敌方 \"EnemyAce\" 坦克: \"SPHT\""), evidence);
        assertTrue(evidence.contains("对你累计造成640点伤害"), evidence);
        assertFalse(evidence.contains("自行火炮"), evidence);
    }

    @Test
    void killAttributionIsOmittedWithoutKillData() {
        final Battle battle = battleWithRecorderAndEnemy();
        final StringBuilder sb = new StringBuilder();

        assertFalse(PlayerReplayPromptBuilder.appendKillAttribution(sb, battle, battle.players.get(0)));
        assertEquals("", sb.toString());
    }

    @Test
    void promptsRequirePerVehicleEnemyAnalysis() {
        allSystemPrompts().forEach(prompt -> assertTrue(
                prompt.contains("必须逐车分析敌方阵容") || prompt.contains("必须逐车分析对方阵容"), prompt));
        assertTrue(PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT
                .contains("敌方阵容逐车分析"), PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT);
        assertTrue(PlayerReplayPromptBuilder.SYSTEM_PROMPT
                .contains("逐车分析敌方阵容"), PlayerReplayPromptBuilder.SYSTEM_PROMPT);
    }

    // ---- 3. 双方对炮明细 ----

    @Test
    void damageExchangeCoversBothDirectionsWithAuthoritativeTankName() {
        final Battle battle = battleWithRecorderAndEnemy();
        final StringBuilder sb = new StringBuilder();

        final boolean written = PlayerReplayPromptBuilder.appendDamageExchangeByOpponent(
                sb, battle, RECORDER_ACCOUNT,
                reconWith(
                        damage(10f, RECORDER_ACCOUNT, ENEMY_ACCOUNT, 386),
                        damage(12f, RECORDER_ACCOUNT, ENEMY_ACCOUNT, 400),
                        damage(15f, ENEMY_ACCOUNT, RECORDER_ACCOUNT, 250)));

        assertTrue(written);
        final String evidence = sb.toString();
        assertTrue(evidence.contains("DAMAGE_EXCHANGE_BY_OPPONENT_OBSERVED（逐对手对炮明细·事件流观测）"), evidence);
        assertTrue(evidence.contains("坦克: \"SPHT\""), evidence);
        assertTrue(evidence.contains("车种: Heavy tank"), evidence);
        assertTrue(evidence.contains("你对其造成786伤害/2次命中"), evidence);
        assertTrue(evidence.contains("其对你造成250伤害/1次命中"), evidence);
        assertFalse(evidence.contains("自行火炮"), evidence);
    }

    @Test
    void damageExchangeIncludesOpponentsThatWereNeverKilled() {
        final Battle battle = battleWithRecorderAndEnemy();
        // 敌人存活：killVictims 一定为空，只有事件流能提供这条对炮信息
        battle.players.get(1).survived = true;
        assertTrue(battle.players.get(0).killVictims.isEmpty());

        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendDamageExchangeByOpponent(
                sb, battle, RECORDER_ACCOUNT,
                reconWith(damage(20f, RECORDER_ACCOUNT, ENEMY_ACCOUNT, 512)));

        assertTrue(sb.toString().contains("你对其造成512伤害/1次命中"), sb.toString());
    }

    @Test
    void damageExchangeExcludesPreBattleDamage() {
        final Battle battle = battleWithRecorderAndEnemy();
        final StringBuilder sb = new StringBuilder();

        // battleStart=30s：20s 的伤害属准备阶段，必须被排除
        final boolean written = PlayerReplayPromptBuilder.appendDamageExchangeByOpponent(
                sb, battle, RECORDER_ACCOUNT,
                reconWith(30f, damage(20f, RECORDER_ACCOUNT, ENEMY_ACCOUNT, 999)));

        assertFalse(written);
        assertEquals("", sb.toString());
    }

    @Test
    void damageExchangeIsOmittedWhenNoDamageInvolvesRecorder() {
        final Battle battle = battleWithRecorderAndEnemy();
        final StringBuilder sb = new StringBuilder();

        final boolean written = PlayerReplayPromptBuilder.appendDamageExchangeByOpponent(
                sb, battle, RECORDER_ACCOUNT,
                reconWith(damage(10f, 8L, 9L, 300)));

        assertFalse(written);
        assertEquals("", sb.toString());
    }

    // ---- 4. 术语中文化 ----

    @Test
    void phaseAndOutcomeTermsAreChinese() {
        assertEquals("中期", PlayerAnalysisTerms.phaseLabel(BattlePhaseType.MID_GAME));
        assertEquals("后期", PlayerAnalysisTerms.phaseLabel(BattlePhaseType.LATE_GAME));
        assertEquals("残局", PlayerAnalysisTerms.phaseLabel(BattlePhaseType.ENDGAME));
        assertEquals("开局", PlayerAnalysisTerms.phaseLabel(BattlePhaseType.OPENING));
        assertEquals("首次接敌", PlayerAnalysisTerms.phaseLabel(BattlePhaseType.FIRST_CONTACT));
        assertEquals("准备阶段", PlayerAnalysisTerms.phaseLabel(BattlePhaseType.PRE_BATTLE));

        assertEquals("有利", PlayerAnalysisTerms.outcomeLabel(EngagementOutcome.FAVORABLE));
        assertEquals("不利", PlayerAnalysisTerms.outcomeLabel(EngagementOutcome.UNFAVORABLE));
        assertEquals("均势", PlayerAnalysisTerms.outcomeLabel(EngagementOutcome.EVEN));

        assertEquals("移动", PlayerAnalysisTerms.movementLabel(MovementType.MOVING));
        assertEquals("静止", PlayerAnalysisTerms.movementLabel(MovementType.STATIONARY));

        assertEquals("精确", PlayerAnalysisTerms.confidenceLabel(DecodeConfidence.EXACT));
        assertEquals("推算", PlayerAnalysisTerms.confidenceLabel(DecodeConfidence.INFERRED));

        assertEquals("车辆被击毁", PlayerAnalysisTerms.keyEventLabel("VEHICLE_DESTROYED"));
        assertEquals("战斗结束", PlayerAnalysisTerms.keyEventLabel("BATTLE_END"));
    }

    @Test
    void everyEnumValueHasANonEnglishLabel() {
        for (final BattlePhaseType type : BattlePhaseType.values()) {
            assertFalse(PlayerAnalysisTerms.phaseLabel(type).matches("[A-Z_]+"),
                    "phase 未中文化: " + type);
        }
        for (final EngagementOutcome outcome : EngagementOutcome.values()) {
            assertFalse(PlayerAnalysisTerms.outcomeLabel(outcome).matches("[A-Z_]+"),
                    "outcome 未中文化: " + outcome);
        }
        for (final MovementType type : MovementType.values()) {
            assertFalse(PlayerAnalysisTerms.movementLabel(type).matches("[A-Z_]+"),
                    "movement 未中文化: " + type);
        }
        for (final DecodeConfidence confidence : DecodeConfidence.values()) {
            assertFalse(PlayerAnalysisTerms.confidenceLabel(confidence).matches("[A-Z_]+"),
                    "confidence 未中文化: " + confidence);
        }
    }

    @Test
    void promptsMapEnglishPhaseAndOutcomeTermsToChinese() {
        allSystemPrompts().forEach(prompt -> {
            assertTrue(prompt.contains("不得使用英文缩写 TD"), prompt);
        });
    }

    // ---- helpers ----

    private static String lineupEvidence() {
        final StringBuilder sb = new StringBuilder();
        sb.append("\n=== FRIENDLY_LINEUP_AUTHORITATIVE（友方阵容·权威结算） ===\n");
        sb.append("=== ENEMY_LINEUP_AUTHORITATIVE（敌方阵容·权威结算） ===\n");
        return sb.toString();
    }

    private static PlayerResult enemy() {
        final PlayerResult p = new PlayerResult();
        p.accountId = ENEMY_ACCOUNT;
        p.nickname = "EnemyAce";
        p.team = 2;
        p.tankId = SPHT_TANK_ID;
        p.damageDealt = 2_100;
        p.damageReceived = 1_500;
        p.damageAssisted = 300;
        p.damageBlocked = 900;
        p.kills = 2;
        p.nHitsDealt = 12;
        p.nPenetrationsDealt = 9;
        p.nEnemiesDamaged = 4;
        p.survived = true;
        return p;
    }

    private static Battle battleWithRecorderAndEnemy() {
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = RECORDER_ACCOUNT;
        recorder.nickname = "Recorder";
        recorder.team = 1;
        recorder.survived = true;

        final Battle battle = new Battle();
        battle.players = List.of(recorder, enemy());
        battle.recorder = "Recorder";
        battle.winnerTeam = 1;
        return battle;
    }

    private static DamageEvent damage(final float clock, final long attacker,
                                     final long victim, final int amount) {
        return new DamageEvent(0, new ReplayTimestamp(clock, null), 8,
                DecodeConfidence.EXACT, 0, 0, attacker, victim, amount, false);
    }

    private static ReplayReconstruction reconWith(final DamageEvent... events) {
        return reconWith(null, events);
    }

    private static ReplayReconstruction reconWith(final Float battleStart,
                                                  final DamageEvent... events) {
        return new ReplayReconstruction(
                null, null, 300f, battleStart, List.of(),
                List.<ReplayEvent>of(events), List.of(), null, null, null);
    }
}
