package com.wotb.core.replay.facts;

/**
 * 敌方/实体观测（AoI）段（计划 §B8）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/entity-presence-aoi-lifecycle.md）：
 * Type33 → Type5(type=2) → Type10 流 = 进入 replay POV 观测集；Type4 = 离开。
 * 段与段之间 = UNKNOWN_AOI（该 POV 未观测），禁止跨 gap 插值/续画真实轨迹。</p>
 *
 * @param entityId 实体 ID
 * @param observedFromSec 观测段开始（Type33/Type5 进入边界）
 * @param absentFromSec 观测段结束（Type4 离开边界）；null = 战斗结束时仍在观测
 * @param source 固定 REPLAY_POV（不是服务器全局 spotted 标记）
 */
public record AoiObservationSegment(
        int entityId,
        double observedFromSec,
        Double absentFromSec,
        String source
) {
    public AoiObservationSegment {
        source = source == null || source.isBlank() ? "REPLAY_POV" : source;
        if (absentFromSec != null && absentFromSec < observedFromSec - 1e-9) {
            throw new IllegalArgumentException(
                    "absentFromSec must not precede observedFromSec");
        }
    }

    /** 是否存在 UNKNOWN_AOI gap（本段结束后到战斗结束）。 */
    public boolean closed() {
        return absentFromSec != null;
    }
}
