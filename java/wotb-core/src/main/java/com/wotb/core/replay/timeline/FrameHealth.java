package com.wotb.core.replay.timeline;

/**
 * Frame 内一辆车的血量状态。
 * <p>currentHp 只来自已被证明的运行时 HP 事件（type-7 propId=3，signed i16，含死亡 sentinel
 * 归一化）；baseHp 是 tankopedia 参考基线；effectiveMaxHp 是本场实测/已知最大 HP。
 * baseHp 与 effectiveMaxHp 严格分开，禁止把 tankopedia base 冒充本场 maxHp
 * （本场实际 HP 还受装备/物资加成影响，见 docs/architecture/battle-timeline.md §7）。</p>
 */
public record FrameHealth(
        Integer currentHp,
        Double currentHpObservedAtSec,
        Double currentHpAgeSec,
        HpSource currentHpSource,
        Integer baseHp,
        Integer effectiveMaxHp,
        HpSource effectiveMaxHpSource,
        Confidence confidence
) {
    public static FrameHealth unknown(final Integer baseHp) {
        return new FrameHealth(null, null, null, HpSource.UNKNOWN,
                baseHp, null, HpSource.UNKNOWN, Confidence.UNKNOWN);
    }
}
