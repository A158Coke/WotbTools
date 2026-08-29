package com.wotb.core.replay.facts;

/**
 * 统一 HP 观测事实。
 *
 * <p>所有 replay consumer（赛果解析 / 战局回放 / AI 复盘）消费同一条 canonical HP timeline；
 * 禁止各自对 raw events 建立互相不同的 HP 解释。</p>
 *
 * @param entityId 实体 ID（事件流作用域）
 * @param accountId 映射后的参战玩家账号；未映射时为 0
 * @param timeSec battle-relative 秒（无 battle start 时退回 raw）
 * @param hp HP 值；null = 未知（不得当 0 或满血）
 * @param kind 观测来源种类
 * @param source provenance
 */
public record HpObservation(
        int entityId,
        long accountId,
        double timeSec,
        Integer hp,
        HpObservationKind kind,
        ReplayFactSource source
) {
    /** 是否可信正 HP（>0 且 < 0xFF00，与 HealthChangedEvent.isPlausibleHp 同口径）。 */
    public boolean plausible() {
        return hp != null && hp > 0 && hp < 0xFF00;
    }
}
