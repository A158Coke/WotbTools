package com.wotb.core.replay.evidence;

import com.wotb.core.replay.evidence.TeamGroundingFacts.AliveTransition;
import com.wotb.core.replay.evidence.TeamGroundingFacts.EvidenceFact;
import com.wotb.core.replay.evidence.TeamGroundingFacts.GroundingFacts;
import com.wotb.core.replay.evidence.TeamGroundingFacts.RegionSnapshot;
import com.wotb.core.replay.evidence.TeamGroundingFacts.Side;
import com.wotb.core.replay.evidence.TeamFactualConsistencyValidator.FactConflict;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Natural Coach 轮：Team Review 事实一致性 Validator（G1–G5 golden cases + V1–V6 检查项）。
 * <p>核心原则（docs/current-plan.md §11–§15）：Validator 只检查「LLM 有没有改写 Backend 事实」，
 * 绝不判断战术观点——G3/G5 与「应该先回收/保持分兵/换血」等 coaching judgment 必须 PASS。</p>
 */
class TeamFactualConsistencyValidatorTest {

    // ===== fixture：真实 canonical 类似（112.4/121.3/128.1/131.8 + 7v7→4v6 + 位置快照） =====

    private static final EvidenceFact E101 = death("E101", Side.FRIENDLY, 112.4, 1L, "__WildCat_", "SPHT");
    private static final EvidenceFact E102 = death("E102", Side.FRIENDLY, 121.3, 2L, "Azusa", "SPHT");
    private static final EvidenceFact E103 = death("E103", Side.FRIENDLY, 131.8, 3L, "FFFNuit", "Maus");
    private static final EvidenceFact E104 = death("E104", Side.ENEMY, 128.1, 4L, "Fe1ix", "60TP");

    private static EvidenceFact death(final String id, final Side side, final double sec,
                                      final long account, final String nickname, final String tank) {
        return new EvidenceFact(id, TeamGroundingFacts.TYPE_PLAYER_DESTROYED, side, sec, sec,
                account, nickname, tank, Map.of());
    }

    private static GroundingFacts facts() {
        final Map<String, String> winAttrs = new LinkedHashMap<>();
        winAttrs.put("friendlyDeaths", "3");
        winAttrs.put("enemyDeaths", "1");
        winAttrs.put("beforeFriendly", "7");
        winAttrs.put("beforeEnemy", "7");
        winAttrs.put("afterFriendly", "4");
        winAttrs.put("afterEnemy", "6");
        final EvidenceFact window = new EvidenceFact("E105",
                TeamGroundingFacts.TYPE_FOCUS_WINDOW, Side.FRIENDLY, 109.0, 128.0,
                null, null, null, winAttrs);

        final Map<String, String> regionAttrs = new LinkedHashMap<>();
        regionAttrs.put("friendly", "GRID6=5 GRID5=1 GRID3=1");
        regionAttrs.put("enemyCurrent", "");
        final EvidenceFact region = new EvidenceFact("E106",
                TeamGroundingFacts.TYPE_POSITION_REGION, Side.FRIENDLY, 112.0, 112.0,
                null, null, null, regionAttrs);

        final Map<String, String> lastKnownAttrs = new LinkedHashMap<>();
        lastKnownAttrs.put("region", "5");
        lastKnownAttrs.put("knowledge", "LAST_KNOWN");
        lastKnownAttrs.put("observedAtSec", "117.0");
        lastKnownAttrs.put("ageSec", "3.0");
        final EvidenceFact lastKnown = new EvidenceFact("E107",
                TeamGroundingFacts.TYPE_ENEMY_POSITION, Side.ENEMY, 120.0, 120.0,
                5L, "Maus", "Maus", lastKnownAttrs);

        final List<EvidenceFact> facts = List.of(E101, E102, E103, E104, window, region, lastKnown);
        final List<AliveTransition> transitions = List.of(
                new AliveTransition(112.4, 7, 7, 6, 7),
                new AliveTransition(121.3, 6, 7, 5, 7),
                new AliveTransition(128.1, 5, 7, 5, 6),
                new AliveTransition(131.8, 5, 6, 4, 6));
        final Map<String, Integer> friendly = new LinkedHashMap<>();
        friendly.put("GRID6", 5);
        friendly.put("GRID5", 1);
        friendly.put("GRID3", 1);
        final List<RegionSnapshot> snapshots = List.of(
                new RegionSnapshot(112.0, Map.copyOf(friendly), Map.of()));
        final List<TeamGroundingFacts.EnemyPositionSample> enemy = List.of(
                new TeamGroundingFacts.EnemyPositionSample(
                        120.0, 5L, "Maus", "Maus", "5", "LAST_KNOWN", 117.0, 3.0));
        return new GroundingFacts(facts, Map.of(), transitions, snapshots, enemy);
    }

    private static TeamReviewEnvelope envelope(final String markdown) {
        return new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                markdown, List.of());
    }

    private static TeamReviewEnvelope envelope(final TeamReviewEnvelope.PrimaryDiagnosis diagnosis,
                                               final String markdown,
                                               final List<TeamReviewEnvelope.Claim> claims) {
        return new TeamReviewEnvelope(diagnosis, markdown, claims);
    }

    private static boolean hasCheck(final List<FactConflict> conflicts, final String checkId) {
        return conflicts.stream().anyMatch(c -> c.checkId().equals(checkId));
    }

    // ===== G1：V1 temporal ownership =====

    @Test
    void g1DeathOutsideStatedWindowFails() {
        // G1：1:49–2:08（109–128s）这段死了 WildCat/Azusa/FFFNuit —— FFFNuit 131.8s 超出窗口
        final TeamReviewEnvelope env = envelope(
                "1分49秒至2分08秒这段本队死了WildCat、Azusa、FFFNuit。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V1"),
                "G1 必须 FAIL：FFFNuit 131.8s 超出 109–128s 窗口: " + conflicts);
        assertTrue(conflicts.stream().anyMatch(c -> c.message().contains("FFFNuit")),
                "V1 冲突必须点名越界玩家 FFFNuit: " + conflicts);
    }

    @Test
    void v1ClaimCitingOutOfWindowDeathFails() {
        // structured path：claim 声称窗口 1分49秒-2分08秒 却引用 E103（131.8s）
        final TeamReviewEnvelope env = envelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "## 团队复盘\n\n这波交换后人数从7v7变成4v6。",
                List.of(new TeamReviewEnvelope.Claim(
                        "1分49秒-2分08秒这段本队死了WildCat、Azusa、FFFNuit", List.of("E103"))));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V1"), "structured V1 必须 FAIL: " + conflicts);
    }

    @Test
    void deathInsideWindowPasses() {
        final TeamReviewEnvelope env = envelope(
                "1分49秒至2分08秒这段本队死了WildCat、Azusa。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "V1"),
                "窗口内阵亡必须 PASS: " + conflicts);
    }

    // ===== V2：player event correctness =====

    @Test
    void v2WrongDeathTimeFails() {
        final TeamReviewEnvelope env = envelope("WildCat 121秒阵亡。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V2"),
                "V2 必须 FAIL：WildCat 后端 112.4s，正文 121s: " + conflicts);
    }

    @Test
    void v2CorrectDeathTimePasses() {
        final TeamReviewEnvelope env = envelope("WildCat 112秒左右被带走。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "V2"),
                "V2 正确时间必须 PASS: " + conflicts);
    }

    // ===== V3：alive transition =====

    @Test
    void v3WrongTransitionFails() {
        final TeamReviewEnvelope env = envelope("人数直接从7v7变成3v5。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V3"),
                "V3 必须 FAIL：后端只有 7v7→4v6（窗口级），没有 7v7→3v5: " + conflicts);
    }

    @Test
    void v3CorrectWindowTransitionPasses() {
        final TeamReviewEnvelope env = envelope("人数直接从7v7变成4v6。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "V3"),
                "V3 窗口级 7v7→4v6 必须 PASS: " + conflicts);
    }

    // ===== G2：V4 position temporal grounding =====

    @Test
    void g2SevenVehiclesAllInGrid6At112sFails() {
        // G2：112s 快照 GRID6=5 GRID5=1 GRID3=1，正文「7辆全部在6区」必须 FAIL
        final TeamReviewEnvelope env = envelope("112秒左右本队7辆全部在6区。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V4"),
                "G2 必须 FAIL：112s 快照 GRID6=5: " + conflicts);
    }

    @Test
    void v4RegionCountWithinSnapshotPasses() {
        final TeamReviewEnvelope env = envelope("112秒左右本队5辆在6区，其余在相邻区域。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "V4"),
                "V4 快照内数量必须 PASS: " + conflicts);
    }

    // ===== V5：CURRENT / LAST_KNOWN =====

    @Test
    void v5LastKnownClaimedAsCurrentFails() {
        final TeamReviewEnvelope env = envelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "## 团队复盘\n\n这波交换后人数从7v7变成4v6。",
                List.of(new TeamReviewEnvelope.Claim("Maus 此时就在这里", List.of("E107"))));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V5"),
                "V5 必须 FAIL：LAST_KNOWN 不得写成「此时就在这里」: " + conflicts);
    }

    @Test
    void v5LastKnownWordingPasses() {
        final TeamReviewEnvelope env = envelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "## 团队复盘\n\n这波交换后人数从7v7变成4v6。",
                List.of(new TeamReviewEnvelope.Claim("Maus 最后一次观测在1分57秒", List.of("E107"))));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "V5"),
                "V5 LAST_KNOWN 措辞正确必须 PASS: " + conflicts);
    }

    // ===== G4：V6 unsupported hard facts =====

    @Test
    void g4AllEnemyTanksHaveDirectFireLineFails() {
        final TeamReviewEnvelope env = envelope("这波对方所有车辆都拥有直接炮线。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V6"),
                "G4 必须 FAIL：无 LOS 证据的硬事实断言: " + conflicts);
    }

    @Test
    void v6DowngradedHardFactPasses() {
        final TeamReviewEnvelope env = envelope("从交换结果看，这波对方所有车辆都拥有直接炮线。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "V6"),
                "V6 降级表达必须 PASS: " + conflicts);
    }

    // ===== G3 / G5：tactical opinion & coaching must PASS（Validator 不判断战术观点） =====

    @Test
    void g3TacticalJudgmentPasses() {
        final TeamReviewEnvelope env = envelope("第一轮交换节奏是这局最大的团队问题。");
        assertEquals(List.of(), TeamFactualConsistencyValidator.validate(env, facts()),
                "G3 战术判断必须 PASS");
    }

    @Test
    void g5CoachingRecommendationPasses() {
        final TeamReviewEnvelope env = envelope(
                "如果让我只改一件事，我会要求第一辆车被压血后马上重新分配下一轮交换。");
        assertEquals(List.of(), TeamFactualConsistencyValidator.validate(env, facts()),
                "G5 coaching 建议必须 PASS");
    }

    @Test
    void tacticalOpinionsAreNeverJudged() {
        // §12：Validator 不得判断战术观点；下面这些即使 Backend 无法数学证明也必须 PASS
        final TeamReviewEnvelope env = envelope(
                "我认为这局主要问题是第一次正面交换。应该先回收、保持分兵、换血，"
                        + "让血量更健康的车顶上去。这局的交换节奏比站位更重要。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(conflicts.isEmpty(),
                "战术观点一律放行: " + conflicts);
    }

    // ===== 其它边界 =====

    @Test
    void unknownEvidenceIdFails() {
        final TeamReviewEnvelope env = envelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "## 团队复盘\n\n这波交换后人数从7v7变成4v6。",
                List.of(new TeamReviewEnvelope.Claim("WildCat 在1分52秒阵亡", List.of("E999"))));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "EVIDENCE"),
                "引用不存在的证据编号必须 FAIL: " + conflicts);
    }

    @Test
    void missingPrimaryDiagnosisFails() {
        final TeamReviewEnvelope env = new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("", "理由", List.of()),
                "## 团队复盘\n\n这是一段复盘。", List.of());
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "DIAGNOSIS"),
                "缺少主判断必须 FAIL: " + conflicts);
    }

    @Test
    void evidenceIdsMustNotLeakIntoUserMarkdown() {
        final TeamReviewEnvelope env = envelope(
                "根据 E101 的阵亡时间，WildCat 在1分52秒阵亡。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "INTERNAL"),
                "证据编号不得进入用户正文: " + conflicts);
    }

    // ===== Review B1-2：机器结构化校验（语言无关，三语通用） =====

    private static TeamReviewEnvelope.Claim machineClaim(final String text, final String claimType,
                                                         final Double timeSec, final Integer region,
                                                         final Integer count, final String subject,
                                                         final String value, final String... ids) {
        return new TeamReviewEnvelope.Claim(text, List.of(ids), claimType, timeSec, region, count, subject, value);
    }

    private static TeamReviewEnvelope envWith(final TeamReviewEnvelope.Claim... claims) {
        return new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "## 团队复盘\n\n这波交换后人数从7v7变成4v6。",
                List.of(claims));
    }

    @Test
    void machineDeathTimeClaimWrongFails() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "WildCat died at 121 seconds", "DEATH", 121.0, null, null, "WildCat", null, "E101"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V2"),
                "structured timeSec 与后端阵亡时间不符必须 FAIL（V2）: "
                        + TeamFactualConsistencyValidator.validate(env, facts()));
    }

    @Test
    void machineDeathTimeClaimCorrectPasses() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "WildCat died around 112 seconds", "DEATH", 112.4, null, null, "WildCat", null, "E101"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V2"),
                "structured timeSec 与后端一致必须 PASS");
    }

    @Test
    void machineTransitionValueWrongFails() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "The exchange left us at a disadvantage", "ALIVE_TRANSITION",
                null, null, null, null, "7v7 -> 3v5"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V3"),
                "machine value 7v7 -> 3v5 与后端 7v7→4v6 冲突必须 FAIL（V3）");
    }

    @Test
    void machineTransitionValueCorrectPasses() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "The exchange changed the numbers", "ALIVE_TRANSITION",
                null, null, null, null, "7v7 -> 4v6"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V3"),
                "machine value 7v7 -> 4v6 必须 PASS");
    }

    // ---- B2-2：V4 精确语义（exact == actual；at-least/subset ≤ actual） ----

    @Test
    void machinePositionExactOverCountFails() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "7 vehicles in region 6", "POSITION_REGION", 112.0, 6, 7, null, null, "E106"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "structured over-count 必须 FAIL（快照 GRID6=5）");
    }

    @Test
    void machinePositionExactUnderCountFails() {
        // B2-2：精确语义下的少报（3 != 5）同样是事实不一致
        final TeamReviewEnvelope env = envWith(machineClaim(
                "3 vehicles in region 6", "POSITION_REGION", 112.0, 6, 3, null, null, "E106"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V4"),
                "structured under-count exact 必须 FAIL（快照 GRID6=5，claim=3）: " + conflicts);
    }

    @Test
    void machinePositionSubsetPasses() {
        // 「其中 3 辆」（subset）是合法部分陈述
        final TeamReviewEnvelope env = envWith(machineClaim(
                "3 of them in region 6", "POSITION_REGION", 112.0, 6, 3, null, null, "E106"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "subset 陈述必须 PASS");
    }

    @Test
    void machinePositionAtLeastPasses() {
        // 「至少 3 辆」（at least）是合法下界陈述
        final TeamReviewEnvelope env = envWith(machineClaim(
                "at least 3 vehicles in region 6", "POSITION_REGION", 112.0, 6, 3, null, null, "E106"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "at-least 陈述必须 PASS");
    }

    @Test
    void machinePositionExactEqualPasses() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "5 vehicles in region 6", "POSITION_REGION", 112.0, 6, 5, null, null, "E106"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "exact count == 快照 必须 PASS");
    }

    // ---- V6m：claim 显式声明 LOS/SPOTTING 事实类型 ----

    @Test
    void machineClaimTypeLosFails() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "The enemy had full LOS", "LOS", null, null, null, null, null));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V6"),
                "claimType=LOS（后端无 evidence kind）必须 FAIL");
    }

    @Test
    void machineClaimTypeTacticalWithHedgePasses() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "full LOS was likely, judging from the exchange", "TACTICAL",
                null, null, null, null, null));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V6"),
                "TACTICAL + 降级表达必须 PASS");
    }

    // ===== Review B1-2：EN / RU 正文回归（三语 factual guard） =====

    @Test
    void enWrongDeathTimeFails() {
        final TeamReviewEnvelope env = envelope("WildCat died at 121 sec.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V2"),
                "EN 错误阵亡时间必须 FAIL（V2）");
    }

    @Test
    void ruWrongDeathTimeFails() {
        final TeamReviewEnvelope env = envelope("WildCat погиб на 121 сек.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V2"),
                "RU 错误阵亡时间必须 FAIL（V2）");
    }

    @Test
    void enMachineTimeFormatFails() {
        final TeamReviewEnvelope env = envelope("WildCat died at 1m49s.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V2"),
                "EN 1m49s 与后端 112.4s 不符必须 FAIL（V2）");
    }

    @Test
    void enWrongTransitionFails() {
        final TeamReviewEnvelope env = envelope("The team went from 7v7 to 3v5.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V3"),
                "EN 错误存活变化必须 FAIL（V3）");
    }

    @Test
    void enCorrectTransitionPasses() {
        final TeamReviewEnvelope env = envelope("The team went from 7v7 to 4v6.");
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V3"),
                "EN 正确存活变化必须 PASS");
    }

    @Test
    void enWrongRegionCountFails() {
        final TeamReviewEnvelope env = envelope("At 112 seconds, 7 vehicles in region 6.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "EN 位置数量超过快照必须 FAIL（V4）");
    }

    @Test
    void ruWrongRegionCountFails() {
        final TeamReviewEnvelope env = envelope("На 112 сек 7 машин в 6-й зоне.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "RU 位置数量超过快照必须 FAIL（V4）");
    }

    @Test
    void enLastKnownAsCurrentFails() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "The Maus is right here now", "LAST_KNOWN", null, null, null, "Maus", null, "E107"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V5"),
                "EN LAST_KNOWN 写成当前必须 FAIL（V5）");
    }

    @Test
    void ruLastKnownAsCurrentFails() {
        final TeamReviewEnvelope env = envWith(machineClaim(
                "Maus сейчас находится в 5-й зоне", "LAST_KNOWN", null, null, null, "Maus", null, "E107"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V5"),
                "RU LAST_KNOWN 写成当前必须 FAIL（V5）");
    }

    @Test
    void enLosHardFactFails() {
        final TeamReviewEnvelope env = envelope("The enemy had full LOS on that push.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V6"),
                "EN 无证据 LOS 硬断言必须 FAIL（V6）");
    }

    @Test
    void ruLosHardFactFails() {
        final TeamReviewEnvelope env = envelope("У противника была полная линия огня.");
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V6"),
                "RU 无证据 LOS 硬断言必须 FAIL（V6）");
    }

    @Test
    void enLegalCoachingPasses() {
        final TeamReviewEnvelope env = envelope(
                "I think the main problem was the first engagement. "
                        + "We should have redistributed the next trade after the first tank dropped.");
        assertEquals(List.of(), TeamFactualConsistencyValidator.validate(env, facts()),
                "EN 合法战术观点/建议必须 PASS");
    }

    @Test
    void ruLegalCoachingPasses() {
        final TeamReviewEnvelope env = envelope(
                "Я считаю, главная проблема — первый обмен. "
                        + "Нужно было перераспределить следующий обмен после потери первой машины.");
        assertEquals(List.of(), TeamFactualConsistencyValidator.validate(env, facts()),
                "RU 合法战术观点/建议必须 PASS");
    }

    @Test
    void emptyReviewMarkdownFails() {
        final TeamReviewEnvelope env = new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "   ", List.of());
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "OUTPUT"), "空正文必须 FAIL: " + conflicts);
    }
}
