package com.wotb.core.parse;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 死亡时间估算器：EntityLeave / Position 停止更新 / 逐次伤害阈值三条证据链的死亡时刻估算。
 * <p>从 {@link EventStreamReader} 拆出，纯静态工具类。</p>
 */
final class DeathTimeEstimator {

    private DeathTimeEstimator() {
    }

    /**
     * 根据 EntityLeave 事件推算死亡时间。
     * 取该实体最后一次 leave 的时刻作为死亡时间。
     */
    public static double estimateDeathTimeByEntity(
            int entityId, double battleDurationS, List<EventStreamReader.EntityLeaveEvent> leaves) {
        double last = 0;
        for (final EventStreamReader.EntityLeaveEvent ev : leaves) {
            if (ev.entityId == entityId && ev.clockSecs > 0) {
                last = Math.max(last, ev.clockSecs);
            }
        }
        return last > 0 ? Math.min(last, battleDurationS) : 0;
    }

    /**
     * 用 entity_id ↔ account_id 映射 + EntityLeave 事件推算各玩家的死亡时间秒。
     * 返回 map: account_id → death_time_sec (0=未知,存活返回战斗时长)。
     */
    public static Map<Long, Double> estimateDeathTimesByEntityLeaves(
            List<EventStreamReader.ParsedPacket> packets, double battleDurationS) {
        final Map<Integer, Long> entityToAccount = ReplayEventExtractors.extractEntityToAccountMap(packets);
        final List<EventStreamReader.EntityLeaveEvent> leaves = ReplayEventExtractors.extractEntityLeaves(packets);
        final Map<Long, Double> deathTimes = new HashMap<>();
        for (final Map.Entry<Integer, Long> entry : entityToAccount.entrySet()) {
            final double dt = estimateDeathTimeByEntity(entry.getKey(), battleDurationS, leaves);
            deathTimes.put(entry.getValue(), dt);
        }
        return deathTimes;
    }

    /**
     * 用 entity_id ↔ account_id 映射 + Position 事件推算各玩家死亡时间。
     * Position 更新停止的时间 ≈ 玩家阵亡时间（玩家阵亡后不再发送坐标）。
     * 返回 map: account_id → death_time_sec (0=未知).
     */
    public static Map<Long, Double> estimateDeathTimesByPositions(
            List<EventStreamReader.ParsedPacket> packets, double battleDurationS) {
        final Map<Integer, Long> entityToAccount = ReplayEventExtractors.extractEntityToAccountMap(packets);
        final List<EventStreamReader.PositionData> positions = ReplayEventExtractors.extractPositions(packets);
        final Map<Integer, Double> lastPosByEid = new HashMap<>();
        for (final EventStreamReader.PositionData pos : positions) {
            lastPosByEid.merge(pos.entityId, (double) pos.clockSecs, Math::max);
        }
        final Map<Long, Double> deathTimes = new HashMap<>();
        for (final Map.Entry<Integer, Long> entry : entityToAccount.entrySet()) {
            final double lastPos = lastPosByEid.getOrDefault(entry.getKey(), 0.0);
            final double dt = lastPos > 0 ? Math.min(lastPos, battleDurationS) : 0;
            deathTimes.put(entry.getValue(), dt);
        }
        return deathTimes;
    }

    /**
     * 用 Type 8 EntityMethod (subtype 8 = damage) 推算各玩家死亡时间秒。
     * body 25B 格式: len(4) + attackerEid(4) + victimEid(4) + type(1) + sub(1) + dmgBE(2) + data(6) + flag(1)
     * sub=3 = direct HP damage. 双遍扫描：
     * 第 1 遍: 累计每个玩家的 sub3 总量 (sub3Total)。
     * 第 2 遍: 按时间顺序推进, 当累计值 >= threshold (= min(accountToThreshold, sub3Total)) 时记录阵亡时刻。
     * 返回 map: account_id → death_time_sec (0=未知).
     */
    public static Map<Long, Double> estimateDeathTimesByDamage(
            final List<EventStreamReader.ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount,
            final Map<Long, Integer> accountToThreshold,
            final double battleDurationS) {
        // 先行一步: 提取所有 sub3 事件并排序
        final List<EventStreamReader.DirectDamageEvent> events = ReplayEventExtractors.extractDirectDamageEvents(packets, entityToAccount);
        events.sort(Comparator.comparingDouble(EventStreamReader.DirectDamageEvent::clockSecs));

        // 第 1 遍: 累计 sub3Total
        final Map<Long, Integer> sub3Total = new HashMap<>();
        for (final EventStreamReader.DirectDamageEvent ev : events) {
            sub3Total.merge(ev.victimAccountId(), ev.damage(), Integer::sum);
        }

        // 第 2 遍: 找首次超阈值时刻
        final Map<Long, Integer> cumulative = new HashMap<>();
        final Map<Long, Double> result = new HashMap<>();
        // 预填充 0
        for (final Long acc : accountToThreshold.keySet()) {
            result.put(acc, 0.0);
        }
        for (final EventStreamReader.DirectDamageEvent ev : events) {
            final int prev = cumulative.getOrDefault(ev.victimAccountId(), 0);
            final int next = prev + ev.damage();
            cumulative.put(ev.victimAccountId(), next);
            // 该玩家死亡已找到?
            if (result.getOrDefault(ev.victimAccountId(), 0.0) > 0) continue;
            final Integer rcvThreshold = accountToThreshold.get(ev.victimAccountId());
            if (rcvThreshold == null || rcvThreshold <= 0) continue;
            // threshold = min(rcv, sub3Total) — sub3 可能无法覆盖全部受伤
            final int total = sub3Total.getOrDefault(ev.victimAccountId(), 0);
            final int threshold = Math.min(rcvThreshold, total);
            if (threshold > 0 && prev < threshold && next >= threshold) {
                result.put(ev.victimAccountId(), Math.min((double) ev.clockSecs(), battleDurationS));
            }
        }
        return result;
    }

    public static double estimateDeathTime(
            long accountId, boolean survived, double battleDurationS,
            List<EventStreamReader.ArenaSnapshot> snapshots) {
        if (survived) {
            return battleDurationS;
        }
        if (snapshots.isEmpty()) {
            return 0;
        }
        double lastSeen = -1;
        for (final EventStreamReader.ArenaSnapshot snap : snapshots) {
            if (snap.accountIds.contains(accountId)) {
                lastSeen = snap.clockSecs;
            }
        }
        if (lastSeen > 0 && lastSeen < battleDurationS) {
            return lastSeen;
        }
        return 0;
    }

}
