package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 阶段时间线（阶段边界 + 双方存活人数）prompt 契约（阶段 2）。
 * <p>断言四入口（团队 single + 随机战 harness/fallback/完整特征）均注入阶段时间线段：
 * 人数正确（案例：我方死 2、敌方死 3 的时段输出 5 打 4 而非 5 打 7）、X分XX秒、
 * 无 raw team、无裸秒数、人数不可算写未知、预算超限可省略且书签段完好。</p>
 */
class BattlePhaseTimelineEvidenceTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();
    private static final String PLAYER_SECTION_HEADER = "阶段时间线（双方存活人数）";
    private static final String TEAM_SECTION_HEADER = "=== BATTLE_PHASES ===";
    private static final String HARNESS_SECTION_MARKER = "BATTLE PHASE SUMMARY";

    // ---- fixture：7v7（录像者 1 队）。我方阵亡 60s/70s，敌方阵亡 62s/64s/66s，战局 180s ----
    // 中期 [60,180]：我方死 2 → 存活 5；敌方死 3 → 存活 4（5 打 4）

    private static Battle battle() {
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 180.0;
        b.recorder = "rec1";
        final List<PlayerResult> players = new ArrayList<>();
        for (long id = 1001L; id <= 1007L; id++) {
            players.add(player(id, 1, id > 1002L, id == 1001L ? 60.0 : id == 1002L ? 70.0 : 0.0));
        }
        for (long id = 2001L; id <= 2007L; id++) {
            players.add(player(id, 2, id > 2003L, switch ((int) id) {
                case 2001 -> 62.0;
                case 2002 -> 64.0;
                case 2003 -> 66.0;
                default -> 0.0;
            }));
        }
        b.players = players;
        return b;
    }

    private static PlayerResult player(final long accountId, final int team,
                                       final boolean survived, final double deathSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = 4481L;
        p.tankName = "Kranvagn";
        p.nickname = accountId == 1001L ? "rec1" : "p" + accountId;
        p.survived = survived;
        p.deathTimeMillis = survived ? 0L : (long) (deathSec * 1000);
        if (!survived) {
            p.deathTimeSource = deathSec > 0
                    ? DeathTimeSource.SETTLEMENT_SECOND : DeathTimeSource.UNKNOWN;
        }
        p.damageDealt = 1000;
        return p;
    }

    private static List<BattlePhaseSummary> phasesWithSurvival() {
        return BattlePhaseSummary.buildRelativePhasesWithSurvival(
                50f, 180f,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle(), 1));
    }

    private static List<BattlePhaseSummary> phasesWithUnknownEnemySide() {
        return BattlePhaseSummary.buildRelativePhasesWithSurvival(
                50f, 180f,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battleWithUnknownEnemyDeath(), 1));
    }

    /** 敌方 2006 阵亡但死亡时刻缺失 → 敌方存活人数不可算（UNKNOWN），我方不受影响。 */
    private static Battle battleWithUnknownEnemyDeath() {
        final Battle b = battle();
        final List<PlayerResult> players = new ArrayList<>(b.players);
        for (int i = 0; i < players.size(); i++) {
            if (players.get(i).accountId == 2006L) {
                players.set(i, player(2006L, 2, false, 0.0));
                break;
            }
        }
        b.players = players;
        return b;
    }

    private static String betweenHeaders(final String content, final String fromHeader) {
        final int start = content.indexOf(fromHeader);
        assertTrue(start >= 0, "content must contain section header [" + fromHeader + "]:\n" + content);
        final String rest = content.substring(start);
        final int next = rest.indexOf("\n===", 1);
        return next < 0 ? rest : rest.substring(0, next);
    }

    /** 从 fromHeader 截取到 toMarker（不含）之间的内容。 */
    private static String between(final String content, final String fromHeader, final String toMarker) {
        final int start = content.indexOf(fromHeader);
        assertTrue(start >= 0, "content must contain section header [" + fromHeader + "]:\n" + content);
        final int end = content.indexOf(toMarker, start + fromHeader.length());
        return end < 0 ? content.substring(start) : content.substring(start, end);
    }

    // ---- 团队 single ----

    private static String teamSingleContent(final List<BattlePhaseSummary> phases) {
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, List.of(), null, TeamObservedAggregate.empty(),
                List.of(), List.of(), phases, List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
        final SingleTeamBattleAnalysisContext ctx = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle(), 1, features,
                null, List.of(), null);
        return TeamAiPromptBuilder.single(ctx).content();
    }

    @Test
    void teamSingleInjectsPhaseTimelineWithFiveVsFour() {
        final String section = betweenHeaders(teamSingleContent(phasesWithSurvival()), TEAM_SECTION_HEADER);

        // 中期 [1分00秒-3分00秒]：我方死 2 → 5、敌方死 3 → 4（5 打 4）
        assertTrue(section.contains("phase[1分00秒-3分00秒]"), section);
        assertTrue(section.contains("type=中期"), section);
        assertTrue(section.contains("阶段末friendlyAlive=5"), section);
        assertTrue(section.contains("阶段末enemyAlive=4"), section);
        assertTrue(section.contains("denseKills=true"), "密集击杀段必须标注：" + section);
        // 开局 [0分00秒-0分45秒]：7 打 7
        assertTrue(section.contains("phase[0分00秒-0分45秒]"), section);
        assertTrue(section.contains("阶段末friendlyAlive=7"), section);
        assertTrue(section.contains("阶段末enemyAlive=7"), section);
        // 权威口径
        assertTrue(section.contains("DEATH_SOURCE=权威结算"), section);
        assertTrue(section.contains("不得猜测"), section);
    }

    @Test
    void teamSinglePhaseSectionHasNoRawTeamAndNoBareSeconds() {
        final String section = betweenHeaders(teamSingleContent(phasesWithSurvival()), TEAM_SECTION_HEADER);

        assertFalse(section.contains("team="), "raw team 不得进入阶段段：" + section);
        assertFalse(section.contains("perspectiveTeam"), section);
        assertFalse(section.matches("(?s).*\\d+\\.\\d+.*"),
                "阶段段时间必须 X分XX秒，不得出现小数裸秒数：" + section);
        assertFalse(section.matches("(?s).*\\b\\d+s\\b.*"), "不得输出裸秒数：" + section);
    }

    @Test
    void teamSingleWritesUnknownWhenCountsNotComputable() {
        final String section = betweenHeaders(
                teamSingleContent(phasesWithUnknownEnemySide()), TEAM_SECTION_HEADER);

        assertTrue(section.contains("friendlyAlive=5"), "我方时间线完整 → 人数可算：" + section);
        assertTrue(section.contains("enemyAlive=UNKNOWN"),
                "存在未知死亡时刻 → 敌方写 UNKNOWN 不猜：" + section);
        assertFalse(section.contains("enemyAlive=4"), section);
    }

    // ---- 随机战 harness（Call #2） ----

    private static TacticalReviewPromptBuilder.PreparedHarnessPrompt prepareHarness(
            final List<BattlePhaseSummary> phases, final int contextWindow) {
        return TacticalReviewPromptBuilder.prepare(
                new PreBattleStrategicPrior(
                        new PreBattleStrategicPrior.TeamProfile(Map.of(), List.of(), List.of(), List.of()),
                        new PreBattleStrategicPrior.TeamProfile(Map.of(), List.of(), List.of(), List.of()),
                        List.of(), List.of(), List.of()),
                new EvidenceSkillResult(List.of(), List.of(), List.of()),
                battle(),
                null,
                new PlayerBattleFeatureSet(List.of(), List.of(), phases, List.of(), List.of(), true),
                new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT),
                ESTIMATOR,
                100_000,
                contextWindow,
                8192,
                1000);
    }

    @Test
    void harnessInjectsPhaseTimelineWithFiveVsFour() {
        final String content = prepareHarness(phasesWithSurvival(), 131_072).userContent();
        final String section = betweenHeaders(content, HARNESS_SECTION_MARKER);

        assertTrue(section.contains("[1分00秒-3分00秒] 中期"), section);
        assertTrue(section.contains("至阶段末 我方存活 5"), "我方死 2 → 存活 5：" + section);
        assertTrue(section.contains("我方存活 5 敌方存活 4"), "敌方死 3 → 存活 4：" + section);
        assertTrue(section.contains("（密集击杀）"), section);
        assertTrue(section.contains("[0分00秒-0分45秒] 开局"), section);
        assertTrue(section.contains("至阶段末 我方存活 7"), section);
        assertTrue(section.contains("我方存活 7 敌方存活 7"), section);
        assertTrue(section.contains("DEATH_SOURCE=权威结算"), section);
        assertFalse(section.contains("录像者"), "不得以「录像者」指代自己：" + section);
        assertFalse(section.contains("team="), "raw team 不得进入 prompt 段：" + section);
        assertFalse(section.matches("(?s).*\\d+\\.\\d+.*"), "裸秒数不得出现：" + section);
    }

    @Test
    void harnessDropsPhaseSectionWhenBudgetExceededButKeepsBookends() {
        final var prepared = prepareHarness(phasesWithSurvival(), 2000);
        final String content = prepared.userContent();
        assertTrue(prepared.truncated());
        assertFalse(content.contains(HARNESS_SECTION_MARKER),
                "阶段时间线段超预算时必须可省略：" + content);
        assertTrue(content.contains("BATTLE SNAPSHOT"), "书签段不得被裁剪");
        assertTrue(content.contains("PRE-BATTLE STRATEGIC PRIOR"), "书签段不得被裁剪");
        assertTrue(content.contains("======================== TASK"), "书签段不得被裁剪");
    }

    // ---- fallback（随机战旧路径） ----

    @Test
    void fallbackInjectsPhaseTimelineWithSurvival() {
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFallback(battle(), null);
        final String content = prepared.userPrompt();
        final String section = betweenHeaders(content, PLAYER_SECTION_HEADER);

        // fallback 无首次接敌：阶段为 开局[0,45] / 中期[45,180] / 残局[180,180]
        assertTrue(section.contains("[0分45秒-3分00秒] 中期"), section);
        assertTrue(section.contains("至阶段末 我方存活 5"), section);
        assertTrue(section.contains("我方存活 5 敌方存活 4"), section);
        assertTrue(section.contains("（密集击杀）"), section);
        assertTrue(section.contains("[0分00秒-0分45秒] 开局"), section);
        assertTrue(section.contains("至阶段末 我方存活 7"), section);
        assertTrue(section.contains("我方存活 7 敌方存活 7"), section);
        assertTrue(section.contains("DEATH_SOURCE=权威结算"), section);
        assertFalse(section.contains("录像者"), "不得以「录像者」指代自己：" + section);
        assertFalse(section.contains("team="), section);
        assertFalse(section.matches("(?s).*\\d+\\.\\d+.*"), "裸秒数不得出现：" + section);
        assertNotNull(prepared.systemPrompt());
    }

    @Test
    void fallbackWritesUnknownForUnresolvableSide() {
        final PreparedAiPrompt prepared =
                PlayerReplayPromptBuilder.prepareFallback(battleWithUnknownEnemyDeath(), null);
        final String section = betweenHeaders(prepared.userPrompt(), PLAYER_SECTION_HEADER);

        assertTrue(section.contains("至阶段末 我方存活 5"), section);
        assertTrue(section.contains("敌方存活 未知"), "人数不可算 → 写未知不猜：" + section);
        assertFalse(section.contains("敌方存活 4"), section);
    }

    @Test
    void fallbackWithoutPlayersRendersUnknownCountsAndNoBareSeconds() {
        final Battle noRoster = new Battle();
        noRoster.durationS = 180.0;
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFallback(noRoster, null);
        final String content = prepared.userPrompt();
        final String section = betweenHeaders(content, PLAYER_SECTION_HEADER);
        assertTrue(section.contains("至阶段末 我方存活 未知"), "无名册 → 写未知不猜：" + section);
        assertTrue(section.contains("敌方存活 未知"), section);
        assertNotNull(prepared.systemPrompt());
        assertTrue(content.contains("地图"), "fallback 其余内容不受影响");
    }

    @Test
    void fallbackWithoutDurationOmitsPhaseSectionWithoutBreakingPrompt() {
        final Battle noDuration = new Battle();
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFallback(noDuration, null);
        final String content = prepared.userPrompt();
        assertFalse(content.contains(PLAYER_SECTION_HEADER), "无战局时长 → 无阶段时间线");
        assertNotNull(prepared.systemPrompt());
        assertTrue(content.contains("地图"), "fallback 其余内容不受影响");
    }

    // ---- 完整特征路径（prepareFull） ----

    @Test
    void fullPathInjectsPhaseTimelineWithSurvival() {
        final SinglePlayerBattleAnalysisContext ctx = new SinglePlayerBattleAnalysisContext(
                null, battle(), new PlayerBattleFeatureSet(
                        List.of(), List.of(), phasesWithSurvival(), List.of(), List.of(), true),
                new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT),
                new ReplayCoverage(true, 1, 1, 0, 0, 0, 1.0, Map.of()), List.of());
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFull(
                ctx, null, ESTIMATOR, 100_000, 131_072, 8192, 1000);
        final String content = prepared.userPrompt();
        // 完整特征路径中阶段段之后还有「覆盖: 1.0」等后续行，截取到该标记为止
        final String section = between(content, PLAYER_SECTION_HEADER, "\n覆盖:");

        assertTrue(section.contains("[1分00秒-3分00秒] 中期"), section);
        assertTrue(section.contains("至阶段末 我方存活 5"), section);
        assertTrue(section.contains("我方存活 5 敌方存活 4"), section);
        assertTrue(section.contains("（密集击杀）"), section);
        assertTrue(section.contains("DEATH_SOURCE=权威结算"), section);
        assertFalse(section.contains("录像者"), section);
        assertFalse(section.contains("team="), section);
        assertFalse(section.matches("(?s).*\\d+\\.\\d+.*"), "裸秒数不得出现：" + section);
    }
}
