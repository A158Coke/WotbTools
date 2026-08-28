package com.wotb.core.replay.timeline;

import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.event.ReplayEvent;

import java.util.List;

/**
 * Canonical BattleTimeline：battle-relative 时间统一、1 秒 BattleFrame、精确事件保留。
 * <p>时间轴事实的唯一入口：Battle Playback / Personal AI / Team AI 都消费此模型，
 * 禁止各模块自行重新解释 raw events 形成互相不同的事实模型（docs/current-plan.md §1）。</p>
 *
 * @param mapCode               地图内部 code（meta.json mapName，全小写）
 * @param durationSec           battle-relative 总时长（秒）
 * @param battleStartRawClockSec battle start 原始时钟（provenance/debug）
 * @param clockResolution       时钟解析来源（IDENTIFIED / ESTIMATED）
 * @param frames                second=0..maxSecond 的 BattleFrame 列表（frameAt 按 second 索引）
 * @param events                全部事件（battle-relative 时间升序，精确时间不丢失）
 * @param aoiSegments           实体观测（AoI）段（计划 §B8：Type4 收段 / Type33+Type5 重入；
 *                              段间 gap = UNKNOWN_AOI，禁止跨 gap 插值）
 * @param validation            构建期校验（有效时 valid=true）
 * @param limitations           数据限制（如 CLOCK_ESTIMATED / POSITION_GAPS 等）
 */
public record BattleTimeline(
        String mapCode,
        double durationSec,
        double battleStartRawClockSec,
        BattleTimelineClock clockResolution,
        List<BattleFrame> frames,
        List<ReplayEvent> events,
        List<AoiObservationSegment> aoiSegments,
        BattleTimelineValidationResult validation,
        List<String> limitations
) {
    /**
     * 按 battle-relative 秒查询 frame；越界时返回最近 frame；空 timeline 返回 null。
     * 结果 deterministic 且可测试（docs/current-plan.md §45）。
     */
    public BattleFrame frameAt(final double battleClockSec) {
        if (frames == null || frames.isEmpty()) {
            return null;
        }
        final int second = (int) Math.floor(battleClockSec);
        if (second <= 0) {
            return frames.get(0);
        }
        if (second >= frames.size()) {
            return frames.get(frames.size() - 1);
        }
        return frames.get(second);
    }

}
