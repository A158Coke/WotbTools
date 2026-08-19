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
        DeathProximity deathProximity,
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

    /**
     * 旧签名便捷构造器：未计算阵亡质心距离时 deathProximity 为 null。
     */
    public TeamMemberFeatureSet(
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
            List<String> limitations) {
        this(entityIds, accountId, nickname, tankId, tankName, team, mappingConfidence,
                finalDamage, damageReceived, assistedDamage, blockedDamage, kills, survived,
                deathTimeSec, null, movements, engagements, keyEvents, limitations);
    }

    /**
     * 阵亡时刻与主力质心（其余 OBSERVED 本队车辆平均位置）的实际距离。
     * {@code distanceMeters} 为 null 表示无法可靠计算（目标位置无 OBSERVED 记录），禁止硬算；
     * {@code observedDeltaSec} 为目标位置相对阵亡时刻的最近观测时间差。
     */
    public record DeathProximity(
            Double distanceMeters,
            Double observedDeltaSec,
            DecodeConfidence confidence
    ) {
        public DeathProximity {
            if (distanceMeters == null || distanceMeters < 0) {
                throw new IllegalArgumentException("distanceMeters must be non-null and >= 0");
            }
        }
    }
}
