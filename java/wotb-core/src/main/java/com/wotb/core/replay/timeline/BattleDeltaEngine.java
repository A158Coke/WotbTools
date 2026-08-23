package com.wotb.core.replay.timeline;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 帧间确定性变化引擎：Frame(t-1) → Frame(t) 的重要变化（docs/current-plan.md §15）。
 * <p>只产生有战术意义的 delta，不把每个微小 Position packet 变成 AI delta；
 * 所有 delta 结构化、可测试，供 AI Context Compiler 渲染。</p>
 */
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

        // 首次接敌
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

            // 敌方知识状态变化
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

            // 位置变化（两帧都有位置且当前位置有效）
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

            // HP 变化 / 信息空窗 HP 差异
            final Integer curHp = v.health() == null ? null : v.health().currentHp();
            final Integer prevHpVal = prevHp.get(eid);
            if (curHp != null && prevHpVal != null && !curHp.equals(prevHpVal)) {
                final double delta = curHp - prevHpVal;
                final Double prevObserved = prevHpObservedAt.get(eid);
                final Double curObserved = v.health().currentHpObservedAtSec();
                final boolean gapInPosition = prevPos != null
                        && prevPos.knowledge() != PositionKnowledge.CURRENT;
                // side 属性：friendly/enemy，供 Context Compiler 渲染正确称谓（你/我方/敌方），
                // 避免己方掉血被误渲染成敌方 HP 变化。
                final String side = v.friendly() ? "friendly" : "enemy";
                if (gapInPosition && delta < 0 && prevObserved != null && curObserved != null
                        && (curObserved - prevObserved) > 1.0) {
                    // 信息空窗后重亮：HP 下降只能确定幅度，不能确定精确时刻/攻击者/原因
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

            // 阵亡（当时已知）
            final boolean curDestroyed = v.lifeState() == LifeState.DESTROYED;
            final boolean wasDestroyed = prevDestroyed.getOrDefault(eid, false);
            if (curDestroyed && !wasDestroyed) {
                out.add(new BattleDelta(DeltaKind.DESTROYED, second, t, eid,
                        Map.of(), Map.of("killerKnown", "false")));
            }
        }

        // 双方存活人数变化
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

        // 敌方知识分布变化（局部兵力/已知度）
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

        // 争霸赛点数变化
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

        // 帧内交火活动（§11–§17：只使用权威 HP loss——Type-8 rawProtocolValue 语义未证明，
        // 不得作为交火活动强度；由 BattleTimelineBuilder 预计算本帧可信掉血传入）
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