package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

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
