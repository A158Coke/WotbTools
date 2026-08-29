package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleModuleCrewStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Canonical vehicle module/crew state facts（P0-8）。
 *
 * <p><b>Observability</b>：method16 属 recorder-visible telemetry
 * （docs/research/replay/method16-device-crew-code-map.md）。不能因为 recorder 有某车 module info
 * 就假设所有 ally/enemy 同样可知 —— 每条状态必须带 provenance（{@code recorderVisible}）与
 * availability 边界。非 recorder vehicle 的状态不得当作全队真实 module 状态展示。</p>
 *
 * <p>proven transitions：module {@code DAMAGED/CRITICAL}、{@code 18→damaged auto-repair}、
 * {@code 19→full repair}；crew {@code INJURED}、{@code 22→healed}。UNKNOWN component raw-preserve。</p>
 */
public final class VehicleModuleCrewLifecycle {

    private VehicleModuleCrewLifecycle() {
    }

    /** 车辆模块/乘员状态观测。 */
    public record ModuleCrewObservation(
            int entityId,
            long accountId,
            double timeSec,
            int stateCodeRaw,
            int componentCodeRaw,
            VehicleModuleCrewStateEvent.Component component,
            VehicleModuleCrewStateEvent.State state,
            boolean recorderVisible,
            DecodeConfidence confidence
    ) {
    }

    /**
     * 构建全部 module/crew 观测并按 accountId 索引（battle-relative 秒升序）。
     *
     * @param recorderAccountId 录像者账号；method16 事件仅当映射到该账号时标 recorderVisible=true。
     */
    public static Map<Long, List<ModuleCrewObservation>> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Long recorderAccountId,
            final Double startRawClockSec) {
        if (events == null || mapping == null) {
            return Map.of();
        }
        final double start = startRawClockSec != null && Double.isFinite(startRawClockSec)
                ? startRawClockSec : Double.NaN;
        final Map<Long, List<ModuleCrewObservation>> byAccount = new HashMap<>();
        for (final ReplayEvent e : events) {
            if (e instanceof VehicleModuleCrewStateEvent m) {
                final double t = clockOf(e, start);
                if (Double.isFinite(t)) {
                    final long account = accountOf(mapping, m.vehicleId());
                    final boolean recorderVisible =
                            recorderAccountId != null && recorderAccountId > 0
                                    && account == recorderAccountId;
                    byAccount.computeIfAbsent(account, k -> new ArrayList<>()).add(
                            new ModuleCrewObservation(m.vehicleId(), account, t,
                                    m.stateCodeRaw(), m.componentCodeRaw(),
                                    m.component(), m.state(), recorderVisible, m.confidence()));
                }
            }
        }
        byAccount.values().forEach(l -> l.sort(Comparator.comparingDouble(ModuleCrewObservation::timeSec)
                .thenComparingInt(ModuleCrewObservation::entityId)));
        return byAccount;
    }

    /** 最近一次 ≤t 的 module/crew 状态；无 → null。 */
    public static ModuleCrewObservation lastAtOrBefore(
            final Map<Long, List<ModuleCrewObservation>> byAccount,
            final long accountId,
            final double t) {
        final List<ModuleCrewObservation> list = byAccount.get(accountId);
        if (list == null) {
            return null;
        }
        ModuleCrewObservation last = null;
        for (final ModuleCrewObservation o : list) {
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
