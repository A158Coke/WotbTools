package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.LifeState;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Calculates world-level team counts, points and the authoritative actual-combatant roster. */
final class TimelineRosterSummary {
    private TimelineRosterSummary() {
    }

    // ===== world summary =====

    static WorldSummary worldSummary(
            final List<FrameVehicle> vehicles,
            final Battle battle,
            final int perspectiveTeam,
            final EntityIndex index,
            final double t) {
        int friendlyTotal = 0;
        int enemyTotal = 0;
        int friendlyDestroyed = 0;
        int enemyDestroyed = 0;
        int enemyKnown = 0;
        int enemyLastKnown = 0;
        int friendlyAlive = 0;
        int enemyAlive = 0;

        for (final FrameVehicle v : vehicles) {
            if (v.team() == null) {
                continue;
            }
            if (v.friendly()) {
                friendlyTotal++;
                if (v.lifeState() == LifeState.DESTROYED) {
                    friendlyDestroyed++;
                }
            } else {
                enemyTotal++;
                // knowledge partition 必须互斥：一辆车只属于一种知识状态；
                // DESTROYED_KNOWN ⟺ lifeState DESTROYED（frameVehicle 保证），只计一次 destroyed。
                switch (v.knowledgeState()) {
                    case POSITION_STREAM_ACTIVE -> enemyKnown++;
                    case LAST_KNOWN -> enemyLastKnown++;
                    case DESTROYED_KNOWN -> enemyDestroyed++;
                    case UNKNOWN -> {
                        // 从未观测到位置：计入 roster 未知（见下方 roster 计算）
                    }
                }
            }
        }

        // roster-level totals（account 级；含从未出现在事件流的车辆）
        final RosterCounts roster = rosterCounts(battle, perspectiveTeam);
        final int friendlyTotalRoster = roster.friendly();
        final int enemyTotalRoster = roster.enemy();
        if (friendlyTotalRoster > friendlyTotal) {
            friendlyTotal = friendlyTotalRoster;
        }
        if (enemyTotalRoster > enemyTotal) {
            enemyTotal = enemyTotalRoster;
        }

        friendlyAlive = friendlyTotal - friendlyDestroyed;
        enemyAlive = enemyTotal - enemyDestroyed;

        // 未知敌人数 = roster 敌人数 - 已知(含 last-known) - 已确知阵亡
        final int enemyKnownTotal = enemyKnown + enemyLastKnown;
        final int enemyUnknown = Math.max(0, enemyTotalRoster - enemyKnownTotal - enemyDestroyed);

        final EntityIndex.PointsAt points = index.pointsAt(t, perspectiveTeam);

        return new WorldSummary(
                Math.max(0, friendlyAlive),
                Math.max(0, enemyAlive),
                Math.max(0, friendlyTotal),
                Math.max(0, enemyTotal),
                enemyKnown,
                enemyLastKnown,
                enemyUnknown,
                enemyDestroyed,
                points.friendly(),
                points.enemy());
    }

    record RosterCounts(int friendly, int enemy) {
    }

    /**
     * #301 actual combatant 账号集（battle.players，accountId > 0）。
     * spectator/observer/camera/场景静态实体不在 #301 中，即使出现在 #201 / updateArena2 / 事件流
     * 也不得进入 tactical vehicle universe（ActualCombatantSet == battle_results #301）。
     */
    static Set<Long> actualCombatantAccounts(final Battle battle) {
        if (battle == null || battle.players == null) {
            return Set.of();
        }
        final Set<Long> accounts = new HashSet<>();
        for (final PlayerResult p : battle.players) {
            if (p != null && p.accountId > 0) {
                accounts.add(p.accountId);
            }
        }
        return accounts;
    }

    static RosterCounts rosterCounts(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null || perspectiveTeam <= 0) {
            return new RosterCounts(0, 0);
        }
        int friendly = 0;
        int enemy = 0;
        for (final PlayerResult p : battle.players) {
            if (p != null && p.team > 0) {
                if (p.team == perspectiveTeam) {
                    friendly++;
                } else {
                    enemy++;
                }
            }
        }
        return new RosterCounts(friendly, enemy);
    }

}
