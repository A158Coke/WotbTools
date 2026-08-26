package com.wotb.core.replay.feature;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 阵亡时刻与主力质心距离（DeathProximity）的边界测试：
 * OBSERVED 目标可算距离；无 OBSERVED 记录不得硬算。
 */
class DeathProximityTest {

    @Test
    void observedTargetAndFriendlyCentroidProduceDistance() {
        final ReplayReconstruction recon = recon(
                snapshot(120f, vehicle(1, 1001L, 1, 150f, 200f, ObservationState.OBSERVED),
                        vehicle(2, 1002L, 1, 100f, 100f, ObservationState.OBSERVED),
                        vehicle(3, 1003L, 1, 100f, 300f, ObservationState.OBSERVED)),
                snapshot(180f, vehicle(1, 1001L, 1, 150f, 200f, ObservationState.OBSERVED),
                        vehicle(2, 1002L, 1, 100f, 100f, ObservationState.OBSERVED),
                        vehicle(3, 1003L, 1, 100f, 300f, ObservationState.OBSERVED)));
        final PlayerResult target = player(1001L, 1, 60.0);
        final TeamEntityMapping mapping = mapping();

        // deathRaw = 0 + 60 = 60；目标在 checkpoint@60 的最近 OBSERVED（向前找）无记录，
        // 但 checkpoint@120 有 OBSERVED → 使用 120s 位置，质心取自最近的 checkpoint@60 无队友 OBSERVED？
        // 为清晰起见，本测试让目标与队友都在 120s checkpoint OBSERVED。
        final TeamMemberFeatureSet.DeathProximity prox =
                extractorDeathProximity(recon, mapping, target);

        assertNotNull(prox);
        // holmeisk 等比 profile（±250 → 500m）：目标 (150,200) 质心 (100,200) → 50m
        assertEquals(50.0, prox.distanceMeters(), 0.5);
        assertNotNull(prox.confidence());
    }

    @Test
    void targetNeverObservedReturnsNull() {
        final ReplayReconstruction recon = recon(
                snapshot(120f, vehicle(1, 1001L, 1, 100f, 200f, ObservationState.UNKNOWN),
                        vehicle(2, 1002L, 1, 100f, 100f, ObservationState.OBSERVED)),
                snapshot(180f, vehicle(1, 1001L, 1, 150f, 200f, ObservationState.STALE),
                        vehicle(2, 1002L, 1, 100f, 100f, ObservationState.OBSERVED)));
        final PlayerResult target = player(1001L, 1, 150.0);
        final TeamMemberFeatureSet.DeathProximity prox =
                extractorDeathProximity(recon, mapping(), target);
        assertNull(prox, "no OBSERVED target position must not fabricate a distance");
    }

    @Test
    void survivorOrNoCheckpointsReturnsNull() {
        final PlayerResult survivor = player(1001L, 1, 0.0);
        survivor.survived = true;
        assertNull(extractorDeathProximity(recon(
                snapshot(120f, vehicle(1, 1001L, 1, 0f, 0f, ObservationState.OBSERVED))),
                mapping(), survivor));
        assertNull(extractorDeathProximity(null, mapping(), player(1001L, 1, 60.0)));
    }

    // ---- helpers ----

    private static TeamMemberFeatureSet.DeathProximity extractorDeathProximity(
            final ReplayReconstruction recon,
            final TeamEntityMapping mapping,
            final PlayerResult target) {
        return DefaultTeamBattleFeatureExtractor.resolveDeathProximity(
                recon, mapping, "holmeisk", 1, target);
    }

    private static ReplayReconstruction recon(final BattleStateSnapshot... snapshots) {
        final List<BattleStateCheckpoint> checkpoints = new java.util.ArrayList<>();
        for (int i = 0; i < snapshots.length; i++) {
            checkpoints.add(new BattleStateCheckpoint(snapshots[i].rawClockSec(), i, snapshots[i]));
        }
        return new ReplayReconstruction(
                null, null, 240f, 0f, null, null,
                checkpoints, snapshots[snapshots.length - 1], null, null);
    }

    private static BattleStateSnapshot snapshot(final float clock, final VehicleState... vehicles) {
        final Map<Integer, VehicleState> byEntity = new java.util.LinkedHashMap<>();
        final Map<Long, Integer> byAccount = new java.util.LinkedHashMap<>();
        for (final VehicleState v : vehicles) {
            byEntity.put(v.entityId(), v);
            if (v.accountId() != null) {
                byAccount.put(v.accountId(), v.entityId());
            }
        }
        return new BattleStateSnapshot(clock, clock, null, byEntity, byAccount, null, false, null);
    }

    private static VehicleState vehicle(final int eid, final long accountId, final int team,
                                        final float x, final float z, final ObservationState state) {
        final VehicleState v = new VehicleState(eid, 0f);
        v.setAccountId(accountId);
        v.setTeam(team);
        v.setPosition(new Vector3(x, 0f, z));
        v.setObservationState(state);
        return v;
    }

    private static PlayerResult player(final long accountId, final int team, final double deathSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.nickname = "P" + accountId;
        p.tankId = 29985;
        p.tankName = "SPHT";
        p.survived = false;
        p.deathTimeMillis = (long) (deathSec * 1000);
        return p;
    }

    private static TeamEntityMapping mapping() {
        final Map<Integer, TeamEntityIdentity> byEntity = Map.of(
                1, new TeamEntityIdentity(1, 1001L, "P1001", 29985, "SPHT", 1, DecodeConfidence.EXACT),
                2, new TeamEntityIdentity(2, 1002L, "P1002", 29985, "SPHT", 1, DecodeConfidence.EXACT),
                3, new TeamEntityIdentity(3, 1003L, "P1003", 29985, "SPHT", 1, DecodeConfidence.EXACT));
        return new TeamEntityMapping(
                byEntity,
                Map.of(1001L, List.of(1), 1002L, List.of(2), 1003L, List.of(3)),
                Map.of("P1001", List.of(1), "P1002", List.of(2), "P1003", List.of(3)),
                0, List.of());
    }
}
