package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 敌方最后已知位置 prompt 契约（阶段 1：团队 single + 随机战 harness/fallback）。
 * <p>断言：注入段存在、UNKNOWN 语义、无 raw team、时间必须 X分XX秒（无裸秒数）、
 * 不出现「录像者」指代自己、段头明确「观测子集」。</p>
 */
class EnemyLastKnownPositionEvidenceTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();
    private static final float START_RAW = 1000f;

    private static final String SECTION_HEADER = "ENEMY_LAST_KNOWN_POSITIONS_OBSERVED（敌方最后已知位置·观测子集）";

    // ---- fixture：录像者在 1 队，2 名敌方（2001 有 OBSERVED 记录，2002 无记录） ----

    private static Battle battle() {
        final PlayerResult rec = player(1001L, 1, 4481, "Kranvagn", "rec1");
        final PlayerResult ally = player(1002L, 1, 4481, "Kranvagn", "Ally");
        final PlayerResult enemyOne = player(2001L, 2, 10785, "T110E5", "EnemyOne");
        final PlayerResult enemyTwo = player(2002L, 2, 10785, "T110E5", "EnemyTwo");
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 300.0;
        b.recorder = "rec1";
        b.players = List.of(rec, ally, enemyOne, enemyTwo);
        return b;
    }

    private static PlayerResult player(final long accountId, final int team, final long tankId,
                                       final String tankName, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.tankName = tankName;
        p.nickname = nickname;
        p.survived = true;
        p.damageDealt = 1000;
        p.damageReceived = 800;
        return p;
    }

    private static VehicleState observedVehicle(final int entityId, final long accountId,
                                                final int team, final float x, final float z) {
        final VehicleState vs = new VehicleState(entityId, START_RAW + 95f);
        vs.setAccountId(accountId);
        vs.setTeam(team);
        vs.setTankId(10785);
        vs.setLastObservedAt(START_RAW + 95f);
        vs.setPosition(new Vector3(x, 0f, z));
        vs.setObservationState(ObservationState.OBSERVED);
        return vs;
    }

    /**
     * 最终快照：我方 (0,0) 与 (100,0) 观察中 → 质心 (50,0)；敌方 2001 在 (250,0)；2002 无记录。
     */
    private static ReplayReconstruction recon() {
        final Map<Integer, VehicleState> vehicles = new HashMap<>();
        vehicles.put(1, observedVehicle(1, 1001L, 1, 0f, 0f));
        vehicles.put(2, observedVehicle(2, 1002L, 1, 100f, 0f));
        vehicles.put(3, observedVehicle(3, 2001L, 2, 250f, 0f));
        final VehicleState hiddenEnemy = new VehicleState(4, START_RAW);
        hiddenEnemy.setAccountId(2002L);
        hiddenEnemy.setTeam(2);
        hiddenEnemy.setObservationState(ObservationState.UNKNOWN);
        vehicles.put(4, hiddenEnemy);
        final BattleStateSnapshot snapshot = new BattleStateSnapshot(
                START_RAW + 300f, 300f, BattleLifecycle.FINISHED, vehicles,
                Map.of(1001L, 1, 1002L, 2, 2001L, 3, 2002L, 4),
                List.of(new BattleParticipant(1001L, "rec1", 1, 4481, "Kranvagn", true)),
                true, 1);
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 1, "rec1", "", 300.0, 0L);
        return new ReplayReconstruction(
                meta, new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15),
                300f, START_RAW,
                List.of(new BattleParticipant(1001L, "rec1", 1, 4481, "Kranvagn", true)),
                List.of(),
                List.of(new BattleStateCheckpoint(START_RAW + 300f, 0, snapshot)),
                snapshot,
                new ReplayCoverage(true, 1, 1, 0, 0, 0, 1.0, Map.of()),
                new ReplayStreamDiagnostics(0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(),
                        true, START_RAW, true));
    }

    private static String sectionOf(final String content) {
        final int start = content.indexOf(SECTION_HEADER);
        assertTrue(start >= 0, "content must contain enemy last-known-position section:\n" + content);
        final int end = content.indexOf('\n', start);
        // 返回段头所在行之后到下一个 === 段头（或结尾）之间的文本
        final String rest = content.substring(start);
        final int nextHeader = rest.indexOf("\n===", 1);
        return nextHeader < 0 ? rest : rest.substring(0, nextHeader);
    }

    // ---- 团队 single ----

    @Test
    void teamSingleInjectsObservedSubsetSection() {
        final SingleTeamBattleAnalysisContext ctx = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle(), 1,
                null, null, List.of(), recon());
        final String content = TeamAiPromptBuilder.single(ctx).content();
        final String section = sectionOf(content);

        assertTrue(section.contains("observedCount=1"), section);
        assertTrue(section.contains("totalCount=2"), section);
        assertTrue(section.contains("confidence=部分"), section);
        assertTrue(section.contains("opponent accountId=2001"), section);
        assertTrue(section.contains("nickname=\"EnemyOne\""), section);
        assertTrue(section.contains("tank=\""), section);
        assertTrue(section.contains("region="), section);
        assertTrue(section.contains("distanceMeters=200.0"), section);
        assertTrue(section.contains("lastObserved=1分35秒"), "时间必须 X分XX秒：" + section);
        // UNKNOWN 语义：2002 无 OBSERVED 记录 → 显式 UNKNOWN 行，不带位置/时间
        assertTrue(section.contains("accountId=2002"), section);
        assertTrue(section.contains("lastKnownPosition=UNKNOWN"), section);
        assertFalse(section.contains("distanceMeters=UNKNOWN"),
                "UNKNOWN 行不得输出距离键：" + section);
        // 观测子集口径：不得伪装全知
        assertTrue(section.contains("观测子集"), section);
        assertTrue(section.contains("可能已变化"), section);
    }

    @Test
    void teamSingleSectionHasNoRawTeamAndNoBareSeconds() {
        final SingleTeamBattleAnalysisContext ctx = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle(), 1,
                null, null, List.of(), recon());
        final String content = TeamAiPromptBuilder.single(ctx).content();
        final String section = sectionOf(content);

        assertFalse(section.contains("team="), "raw team 不得进入 prompt 段：" + section);
        assertFalse(section.contains("perspectiveTeam"), section);
        assertFalse(section.contains("95.0"), "裸秒数不得出现（时间为 95s → 1分35秒）：" + section);
        assertFalse(section.matches("(?s).*lastObserved=\\d+[.\\d]*s\\b.*"),
                "lastObserved 必须 X分XX秒：" + section);
    }

    @Test
    void teamSingleSkipsSectionWithoutReconstruction() {
        final SingleTeamBattleAnalysisContext ctx = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle(), 1,
                null, null, List.of(), null);
        final String content = TeamAiPromptBuilder.single(ctx).content();
        assertFalse(content.contains(SECTION_HEADER), "无重建时不得注入该段");
    }

    // ---- 随机战 harness（Call #2） ----

    private static TacticalReviewPromptBuilder.PreparedHarnessPrompt prepareHarness(
            final int contextWindow) {
        return TacticalReviewPromptBuilder.prepare(
                new PreBattleStrategicPrior(
                        new PreBattleStrategicPrior.TeamProfile(
                                Map.of(), List.of(), List.of(), List.of()),
                        new PreBattleStrategicPrior.TeamProfile(
                                Map.of(), List.of(), List.of(), List.of()),
                        List.of(), List.of(), List.of()),
                new EvidenceSkillResult(List.of(), List.of(), List.of()),
                battle(),
                recon(),
                new PlayerBattleFeatureSet(List.of(), List.of(), List.of(), List.of(), List.of(), true),
                new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT),
                ESTIMATOR,
                100_000,
                contextWindow,
                8192,
                1000);
    }

    @Test
    void harnessInjectsEnemyLastKnownPositions() {
        final String content = prepareHarness(131_072).userContent();
        final String section = sectionOf(content);

        // 敌方 = 非录像者队伍：只出现敌方 2001 的行，我方车辆不进入
        assertTrue(section.contains("敌方 \"EnemyOne\""), section);
        assertFalse(section.contains("1002"), "我方车辆不得出现在敌方位置段：" + section);
        assertTrue(section.contains("距你方主力质心: 200.0m"), section);
        assertTrue(section.contains("最后观察时间: 1分35秒"), section);
        assertTrue(section.contains("敌方 \"EnemyTwo\""), section);
        assertTrue(section.contains("UNKNOWN（未观察到该车位置记录）"), section);
        assertFalse(section.contains("录像者"), "不得以「录像者」指代自己：" + section);
        assertFalse(section.contains("team="), "raw team 不得进入 prompt 段：" + section);
        assertFalse(section.contains("95.0"), "裸秒数不得出现：" + section);
    }

    @Test
    void harnessDropsSectionWhenBudgetExceededButKeepsBookends() {
        final var prepared = prepareHarness(2000);
        final String content = prepared.userContent();
        assertTrue(prepared.truncated());
        assertFalse(content.contains(SECTION_HEADER),
                "证据段超预算时必须可省略：" + content);
        assertTrue(content.contains("BATTLE SNAPSHOT"), "书签段不得被裁剪");
        assertTrue(content.contains("PRE-BATTLE STRATEGIC PRIOR"), "书签段不得被裁剪");
        assertTrue(content.contains("======================== TASK"), "书签段不得被裁剪");
    }

    @Test
    void harnessSkipsSectionWithoutReconstruction() {
        final String content = TacticalReviewPromptBuilder.prepare(
                null,
                new EvidenceSkillResult(List.of(), List.of(), List.of()),
                battle(),
                null,
                new PlayerBattleFeatureSet(List.of(), List.of(), List.of(), List.of(), List.of(), true),
                new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT),
                ESTIMATOR,
                100_000,
                131_072,
                8192,
                1000).userContent();
        assertFalse(content.contains(SECTION_HEADER), "无重建时 harness 不得注入该段");
    }

    // ---- fallback（随机战旧路径） ----

    @Test
    void fallbackInjectsEnemyLastKnownPositions() {
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFallback(battle(), recon());
        final String content = prepared.userPrompt();
        final String section = sectionOf(content);

        assertTrue(section.contains("敌方 \"EnemyOne\""), section);
        assertTrue(section.contains("坦克: \""), section);
        assertTrue(section.contains("距你方主力质心: 200.0m"), section);
        assertTrue(section.contains("最后观察时间: 1分35秒"), section);
        assertTrue(section.contains("最后已知位置: UNKNOWN（未观察到该车位置记录）"), section);
        assertFalse(section.contains("录像者"), "不得以「录像者」指代自己：" + section);
        assertFalse(section.contains("team="), section);
        assertFalse(section.matches("(?s).*\\d+s\\b.*"),
                "不得输出裸秒数（时间必须 X分XX秒）：" + section);
    }

    @Test
    void fallbackWithoutReconstructionOmitsSectionWithoutBreakingPrompt() {
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFallback(battle(), null);
        final String content = prepared.userPrompt();
        assertFalse(content.contains(SECTION_HEADER));
        assertTrue(content.contains("位置时间线: 不可用"), "无重建时 fallback 其余内容不受影响");
        assertNotNull(prepared.systemPrompt());
    }

    // ---- 完整特征路径（prepareFull） ----

    @Test
    void fullPathInjectsEnemyLastKnownPositions() {
        final SinglePlayerBattleAnalysisContext ctx = new SinglePlayerBattleAnalysisContext(
                null, battle(), new PlayerBattleFeatureSet(
                List.of(), List.of(), List.of(), List.of(), List.of(), true),
                new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT),
                new ReplayCoverage(true, 1, 1, 0, 0, 0, 1.0, Map.of()), List.of());
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFull(
                ctx, recon(), ESTIMATOR, 100_000, 131_072, 8192, 1000);
        final String content = prepared.userPrompt();
        final String section = sectionOf(content);
        assertTrue(section.contains("敌方 \"EnemyOne\""), section);
        assertTrue(section.contains("最后观察时间: 1分35秒"), section);
        assertFalse(section.contains("录像者"), section);
    }
}
