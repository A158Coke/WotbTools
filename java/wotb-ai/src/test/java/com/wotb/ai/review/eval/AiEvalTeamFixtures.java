package com.wotb.ai.review.eval;

import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;

final class AiEvalTeamFixtures {
    private AiEvalTeamFixtures() {
    }

    static SingleTeamBattleAnalysisContext context(final String fixtureKey) {
        return switch (fixtureKey) {
            case "cw-opening-mapcontrol-01" -> AiEvalTeamTacticalFixtures.openingMapControl();
            case "cw-delay-hold-01" -> AiEvalTeamTacticalFixtures.delayHold();
            case "cw-delay-sacrifice-capped-01" -> AiEvalTeamTacticalFixtures.delaySacrificeCapped();
            case "cw-detach-push-01" -> AiEvalTeamTacticalFixtures.detachPush();
            case "cw-solo-unknown-01" -> AiEvalTeamTacticalFixtures.soloUnknown();
            case "cw-delay-no-payoff-01" -> AiEvalTeamTacticalFixtures.delayNoPayoff();
            case "cw-detach-rotate-01" -> AiEvalTeamTacticalFixtures.detachRotate();
            case "cw-delay-vs-detach-ambiguous-01" -> AiEvalTeamTacticalFixtures.delayVsDetachAmbiguous();
            case "cw-cap-win-01" -> AiEvalTeamOutcomeFixtures.capWinByPoints();
            case "cw-cap-stolen-01" -> AiEvalTeamOutcomeFixtures.capStolenWhileConcentrating();
            case "cw-cap-defense-01" -> AiEvalTeamOutcomeFixtures.capDefenseComeback();
            case "cw-cap-points-decided-01" -> AiEvalTeamOutcomeFixtures.capPointsDecided();
            case "cw-annihilation-win-01" -> AiEvalTeamOutcomeFixtures.annihilationWin();
            case "cw-annihilation-loss-01" -> AiEvalTeamOutcomeFixtures.annihilationLoss();
            case "cw-main-cluster-no-solo-01" -> AiEvalTeamOutcomeFixtures.mainClusterNoSolo();
            case "cw-partial-observation-01" -> AiEvalTeamOutcomeFixtures.partialObservation();
            case "cw-gap-no-merge-01" -> AiEvalTeamOutcomeFixtures.gapNoMerge();
            case "cw-engagement-not-multiplied-01" -> AiEvalTeamOutcomeFixtures.engagementNotMultiplied();
            case "cw-benefit-partial-overlap-unknown-01" -> AiEvalTeamOutcomeFixtures.benefitPartialOverlapUnknown();
            case "cw-damage-partial-benefit-unknown-01" -> AiEvalTeamOutcomeFixtures.damagePartialBenefitUnknown();
            default -> throw new IllegalArgumentException("Unknown fixture: " + fixtureKey);
        };
    }
}
