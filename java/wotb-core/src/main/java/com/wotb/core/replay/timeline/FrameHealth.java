package com.wotb.core.replay.timeline;

/**
 * Frame 内一辆车的血量状态（V2 统一 {@code currentHp} 权威）。
 *
 * <p><b>统一 HP domain</b>：己方/敌方一律用 {@code currentHp}（只来自已被证明的运行时 HP
 * 事件：Type5 materialization 快照 / Type7 prop3 / Avatar method5 / Vehicle method1）。
 * 不再维护两套 HP algorithm，也不在 runtime health 里携带 {@code baseHp / effectiveMaxHp} 业务语义
 * （baseHp 属于 VehicleReferenceMetadata / tankopedia 参考展示，见 FrameVehicle identity）。</p>
 *
 * <p>{@code displayCapacityHp} 是 <b>presentation-only</b> HP bar 容量（anti-future-leak）：
 * = {@code max(authoritative currentHp observations up to t)}；它<b>不是</b> canonical replay truth、
 * <b>不是</b> actualMaxHp、<b>不是</b> effectiveMaxHp。绝不能把未来采样用于过去 frame。</p>
 */
public record FrameHealth(
        Integer currentHp,
        Double observedAtSec,
        Double ageSec,
        HpSource source,
        HealthKnowledge knowledge,
        Integer displayCapacityHp,
        Confidence confidence
) {
    public static FrameHealth unknown() {
        return new FrameHealth(null, null, null, HpSource.UNKNOWN,
                HealthKnowledge.UNKNOWN, null, Confidence.UNKNOWN);
    }

    /**
     * HP 知识状态（与 AoI observation boundary 相关，非全队全局事实）。
     * <ul>
     *   <li>{@link #CURRENT} —— t 落在 open observed segment 内且采样来自本段，当前值可信；</li>
     *   <li>{@link #LAST_KNOWN} —— t 落在 UNKNOWN_AOI gap（敌方离开 AoI），仅保留最后已知值 + age；</li>
     *   <li>{@link #UNKNOWN} —— 从未观测到该车 HP。</li>
     * </ul>
     */
    public enum HealthKnowledge {
        CURRENT,
        LAST_KNOWN,
        UNKNOWN
    }
}
