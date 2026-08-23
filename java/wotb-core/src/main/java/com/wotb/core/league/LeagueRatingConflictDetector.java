package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 同 arenaId 多份回放的<b>关键事实一致性</b>比较（当前上传批次内去重用，不建立持久化记录）。
 *
 * <p>比较覆盖（plan §4）：两队账号与车辆阵容、winnerTeam、玩家关键结算数据、
 * 生存状态、死亡时间、能够影响 Rating 的其他事实。任一关键事实不一致 → 冲突，
 * 该场全部副本均拒绝评分（{@code CONFLICTING_REPLAYS_FOR_ARENA}）。</p>
 */
public final class LeagueRatingConflictDetector {

    private LeagueRatingConflictDetector() {
    }

    /** 两份同 arenaId 回放是否关键事实一致。 */
    public static boolean consistent(final Battle a, final Battle b) {
        if (a == null || b == null) {
            return false;
        }
        if (!java.util.Objects.equals(a.winnerTeam, b.winnerTeam)) {
            return false;
        }
        if (!java.util.Objects.equals(a.arenaBonusType, b.arenaBonusType)) {
            return false;
        }
        if (!java.util.Objects.equals(a.rosterComplete, b.rosterComplete)) {
            return false;
        }
        final Map<Long, PlayerResult> byAccountA = byAccount(a.players);
        final Map<Long, PlayerResult> byAccountB = byAccount(b.players);
        if (byAccountA.size() != byAccountB.size()) {
            return false;
        }
        for (final Map.Entry<Long, PlayerResult> e : byAccountA.entrySet()) {
            final PlayerResult pa = e.getValue();
            final PlayerResult pb = byAccountB.get(e.getKey());
            if (pb == null) {
                return false;
            }
            if (pa.team != pb.team || pa.tankId != pb.tankId
                    || pa.survived != pb.survived
                    || pa.damageDealt != pb.damageDealt
                    || pa.damageAssisted != pb.damageAssisted
                    || pa.damageReceived != pb.damageReceived
                    || pa.damageBlocked != pb.damageBlocked
                    || pa.kills != pb.kills
                    || pa.nShots != pb.nShots
                    || pa.nHitsDealt != pb.nHitsDealt
                    || pa.nPenetrationsDealt != pb.nPenetrationsDealt
                    || pa.victoryPointsEarned != pb.victoryPointsEarned
                    || pa.victoryPointsSeized != pb.victoryPointsSeized
                    || !sameDeathTime(pa, pb)) {
                return false;
            }
        }
        return true;
    }

    /** 死亡时间比较：存活玩家双方均存活；阵亡玩家 survivalTimeSec 差 ≤ 1s（容忍浮点/事件流差异）。 */
    private static boolean sameDeathTime(final PlayerResult a, final PlayerResult b) {
        if (a.survived != b.survived) {
            return false;
        }
        if (a.survived) {
            return true;
        }
        return Math.abs(a.survivalTimeSec - b.survivalTimeSec) <= 1.0;
    }

    private static Map<Long, PlayerResult> byAccount(final List<PlayerResult> players) {
        final Map<Long, PlayerResult> map = new HashMap<>();
        if (players != null) {
            for (final PlayerResult p : players) {
                map.put(p.accountId, p);
            }
        }
        return map;
    }
}
