package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

/**
 * 关键战斗事件。
 *
 * @param clockSec  事件发生时间
 * @param type      事件类型编码
 * @param label     稳定证据文本；展示名由前端按 {@code type} 本地化
 * @param confidence 证据置信度
 * @param source 数据来源
 * @param relatedEntityIds 相关实体 ID
 */
public record KeyBattleEvent(
        float clockSec,
        String type,
        String label,
        DecodeConfidence confidence,
        String source,
        List<Integer> relatedEntityIds
) {

    public KeyBattleEvent {
        confidence = confidence == null ? DecodeConfidence.UNKNOWN : confidence;
        source = source == null ? "UNKNOWN" : source;
        relatedEntityIds = relatedEntityIds == null ? List.of() : List.copyOf(relatedEntityIds);
    }

    /**
     * 兼容现有个人分析调用；新 Team 事件必须显式填写证据元数据。
     */
    public KeyBattleEvent(final float clockSec, final String type, final String label) {
        this(clockSec, type, label, DecodeConfidence.INFERRED, "LEGACY", List.of());
    }
}
