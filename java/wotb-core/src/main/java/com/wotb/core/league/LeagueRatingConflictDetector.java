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
 * <p><b>Hard conflict vs evidence reconciliation（field 分类契约）</b>：
 * <ul>
 * <li><b>Hard conflict（任何不一致 → 整场拒绝评分）</b>：两队账号与车辆阵容、
 *     winnerTeam、arenaBonusType、rosterComplete、玩家关键结算数据（damage/assist/received/
 *     blocked/kills/shots/hits/pens/victoryPoints/命中/被击穿/击伤）、生存状态、
 *     clan（影响 League team autoName / teamKey / 批次汇总 identity）、durationS
 *     （影响死亡时间 &gt; duration + 1s 的非法判定）、settlementAccountsCoveredByRoster /
 *     settlementRosterTeamConsistent（直接决定 ROSTER_INCOMPLETE）。</li>
 * <li><b>Evidence reconciliation（仅死亡时间）</b>：{@code survivalTimeSec} 的
 *     UNKNOWN(0) 是证据缺失，可被其它副本的 KNOWN 证据补强；除此字段外，
 *     <b>不存在</b>「字段更多 replay 优先」的通用 reconciliation。</li>
 * </ul>
 * 任一 hard-conflict 事实不一致 → 冲突，该场全部副本均拒绝评分
 * （{@code CONFLICTING_REPLAYS_FOR_ARENA}）。</p>
 *
 * <p><b>死亡时间语义三层（先判 INVALID，再判 UNKNOWN/KNOWN）</b>：
 * <ol>
 * <li><b>INVALID</b>（{@code survivalTimeSec < 0} / NaN / Infinity）：非法 stat facts，
 *     与<b>任何</b>其它值（含 UNKNOWN 0）都 conflict——UNKNOWN 不是 wildcard，
 *     不能把两个互相矛盾的 KNOWN 或一个 INVALID 洗成合法；</li>
 * <li><b>UNKNOWN</b>（{@code == 0}）：精确死亡时刻无法从回放可靠证明（evidence
 *     absence），与任意合法 KNOWN / 其它 UNKNOWN 兼容；</li>
 * <li><b>KNOWN</b>（{@code > 0}）：两个 KNOWN 差 ≤ {@value #DEATH_TIME_TOLERANCE_SEC}s
 *     一致，超过容差 conflict。</li>
 * </ol>
 * 一致副本经 {@link #validateAndReconcile} 做<b>group-level</b>判定与确定性 canonical
 * 收口（与上传顺序无关，见该方法 javadoc）。</p>
 */
public final class LeagueRatingConflictDetector {

    /** 死亡时间容差（秒）：两份 KNOWN 死亡时间的最大允许漂移（浮点/事件流差异）。 */
    private static final double DEATH_TIME_TOLERANCE_SEC = 1.0;

    private LeagueRatingConflictDetector() {
    }

    /** 两份同 arenaId 回放是否关键事实一致（hard-conflict 全字段逐项比较）。 */
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
        // hard conflict：结算覆盖/队伍一致证据直接决定 ROSTER_INCOMPLETE，必须逐项一致
        if (!java.util.Objects.equals(a.settlementAccountsCoveredByRoster,
                b.settlementAccountsCoveredByRoster)) {
            return false;
        }
        if (!java.util.Objects.equals(a.settlementRosterTeamConsistent,
                b.settlementRosterTeamConsistent)) {
            return false;
        }
        // hard conflict：duration 影响「死亡时间 &gt; duration + 1s」的 INVALID 判定
        if (!java.util.Objects.equals(a.durationS, b.durationS)) {
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
                    // validator 非法值检查参与的字段：不一致 = 稳定业务输出不同（hard conflict）
                    || pa.nHitsReceived != pb.nHitsReceived
                    || pa.nPenetrationsReceived != pb.nPenetrationsReceived
                    || pa.nEnemiesDamaged != pb.nEnemiesDamaged
                    // clan 影响 League team autoName / teamKey / batch team summary identity
                    || !java.util.Objects.equals(pa.clan, pb.clan)
                    || !sameDeathTime(pa, pb)) {
                return false;
            }
        }
        return true;
    }

    /**
     * 死亡时间一致性（<b>先判 INVALID，再判 UNKNOWN/KNOWN</b>）：
     * 存活玩家双方均存活；阵亡玩家 {@code survivalTimeSec < 0} / NaN / Infinity =
     * 非法 stat facts，与<b>任何</b>其它值（含 UNKNOWN 0）都是 conflict——
     * UNKNOWN 不是 wildcard，不得把 INVALID 或互相矛盾的 KNOWN 洗成合法；
     * {@code == 0} = UNKNOWN（证据缺失，与任意合法 KNOWN / 其它 UNKNOWN 兼容）；
     * 两个 KNOWN 值差 ≤ {@value #DEATH_TIME_TOLERANCE_SEC}s 视为一致。
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
        // 1) INVALID first：与任何值都 conflict（含 0）——fail closed，禁止洗成 UNKNOWN
        if (invalid(x) || invalid(y)) {
            return false;
        }
        // 2) UNKNOWN(0) 是证据缺失，不是数值 0：与任何合法值兼容（canonical 阶段再收口）
        if (x == 0 || y == 0) {
            return true;
        }
        // 3) KNOWN vs KNOWN：容差内一致
        return Math.abs(x - y) <= DEATH_TIME_TOLERANCE_SEC;
    }

    /** 非法死亡时间 stat fact：负数 / NaN / Infinity（UNKNOWN=0 合法，不算 invalid）。 */
    private static boolean invalid(final double v) {
        return !Double.isFinite(v) || v < 0;
    }

    /**
     * <b>Group-level</b> 判定与收口：对同 arenaId 全部副本做<b>全对（all-pairs）</b>
     * 关键事实一致性检查——不再以 first copy 作 wildcard anchor（UNKNOWN 不能隔开两个
     * 互相矛盾的 KNOWN；上传顺序不能决定是否评分）。全部一致时才做确定性 canonical
     * 死亡时间收口并返回 {@code true}；任一 pair conflict → 返回 {@code false}，
     * <b>不</b>做任何 canonical mutation（INVALID 绝不会被洗成 UNKNOWN）。
     *
     * <p>Canonical 规则（与输入顺序无关）：阵亡玩家死亡时间 UNKNOWN(0) 是证据缺失；
     * 任一副本提供 KNOWN({@code > 0}) 时 canonical = 全部 KNOWN 值的最小值；
     * 没有任何 KNOWN 证据时 canonical = UNKNOWN(0)。原地校准 {@code first}
     * （副本中保留的一份），其余副本仅作证据源。存活玩家不受影响。</p>
     *
     * @param copies 同 arenaId 的全部副本（含保留的一份；size &lt; 2 时直接视为一致）
     * @return group 是否一致（true = 已做 canonical 收口；false = conflict，无 mutation）
     */
    public static boolean validateAndReconcile(final List<Battle> copies) {
        if (copies == null || copies.isEmpty() || copies.getFirst() == null) {
            return false;
        }
        // all-pairs：每个 pair 都必须一致——first 不能作 UNKNOWN wildcard
        // （[UNKNOWN, KNOWN100, KNOWN128]：UNKNOWN 与两个 KNOWN 各 pair 都一致，
        //  但 KNOWN100 vs KNOWN128 超容差 → group conflict，与上传顺序无关）
        for (int i = 0; i < copies.size(); i++) {
            for (int j = i + 1; j < copies.size(); j++) {
                if (!consistent(copies.get(i), copies.get(j))) {
                    return false;
                }
            }
        }
        reconcileDeathTimes(copies.getFirst(), copies);
        return true;
    }

    /**
     * 同 arenaId 一致副本的<b>确定性死亡时间收口</b>（canonical death time）。
     *
     * <p>规则（与输入顺序无关）：阵亡玩家死亡时间 UNKNOWN(0) 是证据缺失而非数值 0；
     * 任一副本提供 KNOWN({@code > 0}) 时 canonical = 全部 KNOWN 值的最小值；
     * 没有任何 KNOWN 证据时 canonical = UNKNOWN(0)。原地校准 {@code first}
     * （副本中保留的一份），其余副本仅作证据源。存活玩家不受影响。</p>
     *
     * <p>调用前提：{@code copies} 已通过 {@link #validateAndReconcile} 的 all-pairs
     * 一致性检查。canonicalizer <b>只处理合法值</b>（UNKNOWN=0 / KNOWN=finite&gt;0）；
     * INVALID（负数 / NaN / Infinity）在一致性阶段已 fail-closed 拒绝，
     * 本方法<b>绝不</b>修改、替换、清洗非法值（禁止 INVALID→UNKNOWN）。</p>
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
            }
            // 没有任何 KNOWN 证据 → 保持原值（一致性已保证只可能是 UNKNOWN(0)；
            // INVALID 已在 validateAndReconcile 阶段 fail-closed 拒绝，绝不清洗）
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
