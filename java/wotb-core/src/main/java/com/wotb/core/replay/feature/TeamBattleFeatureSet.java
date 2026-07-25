package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 训练房/联赛队伍特征集。
 * 权威结算与事件流观测子集严格分离。
 */
public record TeamBattleFeatureSet(
        int perspectiveTeam,
        List<TeamMemberFeatureSet> members,
        TeamAggregateResult authoritativeAggregate,
        TeamObservedAggregate observedAggregate,
        List<TeamFormationPhase> formationPhases,
        List<TeamEngagementSummary> engagements,
        List<BattlePhaseSummary> battlePhases,
        List<KeyBattleEvent> keyEvents,
        TeamFeatureCoverage coverage,
        List<String> limitations,
        boolean hasFeatures
) {

    public TeamBattleFeatureSet {
        members = members == null ? List.of() : List.copyOf(members);
        observedAggregate = observedAggregate == null
                ? TeamObservedAggregate.empty() : observedAggregate;
        formationPhases = formationPhases == null ? List.of() : List.copyOf(formationPhases);
        engagements = engagements == null ? List.of() : List.copyOf(engagements);
        battlePhases = battlePhases == null ? List.of() : List.copyOf(battlePhases);
        keyEvents = keyEvents == null ? List.of() : List.copyOf(keyEvents);
        coverage = coverage == null ? TeamFeatureCoverage.empty() : coverage;
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }

    public static TeamBattleFeatureSet empty(final int perspectiveTeam) {
        return new TeamBattleFeatureSet(
                perspectiveTeam,
                List.of(),
                null,
                TeamObservedAggregate.empty(),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                TeamFeatureCoverage.empty(),
                List.of("TEAM_FEATURES_UNAVAILABLE"),
                false);
    }
}
