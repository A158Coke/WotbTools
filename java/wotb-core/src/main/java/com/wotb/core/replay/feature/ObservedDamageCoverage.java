package com.wotb.core.replay.feature;

/**
 * 事件流观测伤害与权威结算的覆盖判定（团队/随机战共用）。
 * <p>观测聚合与权威结算完全一致时视为覆盖 100%（不标记
 * {@code OBSERVED_DAMAGE_IS_PARTIAL}）；否则由调用方抑制观测数字。</p>
 */
public final class ObservedDamageCoverage {

    private ObservedDamageCoverage() {
    }

    public static boolean matches(final int observedDealt,
                                  final int observedReceived,
                                  final int authoritativeDealt,
                                  final int authoritativeReceived) {
        return observedDealt == authoritativeDealt
                && observedReceived == authoritativeReceived;
    }
}
