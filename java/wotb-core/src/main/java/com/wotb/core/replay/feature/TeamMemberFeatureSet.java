package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

/**
 * 一名本队成员的权威结算与独立事件流特征。
 * {@code entityIds} 保留 re-entry 后的多个实体 ID，各实体移动不会跨 ID 串接。
 */
public record TeamMemberFeatureSet(
        List<Integer> entityIds,
        long accountId,
        String nickname,
        long tankId,
        String tankName,
        int team,
        DecodeConfidence mappingConfidence,
        int finalDamage,
        int damageReceived,
        int assistedDamage,
        int blockedDamage,
        int kills,
        boolean survived,
        Double deathTimeSec,
        List<MovementSegment> movements,
        List<EngagementSummary> engagements,
        List<KeyBattleEvent> keyEvents,
        List<String> limitations
) {

    public TeamMemberFeatureSet {
        entityIds = entityIds == null ? List.of() : List.copyOf(entityIds);
        mappingConfidence = mappingConfidence == null
                ? DecodeConfidence.UNKNOWN : mappingConfidence;
        movements = movements == null ? List.of() : List.copyOf(movements);
        engagements = engagements == null ? List.of() : List.copyOf(engagements);
        keyEvents = keyEvents == null ? List.of() : List.copyOf(keyEvents);
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }
}
