package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EnemyLastKnownPositionResolverTest {

    private static final float START_RAW = EvidenceTestFixtures.START_RAW;

    private static Battle battle(final List<PlayerResult> players) {
        return EvidenceTestFixtures.battle(players);
    }

    private static Battle battleWithRecorderAndEnemies(final int enemyCount) {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", true, 300));
        for (int i = 1; i <= enemyCount; i++) {
            players.add(EvidenceTestFixtures.player(2000 + i, 2, 10785, "T110E5", true, 300));
        }
        return battle(players);
    }

    private static VehicleState observedVehicle(final int entityId, final long accountId,
                                                final Integer team, final float x, final float z,
                                                final float lastPosAt) {
        final VehicleState vs = new VehicleState(entityId, lastPosAt);
        vs.setAccountId(accountId);
        vs.setTeam(team);
        vs.setTankId(10785);
        vs.setLastObservedAt(lastPosAt);
        vs.setPosition(new Vector3(x, 0f, z));
        vs.setObservationState(ObservationState.OBSERVED);
        return vs;
    }

    private static ReplayReconstruction recon(final VehicleState... vehicles) {
        final BattleStateCheckpoint cp = EvidenceTestFixtures.cp(
                START_RAW + 300f, vehicles);
        return EvidenceTestFixtures.recon(cp);
    }


    @Test
    void observedEnemyCarriesRegionDistanceAndTime() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 90f),
                observedVehicle(2, 1002, 1, 100f, 0f, START_RAW + 90f),
                observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        assertEquals(1, result.vehicles().size());
        final EnemyLastKnownPositionResolver.EnemyLastKnownPosition enemy = result.vehicles().getFirst();
        assertTrue(enemy.observed(), "OBSERVED+position 必须算有记录");
        assertEquals(2001L, enemy.accountId());
        assertTrue(enemy.region() >= 1 && enemy.region() <= 9, "必须解析出九宫格区域");
        assertNotNull(enemy.distanceMeters());
        assertEquals(200.0, enemy.distanceMeters(), 1.0);
        assertNotNull(enemy.lastObservedBattleSec());
        assertEquals(95.0f, enemy.lastObservedBattleSec(), 0.01f);
        assertEquals(DecodeConfidence.EXACT, result.confidence());
        assertTrue(result.enemyFullyObserved());
    }


    @Test
    void nonObservedEnemiesProduceUnknownRows() {
        final Battle battle = battleWithRecorderAndEnemies(4);
        final VehicleState stale = observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f);
        stale.setObservationState(ObservationState.STALE);
        final VehicleState removed = observedVehicle(4, 2002, 2, 260f, 0f, START_RAW + 95f);
        removed.setObservationState(ObservationState.REMOVED);
        final VehicleState noPosition = EvidenceTestFixtures.hiddenVehicle(5, 2003, 2);
        final VehicleState observedNullPos = observedVehicle(6, 2004, 2, 270f, 0f, START_RAW + 95f);
        observedNullPos.setPosition(null);

        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 90f),
                observedVehicle(2, 1002, 1, 100f, 0f, START_RAW + 90f),
                stale, removed, noPosition, observedNullPos);

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        assertEquals(4, result.vehicles().size(), "每名敌方玩家必有一行");
        assertEquals(0, result.observedCount());
        for (final EnemyLastKnownPositionResolver.EnemyLastKnownPosition v : result.vehicles()) {
            assertTrue(v.unknown(), "STALE/REMOVED/UNKNOWN/position null 必须输出 UNKNOWN 行");
            assertEquals(0, v.region());
            assertNull(v.distanceMeters());
            assertNull(v.lastObservedBattleSec());
        }
        assertEquals(DecodeConfidence.PARTIAL, result.confidence());
        assertFalse(result.enemyFullyObserved());
    }

    @Test
    void mixedCoverageCountsOnlyObserved() {
        final Battle battle = battleWithRecorderAndEnemies(2);
        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 90f),
                observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f),
                EvidenceTestFixtures.hiddenVehicle(4, 2002, 2));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        assertEquals(2, result.vehicles().size());
        assertEquals(1, result.observedCount());
        assertTrue(result.vehicles().get(0).observed());
        assertTrue(result.vehicles().get(1).unknown());
        assertEquals(DecodeConfidence.PARTIAL, result.confidence());
    }


    @Test
    void teamFallsBackToRosterWhenVehicleStateTeamMissing() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final VehicleState friendlyNoTeam = observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 90f);
        friendlyNoTeam.setTeam(null);
        final VehicleState friendlyNoTeam2 = observedVehicle(2, 1002, 1, 100f, 0f, START_RAW + 90f);
        friendlyNoTeam2.setTeam(null);
        final VehicleState enemy = observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f);

        final ReplayReconstruction recon = recon(friendlyNoTeam, friendlyNoTeam2, enemy);
        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        final EnemyLastKnownPositionResolver.EnemyLastKnownPosition v = result.vehicles().getFirst();
        assertTrue(v.observed());
        assertNotNull(v.distanceMeters());
        assertEquals(200.0, v.distanceMeters(), 1.0,
                "VehicleState.team 缺失时必须用 accountId→roster 回退归属质心");
    }

    @Test
    void rosterAccountIdUnknownVehicleWithoutTeamIsNotCountedInCentroid() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 90f),
                observedVehicle(9, 9999L, null, 500f, 500f, START_RAW + 90f),
                observedVehicle(3, 2001, 2, 100f, 0f, START_RAW + 95f));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        assertNotNull(result.vehicles().getFirst().distanceMeters());
        assertEquals(100.0, result.vehicles().getFirst().distanceMeters(), 1.0);
    }


    @Test
    void centroidExcludesStaleAndPositionlessFriendlies() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final VehicleState staleFriendly = observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 90f);
        staleFriendly.setObservationState(ObservationState.STALE);
        final VehicleState poslessFriendly = EvidenceTestFixtures.hiddenVehicle(2, 1002, 1);
        final ReplayReconstruction recon = recon(
                staleFriendly, poslessFriendly,
                observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        assertNull(result.vehicles().getFirst().distanceMeters(),
                "无 OBSERVED 有位置友军时质心不可用，距离必须为 null");
        assertTrue(result.vehicles().getFirst().observed(),
                "质心缺失只影响距离，不影响位置记录本身");
        assertNotNull(result.vehicles().getFirst().lastObservedBattleSec());
    }


    @Test
    void battleRelativeTimeSubtractsBattleStart() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 10f),
                observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 120f));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertEquals(120.0f, result.vehicles().getFirst().lastObservedBattleSec(), 0.01f);
    }

    @Test
    void missingBattleStartYieldsNullTime() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final ReplayReconstruction recon = EvidenceTestFixtures.reconWithEvents(
                List.of(EvidenceTestFixtures.cp(START_RAW + 300f,
                        observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 10f),
                        observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f))));
        final ReplayReconstruction noStart = new ReplayReconstruction(
                recon.metadata(), recon.streamHeader(), recon.battleDurationSec(),
                null, recon.participants(), recon.events(), recon.checkpoints(),
                recon.finalState(), recon.coverage(), recon.diagnostics());

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(noStart, battle, 1);

        assertNotNull(result);
        assertTrue(result.vehicles().getFirst().observed());
        assertNull(result.vehicles().getFirst().lastObservedBattleSec(),
                "battleStartRawClockSec 缺失时最后观察时间必须为 null");
    }

    @Test
    void preBattleObservationYieldsNullTimeButKeepsPosition() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 10f),
                observedVehicle(3, 2001, 2, 250f, 0f, START_RAW - 5f));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        final EnemyLastKnownPositionResolver.EnemyLastKnownPosition v =
                result.vehicles().getFirst();
        assertTrue(v.observed());
        assertNull(v.lastObservedBattleSec());
        assertTrue(v.region() >= 1 && v.region() <= 9);
    }


    @Test
    void nullPreconditionsReturnNull() {
        final Battle battle = battleWithRecorderAndEnemies(1);
        final ReplayReconstruction recon = recon(
                observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f));

        assertNull(EnemyLastKnownPositionResolver.resolve(null, battle, 1));
        assertNull(EnemyLastKnownPositionResolver.resolve(recon, null, 1));
        assertNull(EnemyLastKnownPositionResolver.resolve(recon, battle, 0), "非法视角必须返回 null");
        assertNull(EnemyLastKnownPositionResolver.resolve(recon, battle, 3), "非法视角必须返回 null");
    }

    @Test
    void noEnemiesInRosterYieldsUnknownConfidence() {
        final Battle battle = battleWithRecorderAndEnemies(0);
        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 10f));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertNotNull(result);
        assertTrue(result.vehicles().isEmpty());
        assertEquals(0, result.totalCount());
        assertEquals(DecodeConfidence.UNKNOWN, result.confidence());
    }

    @Test
    void enemyNameAndTankComeFromAuthoritativeRoster() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        final PlayerResult enemy = EvidenceTestFixtures.player(
                2001, 2, 10785, "T110E5", true, 300);
        enemy.nickname = "EnemyOne";
        players.add(enemy);
        final Battle battle = battle(players);
        final ReplayReconstruction recon = recon(
                observedVehicle(1, 1001, 1, 0f, 0f, START_RAW + 10f),
                observedVehicle(3, 2001, 2, 250f, 0f, START_RAW + 95f));

        final EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult result =
                EnemyLastKnownPositionResolver.resolve(recon, battle, 1);

        assertEquals("EnemyOne", result.vehicles().getFirst().nickname());
        assertFalse(result.vehicles().getFirst().tankName().isBlank());
        assertFalse(result.vehicles().getFirst().tankName().startsWith("tankId="));
        assertFalse(result.vehicles().getFirst().tankName().equals("未知坦克"));
    }
}
