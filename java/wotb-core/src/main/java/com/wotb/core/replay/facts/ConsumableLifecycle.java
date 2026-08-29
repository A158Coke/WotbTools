package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.ConsumableLifecycleEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Canonical consumable runtime facts（P0-7）。
 *
 * <p>与 loadout 不同：loadout 是持久配置（离开 AoI 仍 KNOWN），但 consumable <b>runtime</b>
 * （当前可用性 / cooldown）在敌方 hidden interval（UNKNOWN_AOI）内 = UNKNOWN —— 不能因为
 * "没看到 Type32 activation" 就显示 READY。</p>
 *
 * <p>本 builder 汇总每个 {@link ConsumableLifecycleEvent} 为「可证明的 activation / active /
 * cooldown-transition / teardown」观测。entity/AoI scoped：缺失 activation 不等于未使用。</p>
 */
public final class ConsumableLifecycle {

    private ConsumableLifecycle() {
    }

    /** 单条 consumable lifecycle 观测（battle-relative 秒；raw session-clock 仅 provenance）。 */
    public record ConsumableObservation(
            int entityId,
            long accountId,
            double timeSec,
            int wireCode,
            String logicalItemId,
            ConsumableLifecycleEvent.ConsumableLifecycleState state,
            double eventClockRaw,
            float effectiveParamSec,
            DecodeConfidence confidence
    ) {
        public boolean stateProven() {
            return confidence == DecodeConfidence.EXACT;
        }
    }

    /** 构建全部 consumable lifecycle 观测并按 accountId 索引（battle-relative 秒升序）。 */
    public static Map<Long, List<ConsumableObservation>> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec) {
        if (events == null || mapping == null) {
            return Map.of();
        }
        final double start = startRawClockSec != null && Double.isFinite(startRawClockSec)
                ? startRawClockSec : Double.NaN;
        final Map<Long, List<ConsumableObservation>> byAccount = new HashMap<>();
        for (final ReplayEvent e : events) {
            if (e instanceof ConsumableLifecycleEvent c) {
                final double t = clockOf(e, start);
                if (Double.isFinite(t)) {
                    final long account = accountOf(mapping, c.entityId());
                    byAccount.computeIfAbsent(account, k -> new ArrayList<>()).add(
                            new ConsumableObservation(c.entityId(), account, t, c.wireCode(),
                                    c.logicalItemId(), c.state(), c.eventClockRaw(),
                                    c.effectiveParamSec(), c.confidence()));
                }
            }
        }
        byAccount.values().forEach(l -> l.sort(Comparator.comparingDouble(ConsumableObservation::timeSec)
                .thenComparingInt(ConsumableObservation::entityId)));
        return byAccount;
    }

    /** 最近一次 ≤t 的 consumable lifecycle 观测；无 → null（hidden interval 或从无观测）。 */
    public static ConsumableObservation lastAtOrBefore(
            final Map<Long, List<ConsumableObservation>> byAccount,
            final long accountId,
            final double t) {
        final List<ConsumableObservation> list = byAccount.get(accountId);
        if (list == null) {
            return null;
        }
        ConsumableObservation last = null;
        for (final ConsumableObservation o : list) {
            if (o.timeSec() <= t + 1e-9) {
                last = o;
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
