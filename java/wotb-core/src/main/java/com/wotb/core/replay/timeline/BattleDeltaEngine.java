package com.wotb.core.replay.timeline;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class BattleDeltaEngine {

    private BattleDeltaEngine() {
    }

    static List<BattleDelta> compute(
            final int second,
            final double t,
            final Map<Integer, FrameVehicle> prev,
            final Map<Integer, FrameVehicle> cur,
            final List<ReplayEvent> windowEvents,
            final int trustedDamageInWindow,
            final boolean firstContactSeen,
            final int prevFriendlyAlive,
            final int prevEnemyAlive,
            final int prevFriendlyPoints,
            final int prevEnemyPoints,
            final int prevEnemyKnown,
            final int prevEnemyLastKnown,
            final int prevEnemyUnknown,
            final WorldSummary world,
            final Map<Integer, Integer> prevHp,
            final Map<Integer, Double> prevHpObservedAt,
            final Map<Integer, VehicleKnowledgeState> prevKnowledge,
            final Map<Integer, FramePosition> prevPositions,
            final Map<Integer, Integer> prevRegions,
            final Map<Integer, Boolean> prevDestroyed) {

        final List<BattleDelta> out = new ArrayList<>();

        final boolean firstContact = !firstContactSeen
                && windowEvents.stream().anyMatch(DamageEvent.class::isInstance);
        if (firstContact) {
            out.add(new BattleDelta(DeltaKind.FIRST_CONTACT, second, t, null,
                    Map.of(), Map.of("detail", "first damage event")));
        }

        for (final Map.Entry<Integer, FrameVehicle> entry : cur.entrySet()) {
            final int eid = entry.getKey();
            final FrameVehicle v = entry.getValue();
            final FrameVehicle p = prev.get(eid);
            final boolean isEnemy = !v.friendly();

            final VehicleKnowledgeState prevState = prevKnowledge.get(eid);
            final VehicleKnowledgeState curState = v.knowledgeState();
            if (isEnemy && prevState != null && prevState != curState) {
                if (prevState == VehicleKnowledgeState.UNKNOWN
                        && curState == VehicleKnowledgeState.POSITION_STREAM_ACTIVE) {
                    out.add(new BattleDelta(DeltaKind.FIRST_KNOWN, second, t, eid,
                            Map.of(), Map.of("state", "first position stream")));
                } else if (prevState == VehicleKnowledgeState.POSITION_STREAM_ACTIVE
                        && (curState == VehicleKnowledgeState.LAST_KNOWN
                        || curState == VehicleKnowledgeState.UNKNOWN)) {
                    out.add(new BattleDelta(DeltaKind.ENEMY_LOST, second, t, eid,
                            Map.of("ageSec", v.position() == null ? 0d
                                    : v.position().positionAgeSec() == null ? 0d
                                    : v.position().positionAgeSec()),
                            Map.of("state", "position stream interrupted")));
                } else if ((prevState == VehicleKnowledgeState.LAST_KNOWN
                        || prevState == VehicleKnowledgeState.UNKNOWN)
                        && curState == VehicleKnowledgeState.POSITION_STREAM_ACTIVE) {
                    final boolean wasSeen = prevState == VehicleKnowledgeState.LAST_KNOWN;
                    out.add(new BattleDelta(wasSeen ? DeltaKind.ENEMY_REACQUIRED : DeltaKind.FIRST_KNOWN,
                            second, t, eid, Map.of(), Map.of("state", "position stream resumed")));
                }
            }

            final FramePosition curPos = v.position();
            final FramePosition prevPos = prevPositions.get(eid);
            if (curPos != null && prevPos != null
                    && curPos.position() != null && prevPos.position() != null
                    && curPos.knowledge() == PositionKnowledge.CURRENT) {
                final double dist = planarDistance(prevPos.position(), curPos.position());
                if (dist >= BattleTimelineBuilder.POSITION_CHANGE_THRESHOLD_M) {
                    out.add(new BattleDelta(DeltaKind.POSITION_CHANGE, second, t, eid,
                            Map.of("distanceM", dist),
                            Map.of("from", pointLabel(prevPos.position()),
                                    "to", pointLabel(curPos.position()))));
                }
                final Integer curRegion = v.mapState() == null ? null : v.mapState().gridRegion();
                final Integer prevRegion = prevRegions.get(eid);
                if (curRegion != null && prevRegion != null && !curRegion.equals(prevRegion)) {
                    out.add(new BattleDelta(DeltaKind.REGION_CHANGE, second, t, eid,
                            Map.of(),
                            Map.of("fromRegion", "GRID_REGION_" + prevRegion,
                                    "toRegion", "GRID_REGION_" + curRegion)));
                }
            }

            final Integer curHp = v.health() == null ? null : v.health().currentHp();
            final Integer prevHpVal = prevHp.get(eid);
            if (curHp != null && prevHpVal != null && !curHp.equals(prevHpVal)) {
                final double delta = curHp - prevHpVal;
                final Double prevObserved = prevHpObservedAt.get(eid);
                final Double curObserved = v.health().observedAtSec();
                final boolean gapInPosition = prevPos != null
                        && prevPos.knowledge() != PositionKnowledge.CURRENT;
                final String side = v.friendly() ? "friendly" : "enemy";
                if (gapInPosition && delta < 0 && prevObserved != null && curObserved != null
                        && (curObserved - prevObserved) > 1.0) {
                    out.add(new BattleDelta(DeltaKind.HP_GAP_DELTA, second, t, eid,
                            Map.of("previousKnownHp", (double) prevHpVal,
                                    "newKnownHp", (double) curHp,
                                    "hpDelta", delta,
                                    "informationGapSec", curObserved - prevObserved),
                            Map.of("exactCauseUnknown", "true", "side", side)));
                } else {
                    out.add(new BattleDelta(DeltaKind.HP_CHANGE, second, t, eid,
                            Map.of("hpDelta", delta,
                                    "hpFrom", (double) prevHpVal,
                                    "hpTo", (double) curHp),
                            Map.of("side", side)));
                }
            }

            final boolean curDestroyed = v.lifeState() == LifeState.DESTROYED;
            final boolean wasDestroyed = prevDestroyed.getOrDefault(eid, false);
            if (curDestroyed && !wasDestroyed) {
                out.add(new BattleDelta(DeltaKind.DESTROYED, second, t, eid,
                        Map.of(), Map.of("killerKnown", "false")));
            }
        }

        if (prevFriendlyAlive >= 0 && world.friendlyAlive() != prevFriendlyAlive) {
            out.add(new BattleDelta(DeltaKind.ALIVE_COUNT_CHANGE, second, t, null,
                    Map.of("friendlyAlive", (double) world.friendlyAlive(),
                            "enemyAlive", (double) world.enemyAlive(),
                            "friendlyDelta", (double) (world.friendlyAlive() - prevFriendlyAlive)),
                    Map.of("side", "friendly")));
        }
        if (prevEnemyAlive >= 0 && world.enemyAlive() != prevEnemyAlive) {
            out.add(new BattleDelta(DeltaKind.ALIVE_COUNT_CHANGE, second, t, null,
                    Map.of("friendlyAlive", (double) world.friendlyAlive(),
                            "enemyAlive", (double) world.enemyAlive(),
                            "enemyDelta", (double) (world.enemyAlive() - prevEnemyAlive)),
                    Map.of("side", "enemy")));
        }

        if (prevEnemyKnown >= 0
                && (world.enemyKnown() != prevEnemyKnown
                || world.enemyLastKnown() != prevEnemyLastKnown
                || world.enemyUnknown() != prevEnemyUnknown)) {
            out.add(new BattleDelta(DeltaKind.LOCAL_FORCE_CHANGE, second, t, null,
                    Map.of("enemyKnown", (double) world.enemyKnown(),
                            "enemyLastKnown", (double) world.enemyLastKnown(),
                            "enemyUnknown", (double) world.enemyUnknown()),
                    Map.of()));
        }

        if (prevFriendlyPoints != Integer.MIN_VALUE && world.friendlyPoints() != null
                && world.friendlyPoints() != prevFriendlyPoints) {
            out.add(new BattleDelta(DeltaKind.POINTS_CHANGE, second, t, null,
                    Map.of("friendlyPoints", (double) world.friendlyPoints()),
                    Map.of("side", "friendly")));
        }
        if (prevEnemyPoints != Integer.MIN_VALUE && world.enemyPoints() != null
                && world.enemyPoints() != prevEnemyPoints) {
            out.add(new BattleDelta(DeltaKind.POINTS_CHANGE, second, t, null,
                    Map.of("enemyPoints", (double) world.enemyPoints()),
                    Map.of("side", "enemy")));
        }

        if (trustedDamageInWindow > 0) {
            out.add(new BattleDelta(DeltaKind.ENGAGEMENT_ACTIVITY, second, t, null,
                    Map.of("damageInWindow", (double) trustedDamageInWindow),
                    Map.of()));
        }

        return out;
    }

    private static double planarDistance(final Vector3 a, final Vector3 b) {
        final double dx = a.x() - b.x();
        final double dz = a.z() - b.z();
        return Math.sqrt(dx * dx + dz * dz);
    }

    private static String pointLabel(final Vector3 p) {
        return String.format("(%.0f,%.0f)", p.x(), p.z());
    }
}
