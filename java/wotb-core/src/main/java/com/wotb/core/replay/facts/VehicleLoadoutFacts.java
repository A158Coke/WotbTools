package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Canonical battle-loadout facts。
 *
 * <p>Loadout 是<b>持久战斗配置</b>：一旦 materialized combat vehicle 被观察到本场装备了什么，
 * 即使随后离开 AoI（Type4）该 loadout 仍是 KNOWN —— 不随 AoI 消失变 UNKNOWN。
 * 本 builder 消费 {@link MaterializationEvent#loadout()}，按 (entity, time) 记录观测，并提供
 * {@code knownAtOrBefore} / {@code loadoutAtOrBefore}。</p>
 *
 * <p>未 materialized 车辆 / 无完整 combat loadout framing 的实体 → UNKNOWN（loadout=null），不猜。</p>
 */
public final class VehicleLoadoutFacts {

    private VehicleLoadoutFacts() {
    }

    /** 单次 materialization 的 loadout 观测（battle-relative 秒）。 */
    public record LoadoutObservation(
            int entityId,
            long accountId,
            double timeSec,
            VehicleBattleLoadout loadout
    ) {
    }

    /** 构建全部 loadout 观测并按 accountId 索引（entity→account 由 {@link TeamEntityMapping} 解析）。 */
    public static Map<Long, List<LoadoutObservation>> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec) {
        if (events == null || mapping == null) {
            return Map.of();
        }
        final double start = startRawClockSec != null && Double.isFinite(startRawClockSec)
                ? startRawClockSec : Double.NaN;
        final Map<Long, List<LoadoutObservation>> byAccount = new HashMap<>();
        for (final ReplayEvent e : events) {
            if (e instanceof MaterializationEvent m && m.loadout() != null
                    && m.confidence() == com.wotb.core.replay.event.DecodeConfidence.EXACT) {
                final double t = clockOf(e, start);
                if (Double.isFinite(t)) {
                    final long account = accountOf(mapping, m.entityId());
                    byAccount.computeIfAbsent(account, k -> new ArrayList<>()).add(
                            new LoadoutObservation(m.entityId(), account, t, m.loadout()));
                }
            }
        }
        byAccount.values().forEach(l -> l.sort(Comparator.comparingDouble(LoadoutObservation::timeSec)
                .thenComparingInt(LoadoutObservation::entityId)));
        return byAccount;
    }

    /** 该账号在 t 时刻是否已知 loadout（任一 ≤t 的完整 materialization 已解码）。 */
    public static boolean knownAtOrBefore(
            final Map<Long, List<LoadoutObservation>> byAccount,
            final long accountId,
            final double t) {
        final List<LoadoutObservation> list = byAccount.get(accountId);
        if (list == null || list.isEmpty()) {
            return false;
        }
        return list.get(0).timeSec() <= t + 1e-9;
    }

    /** 最近一次 ≤t 的 loadout；无 → null（未被观测到 / 未 materialized / 非完整 framing）。 */
    public static VehicleBattleLoadout loadoutAtOrBefore(
            final Map<Long, List<LoadoutObservation>> byAccount,
            final long accountId,
            final double t) {
        final List<LoadoutObservation> list = byAccount.get(accountId);
        if (list == null) {
            return null;
        }
        VehicleBattleLoadout last = null;
        for (final LoadoutObservation o : list) {
            if (o.timeSec() <= t + 1e-9) {
                last = o.loadout();
            } else {
                break;
            }
        }
        return last;
    }

    private static long accountOf(final TeamEntityMapping mapping, final int entityId) {
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null && identity.accountId() > 0 ? identity.accountId() : -1L;
    }

    private static double clockOf(final ReplayEvent e, final double start) {
        if (e.timestamp() == null) {
            return Double.NaN;
        }
        final double raw = e.timestamp().rawClockSec();
        return Double.isFinite(start) ? raw - start : raw;
    }
}
