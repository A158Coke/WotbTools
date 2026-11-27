package com.wotb.ai.review;

import java.util.List;
import java.util.Map;

public record PreBattleStrategicPrior(
        TeamProfile teamA,
        TeamProfile teamB,
        List<KeyMatchup> keyMatchups,
        List<StrategicWinCondition> strategicWinConditions,
        List<StrategicHypothesis> hypotheses
) {
    public PreBattleStrategicPrior {
        keyMatchups = keyMatchups == null ? List.of() : List.copyOf(keyMatchups);
        strategicWinConditions = strategicWinConditions == null
                ? List.of() : List.copyOf(strategicWinConditions);
        hypotheses = hypotheses == null ? List.of() : List.copyOf(hypotheses);
    }

    public boolean hasContent() {
        return (teamA != null && (teamA.hasContent()))
                || (teamB != null && teamB.hasContent())
                || !keyMatchups.isEmpty()
                || !strategicWinConditions.isEmpty()
                || !hypotheses.isEmpty();
    }

    public record TeamProfile(
            Map<String, String> composition,
            List<String> strengths,
            List<String> weaknesses,
            List<String> preferredPlans
    ) {
        public TeamProfile {
            composition = composition == null ? Map.of() : Map.copyOf(composition);
            strengths = strengths == null ? List.of() : List.copyOf(strengths);
            weaknesses = weaknesses == null ? List.of() : List.copyOf(weaknesses);
            preferredPlans = preferredPlans == null ? List.of() : List.copyOf(preferredPlans);
        }

        boolean hasContent() {
            return !composition.isEmpty() || !strengths.isEmpty()
                    || !weaknesses.isEmpty() || !preferredPlans.isEmpty();
        }
    }

    public record KeyMatchup(String area, String advantage, String reason) {
    }

    public record StrategicWinCondition(String team, String condition) {
    }

    public record StrategicHypothesis(String id, String claim, String reason) {
    }
}
