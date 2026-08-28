package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.List;

/**
 * 阶段时间线特征（阶段边界 + 双方存活人数）测试。
 * <p>案例验收：某时段我方死 2、敌方死 3 → 该时段 friendlyAlive=5（7-2）、
 * enemyAlive=4（7-3），AI 输出 5 打 4 而非 5 打 7。</p>
 */
class BattlePhaseSurvivalTest {

    // ---- fixture：7v7，firstContact=50，battleEnd=180 ----
    // 我方阵亡 60s/70s，敌方阵亡 62s/64s/66s → 中期 [60,180] 我方死 2、敌方死 3

    private static Battle battle7v7() {
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 180.0;
        b.recorder = "rec1";
        final List<PlayerResult> players = new java.util.ArrayList<>();
        for (long id = 1001L; id <= 1007L; id++) {
            players.add(player(id, 1, id <= 1002L ? false : true, id == 1001L ? 60.0 : 70.0));
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
        p.nickname = "p" + accountId;
        p.tankId = 4481L;
        p.tankName = "Kranvagn";
        p.survived = survived;
        p.deathTimeMillis = survived ? 0L : (long) (deathSec * 1000);
        if (!survived) {
            p.deathTimeSource = deathSec > 0
                    ? DeathTimeSource.SETTLEMENT_SECOND : DeathTimeSource.UNKNOWN;
        }
        return p;
    }

    private static List<BattlePhaseSummary> phasesWithSurvival(final Battle battle) {
        return BattlePhaseSummary.buildRelativePhasesWithSurvival(
                50f, 180f,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle, 1));
    }

    private static BattlePhaseSummary phase(final List<BattlePhaseSummary> phases,
                                            final BattlePhaseType type) {
        return phases.stream().filter(p -> p.type() == type).findFirst().orElseThrow();
    }

    @Test
    void midGameReportsFiveAliveVsFour() {
        final List<BattlePhaseSummary> phases = phasesWithSurvival(battle7v7());

        // 案例：我方死 2、敌方死 3 的中期时段 → 5 打 4（非 5 打 7）
        final BattlePhaseSummary mid = phase(phases, BattlePhaseType.MID_GAME);
        assertEquals(5, mid.friendlyAlive(), "我方死 2 → 7-2=5");
        assertEquals(4, mid.enemyAlive(), "敌方死 3 → 7-3=4");

        // 开局无人阵亡 → 7 打 7
        final BattlePhaseSummary opening = phase(phases, BattlePhaseType.OPENING);
        assertEquals(7, opening.friendlyAlive());
        assertEquals(7, opening.enemyAlive());

        // 首次接敌 [50,60]：我方 60s 阵亡——SETTLEMENT_SECOND 区间 [59.5,60.5] 跨 60s 边界，
        // PR147 §C 证据不足 → friendlyAlive 未知（不得强制「60s 已死=6」）；敌方尚无阵亡 → 7
        final BattlePhaseSummary firstContact = phase(phases, BattlePhaseType.FIRST_CONTACT);
        assertNull(firstContact.friendlyAlive());
        assertEquals(7, firstContact.enemyAlive());

        // 残局（battleEnd 零长标记）→ 与结算一致：5 打 4
        final BattlePhaseSummary endgame = phase(phases, BattlePhaseType.ENDGAME);
        assertEquals(5, endgame.friendlyAlive());
        assertEquals(4, endgame.enemyAlive());
    }

    @Test
    void deathSourceLabelDistinguishesLiveExactSettlementUnknownAndNoDeaths() {
        final PlayerResult liveExact = player(1L, 1, false, 62.0);
        liveExact.deathTimeSource = DeathTimeSource.LIVE_EXACT;
        liveExact.survivalTimeSec = 62.345;
        final Battle liveExactBattle = new Battle();
        liveExactBattle.players = List.of(liveExact);
        assertEquals("回放精确", BattlePhaseSummary.deathSourceLabel(liveExactBattle));

        final PlayerResult settlement = player(1L, 1, false, 62.0);
        settlement.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
        final Battle settlementBattle = new Battle();
        settlementBattle.players = List.of(settlement);
        assertEquals("权威结算", BattlePhaseSummary.deathSourceLabel(settlementBattle));

        final PlayerResult legacyEstimateOnly = player(1L, 1, false, 83.0);
        legacyEstimateOnly.deathTimeMillis = 0L;
        legacyEstimateOnly.survivalTimeSec = 83.0;
        final Battle unknownBattle = new Battle();
        unknownBattle.players = List.of(legacyEstimateOnly);
        assertEquals("未知", BattlePhaseSummary.deathSourceLabel(unknownBattle));

        final Battle noDead = new Battle();
        noDead.players = List.of(player(1L, 1, true, 0.0));
        assertEquals("无阵亡", BattlePhaseSummary.deathSourceLabel(noDead));
    }

    @Test
    void denseKillWindowDetectedOnMidGameOnly() {
        final List<BattlePhaseSummary> phases = phasesWithSurvival(battle7v7());
        // 中期 [60,180] 内 5 个阵亡集中在 60-70s → 15 秒窗口内 >= 3 → 密集击杀
        assertTrue(phase(phases, BattlePhaseType.MID_GAME).denseKills());
        assertFalse(phase(phases, BattlePhaseType.OPENING).denseKills());
        assertFalse(phase(phases, BattlePhaseType.FIRST_CONTACT).denseKills());
        assertFalse(phase(phases, BattlePhaseType.ENDGAME).denseKills());
    }

    @Test
    void spreadDeathsAreNotDense() {
        // 双方阵亡 50/60/90/120/150 → 任意 15 秒窗口内最多 2 个 → 无密集击杀段
        final Battle b = new Battle();
        b.recorder = "rec1";
        b.durationS = 180.0;
        final List<PlayerResult> players = new java.util.ArrayList<>();
        for (long id = 1001L; id <= 1007L; id++) {
            final boolean survived = id == 1001L || id == 1002L || id == 1003L || id == 1004L || id == 1005L;
            players.add(player(id, 1, survived, id == 1001L ? 50.0 : id == 1002L ? 90.0 : 0.0));
        }
        for (long id = 2001L; id <= 2007L; id++) {
            final boolean survived = id == 2004L || id == 2005L || id == 2006L || id == 2007L;
            players.add(player(id, 2, survived, id == 2001L ? 60.0 : id == 2002L ? 120.0 : 150.0));
        }
        b.players = players;
        final List<BattlePhaseSummary> phases = phasesWithSurvival(b);
        for (final BattlePhaseSummary p : phases) {
            assertFalse(p.denseKills(), "分散阵亡不得标记密集击杀：" + p);
        }
    }

    @Test
    void unknownDeathTimeMakesThatSideCountsUnknown() {
        // 敌方 2006 阵亡但死亡时刻缺失（0）→ 敌方存活人数不可算，写 null（未知）；我方不受影响
        final Battle b = battle7v7();
        final PlayerResult unknownDead = player(2006L, 2, false, 0.0);
        final List<PlayerResult> players = new java.util.ArrayList<>(b.players);
        for (int i = 0; i < players.size(); i++) {
            if (players.get(i).accountId == 2006L) {
                players.set(i, unknownDead);
                break;
            }
        }
        b.players = players;

        final List<BattlePhaseSummary> phases = phasesWithSurvival(b);
        for (final BattlePhaseSummary p : phases) {
            assertNull(p.enemyAlive(), "存在未知死亡时刻 → 敌方人数不可算：" + p);
            if (p.type() == BattlePhaseType.FIRST_CONTACT) {
                // 我方 60s 阵亡区间 [59.5,60.5] 跨 60s 边界 → PR147 §C 证据不足 → 未知
                assertNull(p.friendlyAlive(), "settlement 区间跨边界 → 我方人数不可算：" + p);
            } else {
                assertTrue(p.friendlyAlive() != null, "我方时间线完整且无跨边界 → 人数可算：" + p);
            }
        }
    }

    @Test
    void missingRosterOrPerspectiveYieldsUnknownCounts() {
        // 无名册
        final Battle empty = new Battle();
        empty.players = null;
        final List<BattlePhaseSummary> noRoster = phasesWithSurvival(empty);
        assertEquals(4, noRoster.size());
        for (final BattlePhaseSummary p : noRoster) {
            assertNull(p.friendlyAlive());
            assertNull(p.enemyAlive());
            assertFalse(p.denseKills());
        }

        // 视角未知（null）→ 人数不可算
        final List<BattlePhaseSummary> noPerspective = BattlePhaseSummary.buildRelativePhasesWithSurvival(
                50f, 180f,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle7v7(), null));
        for (final BattlePhaseSummary p : noPerspective) {
            assertNull(p.friendlyAlive());
            assertNull(p.enemyAlive());
        }

        // 视角非法队伍编号
        final List<BattlePhaseSummary> invalidTeam = BattlePhaseSummary.buildRelativePhasesWithSurvival(
                50f, 180f,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle7v7(), 3));
        for (final BattlePhaseSummary p : invalidTeam) {
            assertNull(p.friendlyAlive());
            assertNull(p.enemyAlive());
        }
    }

    @Test
    void allSurvivorsKeepsFullRoster() {
        final Battle b = new Battle();
        b.recorder = "rec1";
        b.durationS = 180.0;
        final List<PlayerResult> players = new java.util.ArrayList<>();
        for (long id = 1001L; id <= 1007L; id++) {
            players.add(player(id, 1, true, 0.0));
        }
        for (long id = 2001L; id <= 2007L; id++) {
            players.add(player(id, 2, true, 0.0));
        }
        b.players = players;
        final List<BattlePhaseSummary> phases = phasesWithSurvival(b);
        for (final BattlePhaseSummary p : phases) {
            assertEquals(7, p.friendlyAlive());
            assertEquals(7, p.enemyAlive());
            assertFalse(p.denseKills());
        }
    }

    @Test
    void survivalDoesNotChangePhaseBoundaries() {
        final List<BattlePhaseSummary> withSurvival = phasesWithSurvival(battle7v7());
        final List<BattlePhaseSummary> without = BattlePhaseSummary.buildRelativePhases(50f, 180f);
        assertEquals(without.size(), withSurvival.size());
        for (int i = 0; i < without.size(); i++) {
            final BattlePhaseSummary a = withSurvival.get(i);
            final BattlePhaseSummary b = without.get(i);
            assertEquals(b.startTime(), a.startTime(), 0.001f, "startTime must not change");
            assertEquals(b.endTime(), a.endTime(), 0.001f, "endTime must not change");
            assertEquals(b.type(), a.type(), "type must not change");
            assertEquals(b.confidence(), a.confidence(), "confidence must not change");
        }
    }

    @Test
    void survivalNullKeepsLegacySemantics() {
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhasesWithSurvival(
                40f, 120f, null);
        for (final BattlePhaseSummary p : phases) {
            assertNull(p.friendlyAlive());
            assertNull(p.enemyAlive());
            assertFalse(p.denseKills());
        }
    }

    @Test
    void fromBattleResultsIgnoresInvalidTeams() {
        final Battle b = new Battle();
        b.recorder = "rec1";
        b.durationS = 180.0;
        b.players = List.of(
                player(1001L, 1, true, 0.0),
                player(2001L, 2, false, 60.0),
                player(3001L, 9, false, 40.0)); // 非法队伍：不计入任何一侧
        final BattlePhaseSummary.SurvivalTimeline timeline =
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(b, 1);
        assertEquals(1, timeline.friendlyRosterSize());
        assertEquals(1, timeline.enemyRosterSize());
        assertEquals(0, timeline.enemyUnknownDeaths());
        // PR147 §C precision-aware: a SETTLEMENT_SECOND death is an interval [rep-0.5, rep+0.5], not a point.
        assertEquals(1, timeline.enemyDeathTimes().size());
        final com.wotb.core.util.PlayerResultFormat.DeathTimeEvidence ev =
                timeline.enemyDeathTimes().get(0);
        assertEquals(DeathTimeSource.SETTLEMENT_SECOND, ev.source());
        assertEquals(60.0, ev.representativeSec(), 1e-9);
        assertEquals(59.5, ev.lowerBoundSec(), 1e-9);
        assertEquals(60.5, ev.upperBoundSec(), 1e-9);
    }
}