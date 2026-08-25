package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 同 arenaId 多份回放的<b>关键事实一致性</b>比较与<b>确定性死亡时间收口</b>
 * （当前上传批次内去重用，不建立持久化记录）。
 *
 * <p>比较覆盖：两队账号与车辆阵容、winnerTeam、玩家关键结算数据、生存状态、
 * 死亡时间、能够影响 Rating 的其他事实。任一关键事实不一致 → 冲突，
 * 该场全部副本均拒绝评分（{@code CONFLICTING_REPLAYS_FOR_ARENA}）。</p>
 *
 * <p><b>死亡时间 UNKNOWN ≠ 事实冲突</b>：{@code survivalTimeSec == 0} 表示当前 replay
 * 无法可靠证明精确死亡时刻（evidence absence），不是「已证明死亡时间为 0 秒」——
 * UNKNOWN 与任何值都兼容（UNKNOWN+UNKNOWN / UNKNOWN+KNOWN 都不是 conflict）；
 * 只有两个<b>已知</b>（{@code > 0}）死亡时间超过容差才是冲突。</p>
 *
 * <p>一致副本经 {@link #reconcileDeathTimes} 做确定性 canonical 收口（与上传顺序无关）：
 * UNKNOWN+KNOWN → 采用 KNOWN；KNOWN+KNOWN → 采用全部 KNOWN 的最小值；
 * 全部 UNKNOWN → 保持 UNKNOWN(0)。</p>
 */
public final class LeagueRatingConflictDetector {

    /** 死亡时间容差（秒）：两份 KNOWN 死亡时间的最大允许漂移（浮点/事件流差异）。 */
    private static final double DEATH_TIME_TOLERANCE_SEC = 1.0;

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

    /**
     * 死亡时间一致性：存活玩家双方均存活；阵亡玩家 {@code survivalTimeSec == 0} =
     * UNKNOWN（证据缺失，与任何值兼容）；两个 KNOWN 值差 ≤ {@value #DEATH_TIME_TOLERANCE_SEC}s
     * 视为一致；负数 / NaN / Infinity（非法 stat facts）与其它值不一致（关键事实冲突）。
     */
    private static boolean sameDeathTime(final PlayerResult a, final PlayerResult b) {
        if (a.survived != b.survived) {
            return false;
        }
        if (a.survived) {
            return true;
        }
        final double x = a.survivalTimeSec;
        final double y = b.survivalTimeSec;
        if (x == 0 || y == 0) {
            // UNKNOWN(0) 是证据缺失，不是数值 0：与任何死亡时间证据兼容（canonical 阶段再收口）
            return true;
        }
        if (!Double.isFinite(x) || !Double.isFinite(y) || x < 0 || y < 0) {
            // 负数 / NaN / Infinity = 非法 stat facts：与其它任何值都是关键事实冲突
            return false;
        }
        return Math.abs(x - y) <= DEATH_TIME_TOLERANCE_SEC;
    }

    /**
     * 同 arenaId 一致副本的<b>确定性死亡时间收口</b>（canonical death time）。
     *
     * <p>规则（与输入顺序无关）：阵亡玩家死亡时间 UNKNOWN(0) 是证据缺失而非数值 0；
     * 任一副本提供 KNOWN({@code > 0}) 时 canonical = 全部 KNOWN 值的最小值；
     * 没有任何 KNOWN 证据时 canonical = UNKNOWN(0)。原地校准 {@code first}
     * （副本中保留的一份），其余副本仅作证据源。存活玩家不受影响。</p>
     *
     * <p>调用前提：{@code copies} 已通过 {@link #consistent} 一致性检查（canonical
     * 只处理「证据缺失 vs 已知」的差异，不修复其它关键事实冲突）。</p>
     */
    public static void reconcileDeathTimes(final Battle first, final List<Battle> copies) {
        if (first == null || first.players == null || first.players.isEmpty()
                || copies == null || copies.isEmpty()) {
            return;
        }
        final Map<Long, Double> minKnownByAccount = new HashMap<>();
        for (final Battle battle : copies) {
            if (battle == null || battle.players == null) {
                continue;
            }
            for (final PlayerResult p : battle.players) {
                if (!p.survived && p.survivalTimeSec > 0 && Double.isFinite(p.survivalTimeSec)) {
                    minKnownByAccount.merge(p.accountId, p.survivalTimeSec, Math::min);
                }
            }
        }
        for (final PlayerResult p : first.players) {
            if (p.survived) {
                continue;
            }
            final Double minKnown = minKnownByAccount.get(p.accountId);
            if (minKnown != null) {
                // UNKNOWN + KNOWN → KNOWN；KNOWN + KNOWN → 最小 KNOWN（确定性，与上传顺序无关）
                p.survivalTimeSec = minKnown;
            } else if (p.survivalTimeSec != 0) {
                // 没有任何 KNOWN 证据 → canonical UNKNOWN(0)：不把非法/非零残留留给 validator
                p.survivalTimeSec = 0;
            }
        }
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
