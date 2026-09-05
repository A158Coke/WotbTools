package com.wotb.core.replay.evidence;

import com.wotb.core.replay.evidence.TeamFactualConsistencyValidator.FactConflict;
import com.wotb.core.replay.evidence.TeamGroundingFacts.AliveTransition;
import com.wotb.core.replay.evidence.TeamGroundingFacts.EvidenceFact;
import com.wotb.core.replay.evidence.TeamGroundingFacts.GroundingFacts;
import com.wotb.core.replay.evidence.TeamGroundingFacts.RegionSnapshot;
import com.wotb.core.replay.evidence.TeamGroundingFacts.Side;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Natural Coach 轮：Team Review 事实一致性 Validator（G1–G5 golden cases + V1–V6 检查项）。
 * <p>核心原则：Validator 只检查「LLM 有没有改写 Backend 事实」，
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
        regionAttrs.put("enemyCurrent", "GRID4=2");
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

        final Map<String, String> transitionAttrs = new LinkedHashMap<>();
        transitionAttrs.put("before", "6v7");
        transitionAttrs.put("after", "5v7");
        final EvidenceFact transition = new EvidenceFact("E108",
                TeamGroundingFacts.TYPE_ALIVE_TRANSITION, Side.FRIENDLY, 121.3, 121.3,
                null, null, null, transitionAttrs);

        final Map<String, String> sphtAttrs = new LinkedHashMap<>();
        sphtAttrs.put("region", "6");
        sphtAttrs.put("knowledge", "LAST_KNOWN");
        sphtAttrs.put("observedAtSec", "106.0");
        sphtAttrs.put("ageSec", "6.0");
        final EvidenceFact sphtPos = new EvidenceFact("E109",
                TeamGroundingFacts.TYPE_ENEMY_POSITION, Side.ENEMY, 112.0, 112.0,
                2001L, "SPHT", "IS-7", sphtAttrs);
        final Map<String, String> spht2Attrs = new LinkedHashMap<>();
        spht2Attrs.put("region", "6");
        spht2Attrs.put("knowledge", "LAST_KNOWN");
        spht2Attrs.put("observedAtSec", "106.0");
        spht2Attrs.put("ageSec", "6.0");
        final EvidenceFact spht2Pos = new EvidenceFact("E110",
                TeamGroundingFacts.TYPE_ENEMY_POSITION, Side.ENEMY, 112.0, 112.0,
                2002L, "SPHT2", "IS-7", spht2Attrs);

        final List<EvidenceFact> facts = List.of(E101, E102, E103, E104, window, region,
                lastKnown, transition, sphtPos, spht2Pos);
        final List<AliveTransition> transitions = List.of(
                new AliveTransition(112.4, 7, 7, 6, 7),
                new AliveTransition(121.3, 6, 7, 5, 7),
                new AliveTransition(128.1, 5, 7, 5, 6),
                new AliveTransition(131.8, 5, 6, 4, 6));
        final Map<String, Integer> friendly = new LinkedHashMap<>();
        friendly.put("GRID6", 5);
        friendly.put("GRID5", 1);
        friendly.put("GRID3", 1);
        final Map<String, Integer> enemyCurrent = new LinkedHashMap<>();
        enemyCurrent.put("GRID4", 2);
        final List<RegionSnapshot> snapshots = List.of(
                new RegionSnapshot(112.0, Map.copyOf(friendly), Map.copyOf(enemyCurrent)));
        final List<TeamGroundingFacts.EnemyPositionSample> enemy = List.of(
                new TeamGroundingFacts.EnemyPositionSample(
                        120.0, 5L, "Maus", "Maus", "5", "LAST_KNOWN", 117.0, 3.0),
                new TeamGroundingFacts.EnemyPositionSample(
                        112.0, 2001L, "SPHT", "IS-7", "6", "LAST_KNOWN", 106.0, 6.0),
                new TeamGroundingFacts.EnemyPositionSample(
                        112.0, 2002L, "SPHT2", "IS-7", "6", "LAST_KNOWN", 106.0, 6.0));
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

    @Test
    void noConfirmedErrorConclusionPassesGrounding() {
        final TeamReviewEnvelope env = new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis(
                        "本场没有发现足以作为主要问题的明显执行失误",
                        "现有事实未显示明确的团队执行断层；对方在中盘处理得更有效。",
                        List.of()),
                "## 团队复盘\n\n本场没有发现足以作为主要问题的明显执行失误。",
                List.of());

        assertTrue(TeamFactualConsistencyValidator.validate(
                env, new GroundingFacts(List.of(), Map.of(), List.of(), List.of(), List.of())).isEmpty(),
                "无明显错误是合法主结论，不应被 grounding validator 强制改成问题");
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

    @Test
    void conservativeLastKnownRecoveryKeepsTacticalValueAndPasses() {
        final TeamReviewEnvelope env = envelope(
                "侧翼压力形成后，主力正面的交战条件明显恶化；复盘时应重点检查侧翼失去控制后"
                        + "主力是否及时调整。Maus 最后一次观测在1分57秒，之后位置未知。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "V5"),
                "保留战术判断并将 CURRENT 降级为 LAST_KNOWN 后必须 PASS: " + conflicts);
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

    @Test
    void unsupportedSpotterAttributionFailsButEvidenceBoundedGeneralizationPasses() {
        final TeamReviewEnvelope unsupported = envelope("IS-4点亮了敌方5台。\n");
        final List<FactConflict> unsupportedConflicts =
                TeamFactualConsistencyValidator.validate(unsupported, facts());
        assertTrue(unsupportedConflicts.stream().anyMatch(c -> "V6".equals(c.checkId())
                        && c.severity() == TeamFactualConsistencyValidator.Severity.HARD_FACT),
                "无 dedicated spotting evidence 的具体点亮归因必须保持 HARD_FACT: " + unsupportedConflicts);

        final TeamReviewEnvelope conservative = envelope(
                "该阶段可确认敌方曾在GRID6出现；侧翼压力形成后，主力正面的交战条件明显恶化。");
        assertTrue(TeamFactualConsistencyValidator.validate(conservative, facts()).isEmpty(),
                "删除具体 spotter attribution 后，应允许保留有证据边界的概括战术判断");
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
        // Validator 不得判断战术观点；下面这些即使 Backend 无法数学证明也必须 PASS
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

    // ===== ：机器结构化校验（语言无关，三语通用） =====

    private static TeamReviewEnvelope.Claim machineClaim(final String text, final String claimType,
                                                         final Double timeSec, final Integer region,
                                                         final Integer count, final String subject,
                                                         final String value, final String... ids) {
        return new TeamReviewEnvelope.Claim(
                text, List.of(ids), claimType, timeSec, region, count, subject, value,
                null, null, null, null);
    }

    /** 完整机器字段 helper：side / countSemantics / knowledge。 */
    private static TeamReviewEnvelope.Claim machineClaimFull(
            final String text, final String claimType,
            final Double timeSec, final Integer region, final Integer count,
            final String subject, final String value, final String side,
            final String countSemantics, final String knowledge, final String... ids) {
        return new TeamReviewEnvelope.Claim(
                text, List.of(ids), claimType, timeSec, region, count, subject, value,
                side, countSemantics, knowledge, null);
    }

    /** 完整机器字段 + 稳定身份 helper：subjectAccountId。 */
    private static TeamReviewEnvelope.Claim machineClaimFullAcc(
            final String text, final String claimType,
            final Double timeSec, final Integer region, final Integer count,
            final String subject, final String value, final String side,
            final String countSemantics, final String knowledge, final Long accountId,
            final String... ids) {
        return new TeamReviewEnvelope.Claim(
                text, List.of(ids), claimType, timeSec, region, count, subject, value,
                side, countSemantics, knowledge, accountId);
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

    // ---- V4 精确语义（exact == actual；at-least/subset ≤ actual） ----

    @Test
    void v4ExactOverCountFails() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "7 vehicles in region 6", "POSITION_REGION", 112.0, 6, 7, null, null,
                "FRIENDLY", "EXACT", null, "E106"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "EXACT over-count 必须 FAIL（快照 GRID6=5）");
    }

    @Test
    void v4ExactUnderCountFails() {
        // EXACT 语义下少报（3 != 5）同样是事实不一致
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "3 vehicles in region 6", "POSITION_REGION", 112.0, 6, 3, null, null,
                "FRIENDLY", "EXACT", null, "E106"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V4"),
                "EXACT under-count 必须 FAIL（快照 GRID6=5，claim=3）: " + conflicts);
    }

    @Test
    void v4ExactEqualPasses() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "5 vehicles in region 6", "POSITION_REGION", 112.0, 6, 5, null, null,
                "FRIENDLY", "EXACT", null, "E106"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "EXACT count == 快照 必须 PASS");
    }

    @Test
    void v4AtLeastUnderPasses() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "at least 3 vehicles in region 6", "POSITION_REGION", 112.0, 6, 3, null, null,
                "FRIENDLY", "AT_LEAST", null, "E106"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "AT_LEAST 3 ≤ actual 5 必须 PASS");
    }

    @Test
    void v4AtLeastOverFails() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "at least 6 vehicles in region 6", "POSITION_REGION", 112.0, 6, 6, null, null,
                "FRIENDLY", "AT_LEAST", null, "E106"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "AT_LEAST 6 > actual 5 必须 FAIL");
    }

    @Test
    void v4SubsetUnderPasses() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "3 of them in region 6", "POSITION_REGION", 112.0, 6, 3, null, null,
                "FRIENDLY", "SUBSET", null, "E106"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "SUBSET 3 ≤ actual 5 必须 PASS");
    }

    @Test
    void v4SubsetOverFails() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "6 of them in region 6", "POSITION_REGION", 112.0, 6, 6, null, null,
                "FRIENDLY", "SUBSET", null, "E106"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V4"),
                "SUBSET 6 > actual 5 必须 FAIL");
    }

    @Test
    void v4EnemySideUsesEnemyCurrentCountsNotFriendly() {
        // 后端 enemy current：GRID4=2（fixture snapshot）；FRIENDLY 数不得拿去校验 enemy claim
        final TeamReviewEnvelope enemyExact = envWith(machineClaimFull(
                "2 enemy vehicles in region 4", "POSITION_REGION", 112.0, 4, 2, null, null,
                "ENEMY", "EXACT", null, "E106"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(enemyExact, facts()), "V4"),
                "ENEMY EXACT 2 == enemyCurrent GRID4=2 必须 PASS");
        final TeamReviewEnvelope enemyOver = envWith(machineClaimFull(
                "3 enemy vehicles in region 4", "POSITION_REGION", 112.0, 4, 3, null, null,
                "ENEMY", "EXACT", null, "E106"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(enemyOver, facts()), "V4"),
                "ENEMY EXACT 3 > enemyCurrent GRID4=2 必须 FAIL（不能用 friendly 数比较）");
    }

    @Test
    void v5MachineKnowledgeCurrentVsLastKnownFails() {
        // 后端 Maus @120 LAST_KNOWN（E107）：claim 写 CURRENT → 必须 FAIL（machine，不靠正文短语）
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "The Maus is in region 5 right now", "ENEMY_POSITION", 120.0, 5, null, "Maus",
                null, null, null, "CURRENT", "E107"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V5"),
                "ENEMY_POSITION knowledge=CURRENT vs 后端 LAST_KNOWN 必须 FAIL（V5m）");
    }

    @Test
    void v5MachineKnowledgeLastKnownPasses() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "Maus was last observed in region 5", "ENEMY_POSITION", 120.0, 5, null, "Maus",
                null, null, null, "LAST_KNOWN", "E107"));
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V5"),
                "ENEMY_POSITION knowledge=LAST_KNOWN 与后端一致必须 PASS（V5m）");
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


    // ===== ：Evidence Binding（claim 必须与其 evidenceIds 真正绑定） =====

    @Test
    void b1DeathValidBindingPasses() {
        // E101 = WildCat death @112.4；claim DEATH subject=WildCat timeSec=112.4 → PASS
        final TeamReviewEnvelope env = envWith(machineClaim(
                "WildCat died around 112 seconds", "DEATH", 112.4, null, null, "WildCat", null, "E101"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "BINDING"), "DEATH 正确绑定必须 PASS: " + conflicts);
        assertFalse(hasCheck(conflicts, "V2"), "DEATH 正确时间必须 PASS: " + conflicts);
    }

    @Test
    void b1DeathNonexistentSubjectFails() {
        // subject=GhostPlayer：后端没有该玩家的死亡 → 必须 FAIL（不能静默 PASS）
        final TeamReviewEnvelope env = envWith(machineClaim(
                "GhostPlayer died at 112 seconds", "DEATH", 112.4, null, null, "GhostPlayer", null, "E101"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "DEATH 不存在的 subject（GhostPlayer）必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1DeathWrongEntityFails() {
        // E101 = WildCat death；claim subject=AnotherPlayer 借用 E101 → wrong entity FAIL
        final TeamReviewEnvelope env = envWith(machineClaim(
                "AnotherPlayer died at 112 seconds", "DEATH", 112.4, null, null, "AnotherPlayer", null, "E101"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "DEATH 错误主体（wrong entity）必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1DeathUnrelatedEvidenceTypeFails() {
        // E106 = POSITION_REGION；DEATH claim 借用 E106 → evidence type 不匹配 FAIL
        final TeamReviewEnvelope env = envWith(machineClaim(
                "WildCat died at 112 seconds", "DEATH", 112.4, null, null, "WildCat", null, "E106"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "DEATH 引用无关类型证据必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1TransitionCorrectValueCorrectEvidencePasses() {
        // E105 = FOCUS_WINDOW 7v7→4v6；claim value 一致 → PASS（focus-window aggregate 明确允许）
        final TeamReviewEnvelope env = envWith(machineClaim(
                "The exchange left us at a disadvantage", "ALIVE_TRANSITION",
                null, null, null, null, "7v7 -> 4v6", "E105"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "BINDING"), "ALIVE_TRANSITION 正确证据必须 PASS: " + conflicts);
        assertFalse(hasCheck(conflicts, "V3"), "ALIVE_TRANSITION 正确值必须 PASS: " + conflicts);
    }

    @Test
    void b1TransitionCorrectValueUnrelatedEvidenceFails() {
        // E101 = DEATH；claim value 与全局一致也不能 PASS——必须引用真正的变化证据
        final TeamReviewEnvelope env = envWith(machineClaim(
                "The exchange changed the numbers", "ALIVE_TRANSITION",
                null, null, null, null, "7v7 -> 4v6", "E101"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "ALIVE_TRANSITION 引用无关证据类型必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1TransitionWrongValueCorrectEvidenceFails() {
        // E105 = FOCUS_WINDOW 7v7→4v6；claim value 错误 → 必须 FAIL（不能因全局存在就 PASS）
        final TeamReviewEnvelope env = envWith(machineClaim(
                "The exchange changed the numbers", "ALIVE_TRANSITION",
                null, null, null, null, "7v7 -> 3v5", "E105"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V3"),
                "ALIVE_TRANSITION 错误值与正确证据必须 FAIL（V3）: " + conflicts);
    }

    @Test
    void b1PositionRegionCorrectEvidencePasses() {
        // E106 = POSITION_REGION @112 friendly GRID6=5；claim exact GRID6=5 → PASS
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "5 vehicles in region 6", "POSITION_REGION", 112.0, 6, 5, null, null,
                "FRIENDLY", "EXACT", null, "E106"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "BINDING"), "POSITION_REGION 正确绑定必须 PASS: " + conflicts);
        assertFalse(hasCheck(conflicts, "V4"), "POSITION_REGION 正确数量必须 PASS: " + conflicts);
    }

    @Test
    void b1PositionRegionWrongRegionFails() {
        // E106 friendly 无 GRID2 数据；claim GRID2=5 → 引用证据不支撑该区域 → FAIL
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "5 vehicles in region 2", "POSITION_REGION", 112.0, 2, 5, null, null,
                "FRIENDLY", "EXACT", null, "E106"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "POSITION_REGION 引用证据无该区域数据必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1PositionRegionWrongCountFails() {
        // E106 friendly GRID6=5；claim exact GRID6=3 → count 不匹配 FAIL
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "3 vehicles in region 6", "POSITION_REGION", 112.0, 6, 3, null, null,
                "FRIENDLY", "EXACT", null, "E106"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V4"),
                "POSITION_REGION 数量与引用证据不符必须 FAIL（V4）: " + conflicts);
    }

    @Test
    void b1PositionRegionWrongSideFails() {
        // E106 enemyCurrent = GRID4=2；claim ENEMY GRID6=5 → 引用证据 ENEMY 侧无该区域 → FAIL
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "5 enemy vehicles in region 6", "POSITION_REGION", 112.0, 6, 5, null, null,
                "ENEMY", "EXACT", null, "E106"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "POSITION_REGION ENEMY 侧无该区域必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1EnemyPositionValidBindingPasses() {
        // E109 = SPHT(acc 2001) @112 GRID6 LAST_KNOWN；同身份+112+GRID6+LAST_KNOWN → PASS
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "SPHT was last observed in region 6", "ENEMY_POSITION", 112.0, 6, null, "SPHT",
                null, null, null, "LAST_KNOWN", "E109"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertFalse(hasCheck(conflicts, "BINDING"), "ENEMY_POSITION 正确绑定必须 PASS: " + conflicts);
        assertFalse(hasCheck(conflicts, "V5"), "ENEMY_POSITION 正确 knowledge 必须 PASS: " + conflicts);
    }

    @Test
    void b1EnemyPositionKnowledgeMismatchFails() {
        // E109 LAST_KNOWN；claim CURRENT → knowledge 不匹配 FAIL（V5）
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "SPHT is in region 6 right now", "ENEMY_POSITION", 112.0, 6, null, "SPHT",
                null, null, null, "CURRENT", "E109"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "V5"),
                "ENEMY_POSITION knowledge 与证据不符必须 FAIL（V5）: " + conflicts);
    }

    @Test
    void b1EnemyPositionRegionMismatchFails() {
        // E109 GRID6；claim GRID3 → 区域不匹配 FAIL（不能只因为 CURRENT==CURRENT 就 PASS）
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "SPHT was last observed in region 3", "ENEMY_POSITION", 112.0, 3, null, "SPHT",
                null, null, null, "LAST_KNOWN", "E109"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "ENEMY_POSITION 区域与证据不符必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1EnemyPositionDifferentVehicleFails() {
        // E109 = SPHT(IS-7)；claim subject=OtherVehicle → 身份不匹配 FAIL
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "OtherVehicle was last observed in region 6", "ENEMY_POSITION", 112.0, 6, null, "OtherVehicle",
                null, null, null, "LAST_KNOWN", "E109"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "ENEMY_POSITION 身份与证据不符必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1EnemyPositionUnrelatedEvidenceFails() {
        // E101 = DEATH；ENEMY_POSITION claim 引用死亡证据 → evidence type 不匹配 FAIL
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "SPHT was last observed in region 6", "ENEMY_POSITION", 112.0, 6, null, "SPHT",
                null, null, null, "LAST_KNOWN", "E101"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "ENEMY_POSITION 引用无关类型证据必须 FAIL（BINDING）: " + conflicts);
    }

    @Test
    void b1EnemyPositionDuplicateTankNameNeedsAccountId() {
        // E109 与 E110 都是 IS-7（不同账号）；仅凭 tankName 无法绑定 → FAIL
        final TeamReviewEnvelope tankOnly = envWith(machineClaimFull(
                "IS-7 was last observed in region 6", "ENEMY_POSITION", 112.0, 6, null, "IS-7",
                null, null, null, "LAST_KNOWN", "E109"));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(tankOnly, facts());
        assertTrue(hasCheck(conflicts, "BINDING"),
                "同车型敌车多辆时仅凭 tankName 必须 FAIL（BINDING 身份歧义）: " + conflicts);
        // 使用 subjectAccountId 稳定身份 → PASS
        final TeamReviewEnvelope accBound = envWith(machineClaimFullAcc(
                "SPHT was last observed in region 6", "ENEMY_POSITION", 112.0, 6, null, "SPHT",
                null, null, null, "LAST_KNOWN", 2001L, "E109"));
        final List<FactConflict> accConflicts = TeamFactualConsistencyValidator.validate(accBound, facts());
        assertFalse(hasCheck(accConflicts, "BINDING"),
                "subjectAccountId 稳定身份必须 PASS: " + accConflicts);
    }

    @Test
    void b1TrilingualMachineResultIdentical() {
        // 同一个 structured claim（ENEMY_POSITION GRID 不匹配）：ZH/EN/RU reviewMarkdown → machine 结果一致
        final TeamReviewEnvelope.Claim claim = machineClaimFull(
                "SPHT was last observed in region 3", "ENEMY_POSITION", 112.0, 3, null, "SPHT",
                null, null, null, "LAST_KNOWN", "E109");
        final String zh = "我认为这局主要问题是第一次正面交换。";
        final String en = "I think the main problem was the first engagement.";
        final String ru = "Я считаю, главная проблема — первый обмен.";
        final List<FactConflict> zhConflicts = TeamFactualConsistencyValidator.validate(
                new TeamReviewEnvelope(
                        new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()), zh, List.of(claim)), facts());
        final List<FactConflict> enConflicts = TeamFactualConsistencyValidator.validate(
                new TeamReviewEnvelope(
                        new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()), en, List.of(claim)), facts());
        final List<FactConflict> ruConflicts = TeamFactualConsistencyValidator.validate(
                new TeamReviewEnvelope(
                        new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()), ru, List.of(claim)), facts());
        final java.util.function.Predicate<FactConflict> machine = c ->
                java.util.Set.of("BINDING", "V2", "V3", "V4", "V5", "V6").contains(c.checkId());
        assertEquals(zhConflicts.stream().filter(machine).toList(),
                enConflicts.stream().filter(machine).toList(),
                "ZH/EN structured machine 结果必须一致");
        assertEquals(zhConflicts.stream().filter(machine).toList(),
                ruConflicts.stream().filter(machine).toList(),
                "ZH/RU structured machine 结果必须一致");
        assertTrue(hasCheck(zhConflicts, "BINDING"), "三语共用同一 machine claim 必须 FAIL（BINDING）");
    }

    // ===== ：EN / RU 正文回归（三语 factual guard） =====

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
        // V5a 正文短语兜底：ENEMY_POSITION claim 声称当前但引用 LAST_KNOWN 证据（E107）
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "The Maus is right here now", "ENEMY_POSITION", 120.0, 5, null, "Maus",
                null, null, null, "LAST_KNOWN", "E107"));
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "V5"),
                "EN LAST_KNOWN 写成当前必须 FAIL（V5）");
    }

    @Test
    void ruLastKnownAsCurrentFails() {
        final TeamReviewEnvelope env = envWith(machineClaimFull(
                "Maus сейчас находится в 5-й зоне", "ENEMY_POSITION", 120.0, 5, null, "Maus",
                null, null, null, "LAST_KNOWN", "E107"));
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

    // ===== claims coverage 最低契约 =====

    @Test
    void emptyClaimsWithDiagnosisEvidenceFails() {
        final TeamReviewEnvelope env = new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of("E101")),
                "## 团队复盘\n\n这是一段复盘。", List.of());
        assertTrue(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "CONTRACT"),
                "主判断引用证据编号但 claims 为空必须 FAIL（CONTRACT）");
    }

    @Test
    void emptyClaimsWithFactualBodyFails() {
        final TeamReviewEnvelope env = new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "1分52秒 WildCat 阵亡，随后本队7辆全部在6区。", List.of());
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "CONTRACT"),
                "正文含可验证事实锚点但 claims 为空必须 FAIL（CONTRACT）: " + conflicts);
    }

    @Test
    void emptyClaimsPureTacticalPasses() {
        final TeamReviewEnvelope env = new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "我认为这局主要问题是第一次正面交换。", List.of());
        assertFalse(hasCheck(TeamFactualConsistencyValidator.validate(env, facts()), "CONTRACT"),
                "纯战术观点正文无事实锚点 + claims 为空必须 PASS（CONTRACT）");
    }

    @Test
    void emptyReviewMarkdownFails() {
        final TeamReviewEnvelope env = new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "   ", List.of());
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(hasCheck(conflicts, "OUTPUT"), "空正文必须 FAIL: " + conflicts);
    }
    // ===== conflict reasonCode 机器分类 =====

    @Test
    void unknownEvidenceConflictCarriesReasonCode() {
        // DEATH claim 引用不存在的证据 E999 → BINDING/UNKNOWN_EVIDENCE（首要排障信号）
        final TeamReviewEnvelope env = envelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "## 团队复盘\n\nWildCat 在1分52秒阵亡。",
                List.of(new TeamReviewEnvelope.Claim(
                        "WildCat 在1分52秒阵亡", List.of("E999"), "DEATH", 112.0, null, null,
                        "WildCat", null, null, null, null, 1L)));
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(conflicts.stream().anyMatch(c -> "BINDING".equals(c.checkId())
                        && "UNKNOWN_EVIDENCE".equals(c.reasonCode())),
                "引用不存在证据必须携带 reasonCode=UNKNOWN_EVIDENCE: " + conflicts);
        assertFalse(TeamFactualConsistencyValidator.hasHardConflict(conflicts),
                "仅 evidence binding metadata 冲突不应把正文事实判为 HARD_FACT: " + conflicts);
    }

    @Test
    void hardFactConflictCarriesUnsupportedHardFactReason() {
        // V6 无证据硬事实 → reasonCode=UNSUPPORTED_HARD_FACT
        final TeamReviewEnvelope env = envelope(
                "这波对方所有车辆都拥有直接炮线。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(conflicts.stream().anyMatch(c -> "V6".equals(c.checkId())
                        && "UNSUPPORTED_HARD_FACT".equals(c.reasonCode())),
                "V6 硬事实必须携带 reasonCode=UNSUPPORTED_HARD_FACT: " + conflicts);
    }

    @Test
    void temporalOwnershipConflictCarriesTemporalOwnershipReason() {
        // V1 时间归属（2 参构造推断）→ reasonCode=TEMPORAL_OWNERSHIP
        final TeamReviewEnvelope env = envelope(
                "1分49秒至2分08秒这段本队死了WildCat、Azusa、FFFNuit。");
        final List<FactConflict> conflicts = TeamFactualConsistencyValidator.validate(env, facts());
        assertTrue(conflicts.stream().anyMatch(c -> "V1".equals(c.checkId())
                        && "TEMPORAL_OWNERSHIP".equals(c.reasonCode())),
                "V1 必须携带 reasonCode=TEMPORAL_OWNERSHIP: " + conflicts);
    }


    // ===== P0-8 ALIVE_TRANSITION evidence chain（纯 deterministic，不调 AI）=====

    /**
     * 构建带指定存活变化证据的 GroundingFacts（含 ALIVE_TRANSITION + FOCUS_WINDOW）。
     * attrs: [timeSec, beforeF, beforeE, afterF, afterE]，type 可混 ALIVE_TRANSITION / FOCUS_WINDOW。
     */
    private static GroundingFacts chainFacts(final List<Object[]> steps) {
        final List<EvidenceFact> facts = new java.util.ArrayList<>();
        int id = 200;
        for (final Object[] s : steps) {
            final double timeSec = (Double) s[0];
            final String type = (String) s[1];
            final int bf = (Integer) s[2];
            final int be = (Integer) s[3];
            final int af = (Integer) s[4];
            final int ae = (Integer) s[5];
            final Map<String, String> attrs = new LinkedHashMap<>();
            if (TeamGroundingFacts.TYPE_ALIVE_TRANSITION.equals(type)) {
                attrs.put("before", bf + "v" + be);
                attrs.put("after", af + "v" + ae);
            } else {
                attrs.put("beforeFriendly", String.valueOf(bf));
                attrs.put("beforeEnemy", String.valueOf(be));
                attrs.put("afterFriendly", String.valueOf(af));
                attrs.put("afterEnemy", String.valueOf(ae));
            }
            facts.add(new EvidenceFact("E" + (id++), type, Side.FRIENDLY,
                    timeSec, timeSec, null, null, null, attrs));
        }
        return new GroundingFacts(List.copyOf(facts), Map.of(), List.of(), List.of(), List.of());
    }

    /** claim value "7v7 -> 4v6"，引用指定证据链 → 断言是否 FAIL（V3 HARD / BINDING）。 */
    private static List<FactConflict> chainConflicts(final GroundingFacts facts,
                                                     final List<String> evidenceIds) {
        final TeamReviewEnvelope env = envelope(
                new TeamReviewEnvelope.PrimaryDiagnosis("主判断", "理由", List.of()),
                "## 团队复盘\n\n这是一段复盘。",
                List.of(new TeamReviewEnvelope.Claim(
                        "存活变化", evidenceIds, "ALIVE_TRANSITION", null, null, null,
                        null, "7v7 -> 4v6", null, null, null, null)));
        return TeamFactualConsistencyValidator.validate(env, facts);
    }

    @Test
    void chainContinuousEvidencePasses() {
        // 场景 1：连续证据链 7v7→6v7→5v7→5v6→4v6 => PASS（无 V3 / BINDING 冲突）
        final GroundingFacts facts = chainFacts(List.of(
                new Object[]{112.4, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 7, 7, 6, 7},
                new Object[]{121.3, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 6, 7, 5, 7},
                new Object[]{128.1, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 5, 7, 5, 6},
                new Object[]{131.8, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 5, 6, 4, 6}));
        final List<FactConflict> conflicts = chainConflicts(facts,
                List.of("E200", "E201", "E202", "E203"));
        assertFalse(hasCheck(conflicts, "V3"), "连续证据链必须 PASS: " + conflicts);
        assertFalse(hasCheck(conflicts, "BINDING"), "连续证据链必须 PASS（无 binding）: " + conflicts);
    }

    @Test
    void chainFirstLastMatchButGapFails() {
        // 场景 2：首尾匹配（E200: 7v7→6v7，E203: 5v6→4v6）但中间断链（缺 6v7→...→5v6）
        // => 不得 PASS：E201 after(5v7) != E203 before(5v6)
        final GroundingFacts facts = chainFacts(List.of(
                new Object[]{112.4, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 7, 7, 6, 7},
                new Object[]{128.1, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 6, 7, 5, 7},
                new Object[]{131.8, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 5, 6, 4, 6}));
        final List<FactConflict> conflicts = chainConflicts(facts,
                List.of("E200", "E201", "E202"));
        assertTrue(hasCheck(conflicts, "V3") || hasCheck(conflicts, "BINDING"),
                "首尾匹配但中间断链不得 PASS: " + conflicts);
    }

    @Test
    void chainIdsOutOfOrderButTimeOrderedPasses() {
        // 场景 3：evidence ID 乱序（E203 先于 E200），但真实 timeSec 连续 => PASS
        final GroundingFacts facts = chainFacts(List.of(
                new Object[]{112.4, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 7, 7, 6, 7},
                new Object[]{121.3, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 6, 7, 5, 7},
                new Object[]{128.1, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 5, 7, 5, 6},
                new Object[]{131.8, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 5, 6, 4, 6}));
        final List<FactConflict> conflicts = chainConflicts(facts,
                List.of("E203", "E201", "E200", "E202"));
        assertFalse(hasCheck(conflicts, "V3"), "ID 乱序但 timeSec 连续必须 PASS: " + conflicts);
        assertFalse(hasCheck(conflicts, "BINDING"), "ID 乱序但 timeSec 连续必须 PASS: " + conflicts);
    }

    @Test
    void chainTimeReversedFails() {
        // 场景 4：时间顺序错误/反向——存活数倒退链（7v7→6v7 后接 6v7→7v7 回升）
        // 排序后 E200.after(6v7) == E201.before(6v7) 看似连续，但 E201.after(7v7)
        // 与 claim after(4v6) 不符且全局不存在该变化 → 不得 PASS
        final GroundingFacts facts = chainFacts(List.of(
                new Object[]{112.4, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 7, 7, 6, 7},
                new Object[]{121.3, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 6, 7, 7, 7}));
        final List<FactConflict> conflicts = chainConflicts(facts,
                List.of("E200", "E201"));
        assertTrue(hasCheck(conflicts, "V3") || hasCheck(conflicts, "BINDING"),
                "时间反向/倒退链不得 PASS: " + conflicts);
    }

    @Test
    void chainMixedTransitionAndFocusWindowPasses() {
        // 场景 5：ALIVE_TRANSITION + FOCUS_WINDOW 混合链，timeSec 连续 => PASS
        final GroundingFacts facts = chainFacts(List.of(
                new Object[]{109.0, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 7, 7, 6, 7},
                new Object[]{118.0, TeamGroundingFacts.TYPE_FOCUS_WINDOW, 6, 7, 5, 7},
                new Object[]{125.0, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 5, 7, 4, 6}));
        final List<FactConflict> conflicts = chainConflicts(facts,
                List.of("E200", "E201", "E202"));
        assertFalse(hasCheck(conflicts, "V3"), "混合链（ALIVE_TRANSITION+FOCUS_WINDOW）必须 PASS: " + conflicts);
        assertFalse(hasCheck(conflicts, "BINDING"), "混合链必须 PASS: " + conflicts);
    }

    @Test
    void chainMixedWindowGapFails() {
        // 场景 5b：混合链中间断链（FOCUS_WINDOW 5v7→5v6 后接 ALIVE_TRANSITION 4v7→4v6）=> 不得 PASS
        final GroundingFacts facts = chainFacts(List.of(
                new Object[]{109.0, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 7, 7, 6, 7},
                new Object[]{118.0, TeamGroundingFacts.TYPE_FOCUS_WINDOW, 6, 7, 5, 6},
                new Object[]{125.0, TeamGroundingFacts.TYPE_ALIVE_TRANSITION, 4, 7, 4, 6}));
        final List<FactConflict> conflicts = chainConflicts(facts,
                List.of("E200", "E201", "E202"));
        assertTrue(hasCheck(conflicts, "V3") || hasCheck(conflicts, "BINDING"),
                "混合链断链不得 PASS: " + conflicts);
    }
}
