package com.wotb.core.replay.facts;

/**
 * 敌方/实体观测（AoI）段。
 *
 * <p>当前 11.19 corpus（docs/research/replay/entity-presence-aoi-lifecycle.md）：
 * Type33 → Type5(type=2) → Type10 流 = 进入 replay POV 观测集；Type4 = 离开。
 * 段与段之间 = UNKNOWN_AOI（该 POV 未观测），禁止跨 gap 插值/续画真实轨迹。</p>
 *
 * @param entityId 实体 ID
 * @param observedFromSec 观测段开始（Type5；Type10 仅作为缺少物化事件时的 fallback）
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

    /** 是否存在 UNKNOWN_AOI gap（本段结束后到下一次重入/战斗结束）。 */
    public boolean closed() {
        return absentFromSec != null;
    }

    /**
     * t 是否处于这个 replay-POV observed segment 内。
     * Type4 的 absentFrom 是硬边界，因此区间为 [observedFrom, absentFrom)。
     */
    public boolean observesAt(final double t) {
        if (!Double.isFinite(t) || t < observedFromSec - 1e-9) {
            return false;
        }
        return absentFromSec == null || t < absentFromSec - 1e-9;
    }

    /**
     * 本段对当前位置的最后可证明时间。开放段没有人为的“5 秒 stale”截止点。
     */
    public double observedUntilSecOr(final double battleEndSec) {
        return absentFromSec == null ? battleEndSec : absentFromSec;
    }
}
