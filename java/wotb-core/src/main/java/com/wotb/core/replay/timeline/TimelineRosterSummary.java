package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.LifeState;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class TimelineRosterSummary {
    private TimelineRosterSummary() {
    }


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
                switch (v.knowledgeState()) {
                    case POSITION_STREAM_ACTIVE -> enemyKnown++;
                    case LAST_KNOWN -> enemyLastKnown++;
                    case DESTROYED_KNOWN -> enemyDestroyed++;
                    case UNKNOWN -> {
                    }
                }
            }
        }

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
