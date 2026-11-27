package com.wotb.ai.review.eval;

import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import java.util.ArrayList;
import java.util.List;

import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.cappingTeammate;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.cluster;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.context;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.deathProximity;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.earned;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.engagement;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.key;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.keyEvent;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.mainKeys;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.mainKeysExcluding;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.member;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.move;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.phase;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.soloPhases;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.stationary;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.teammateAdvancing;

final class AiEvalTeamTacticalFixtures {
    private AiEvalTeamTacticalFixtures() {
    }


    static SingleTeamBattleAnalysisContext openingMapControl() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 100, 150, 6f)), List.of(), List.of()),
                member(1, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 100, -100, 6f)), List.of(), List.of()),
                member(2, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, -150, 0, 5f)), List.of(), List.of()),
                member(3, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 150, 0, 5f)), List.of(), List.of()),
                member(4, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 0, -150, 5f)), List.of(), List.of()),
                member(5, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, -60, 130, 4.5f)), List.of(), List.of()),
                member(6, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 130, 130, 5f)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(15, 30, 250, 250, 140, 7, List.of(
                        cluster(15, 30, 350, 400, List.of(key(0))),
                        cluster(15, 30, 280, 250, List.of(key(1), key(2), key(3), key(4), key(5), key(6))))),
                phase(30, 45, 250, 250, 130, 7, List.of(
                        cluster(30, 45, 350, 400, List.of(key(0))),
                        cluster(30, 45, 280, 250, List.of(key(1), key(2), key(3), key(4), key(5), key(6))))),
                phase(45, 60, 260, 250, 100, 7, List.of(
                        cluster(45, 60, 280, 240, mainKeys()))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true);
        return context("cw-opening-mapcontrol-01", 2, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }


    static SingleTeamBattleAnalysisContext delayHold() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 400, true, null, null,
                        List.of(move(45, 60, 0, 0, 100, 150, 14f), stationary(60, 240, 100, 150)),
                        List.of(engagement(120, 180, 10_001L, List.of(20_001L, 20_002L))), List.of()),
                teammateAdvancing(1), teammateAdvancing(2), teammateAdvancing(3),
                teammateAdvancing(4), teammateAdvancing(5),
                member(6, 0, true, null, null, List.of(stationary(60, 240, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(60, 240,
                350, 400, 350, 400, 300, 250, 400, 250, key(0), mainKeysExcluding(0));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 5200, 1500, 0, 0, 1, 7, 0, null, null, null, true);
        return context("cw-delay-hold-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }


    static SingleTeamBattleAnalysisContext delaySacrificeCapped() {
        final double[] deaths = {240, 0, 0, 0, 0, 0, 0};
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 900, false, 240.0, deathProximity(180, 1.0),
                        List.of(stationary(180, 238, 100, 150)),
                        List.of(engagement(180, 238, 10_001L,
                                List.of(20_001L, 20_002L, 20_003L))), List.of()),
                cappingTeammate(1), cappingTeammate(2), cappingTeammate(3),
                cappingTeammate(4), cappingTeammate(5), cappingTeammate(6));
        final List<TeamFormationPhase> phases = soloPhases(180, 240,
                350, 400, 350, 400, 300, 250, 250, 150, key(0), mainKeysExcluding(0));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 6000, 2600, 0, 0, 1, 6, 1, 240.0, 240.0, 240.0, true);
        return context("cw-delay-sacrifice-capped-01", 3, 1, deaths,
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(50, 300),
                List.of(
                        keyEvent(50, "TEAM_FIRST_CONTACT", "damage=120"),
                        keyEvent(240, "TEAM_MEMBER_DESTROYED", "accountId=10001;nickname=H1")),
                List.of(),
                earned(10002, 60), earned(10003, 40));
    }


    static SingleTeamBattleAnalysisContext detachPush() {
        final double[] deaths = {0, 0, 90, 0, 0, 0, 0};
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()),
                member(1, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()),
                member(2, 1800, false, 90.0, deathProximity(200, 1.0),
                        List.of(move(45, 90, 0, 0, -150, -100, 5.1f)),
                        List.of(engagement(60, 90, 10_003L, List.of(20_001L, 20_002L, 20_003L))), List.of()),
                member(3, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()),
                member(4, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()),
                member(5, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()),
                member(6, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(60, 90,
                150, 180, 100, 150, 300, 250, 300, 250, key(2), mainKeysExcluding(2));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3200, 3200, 0, 0, 0, 6, 1, 90.0, 90.0, 90.0, false);
        return context("cw-detach-push-01", 3, 2, deaths,
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(40, 300),
                List.of(
                        keyEvent(40, "TEAM_FIRST_CONTACT", "damage=120"),
                        keyEvent(90, "TEAM_MEMBER_DESTROYED", "accountId=10003;nickname=M1")),
                List.of());
    }


    static SingleTeamBattleAnalysisContext soloUnknown() {
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 100, true, null, null,
                    List.of(), List.of(), List.of("TEAM_MEMBER_POSITION_UNAVAILABLE")));
        }
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 4000, 800, 0, 0, 0, 7, 0, null, null, null, true);
        return context("cw-solo-unknown-01", 2, 1, new double[7],
                members, aggregate, List.of(), BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")),
                List.of("TEAM_MEMBER_POSITION_UNAVAILABLE"));
    }


    static SingleTeamBattleAnalysisContext delayNoPayoff() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 300, true, null, null, List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(1, 300, true, null, null,
                        List.of(move(90, 100, 0, 0, 100, -100, 20f), stationary(100, 220, 100, -100)),
                        List.of(), List.of()),
                member(2, 300, true, null, null, List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(3, 300, true, null, null, List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(4, 300, true, null, null, List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(5, 300, true, null, null, List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(6, 300, true, null, null, List.of(stationary(90, 220, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(120, 135,
                350, 150, 350, 150, 250, 250, 250, 250, key(1), mainKeysExcluding(1));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3000, 1800, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-delay-no-payoff-01", 3, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }


    static SingleTeamBattleAnalysisContext detachRotate() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(1, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(2, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(3, 200, true, null, null,
                        List.of(move(60, 150, 0, 0, -150, -100, 2.5f)), List.of(), List.of()),
                member(4, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(5, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(6, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(60, 150,
                100, 150, 100, 150, 300, 250, 310, 210, key(3), mainKeysExcluding(3));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 5000, 1200, 0, 0, 1, 7, 0, null, null, null, true);
        return context("cw-detach-rotate-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }


    static SingleTeamBattleAnalysisContext delayVsDetachAmbiguous() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 300, true, null, null,
                        List.of(move(120, 260, 0, 0, 70, 30, 1f)), List.of(), List.of()),
                member(1, 300, true, null, null, List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(2, 300, true, null, null, List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(3, 300, true, null, null, List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(4, 400, true, null, null,
                        List.of(move(100, 115, 0, 0, 150, 100, 15f), stationary(115, 260, 150, 100)),
                        List.of(engagement(130, 200, 10_005L, List.of(20_002L))), List.of()),
                member(5, 300, true, null, null, List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(6, 300, true, null, null, List.of(stationary(100, 260, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(120, 135,
                400, 350, 400, 350, 260, 260, 260, 260, key(4), mainKeysExcluding(4));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3500, 2600, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-delay-vs-detach-ambiguous-01", 2, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }
}
