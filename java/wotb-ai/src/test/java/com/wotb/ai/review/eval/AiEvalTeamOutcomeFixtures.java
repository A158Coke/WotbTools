package com.wotb.ai.review.eval;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.evidence.TeamSeparationEvidenceSkill;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import java.util.ArrayList;
import java.util.List;

import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.cappingTeammate;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.cluster;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.compactTeam;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.context;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.earned;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.enemyEarned;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.engagement;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.favorableEngagement;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.key;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.keyEvent;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.mainKeys;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.mainKeysExcluding;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.member;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.move;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.phase;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.soloPhases;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.stationary;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.twoClusterPhase;

/** Synthetic team evaluation scenarios grouped by the behavior evidence they exercise. */
final class AiEvalTeamOutcomeFixtures {
    private AiEvalTeamOutcomeFixtures() {
    }

    // ===== 场景九：占点致胜（点数推断） =====

    static SingleTeamBattleAnalysisContext capWinByPoints() {
        final List<TeamMemberFeatureSet> members = compactTeam();
        final List<TeamFormationPhase> phases = List.of(
                phase(120, 135, 250, 200, 60, 7, List.of(
                        cluster(120, 135, 250, 200, mainKeys()))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 7000, 2000, 0, 0, 2, 7, 0, null, null, null, null);
        return context("cw-cap-win-01", 3, null, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of(),
                earned(10002, 80), earned(10003, 60), enemyEarned(20_002, 40));
    }

    // ===== 场景十：集中一波被偷家 =====

    static SingleTeamBattleAnalysisContext capStolenWhileConcentrating() {
        final List<TeamMemberFeatureSet> members = compactTeam();
        final List<TeamFormationPhase> phases = List.of(
                phase(90, 105, 300, 250, 30, 7, List.of(
                        cluster(90, 105, 300, 250, mainKeys()))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 8000, 3000, 0, 0, 1, 7, 0, null, null, null, false);
        return context("cw-cap-stolen-01", 3, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of(),
                enemyEarned(20_001, 120), enemyEarned(20_002, 90));
    }

    // ===== 场景十一：守家翻盘（防守者拖延 + 队友占点） =====

    static SingleTeamBattleAnalysisContext capDefenseComeback() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 800, true, null, null,
                        List.of(stationary(180, 260, 150, -150)),
                        List.of(engagement(180, 250, 10_001L, List.of(20_001L, 20_002L, 20_003L))), List.of()),
                cappingTeammate(1), cappingTeammate(2), cappingTeammate(3),
                cappingTeammate(4), cappingTeammate(5), cappingTeammate(6));
        final List<TeamFormationPhase> phases = soloPhases(180, 260,
                400, 100, 400, 100, 300, 250, 250, 150, key(0), mainKeysExcluding(0));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 6500, 2800, 0, 0, 1, 7, 0, null, null, null, true);
        return context("cw-cap-defense-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(50, 300),
                List.of(keyEvent(50, "TEAM_FIRST_CONTACT", "damage=120")), List.of(),
                earned(10002, 120), earned(10003, 90));
    }

    // ===== 场景十二：点数胜负（双方存活，比占点分） =====

    static SingleTeamBattleAnalysisContext capPointsDecided() {
        final List<TeamMemberFeatureSet> members = compactTeam();
        final List<TeamFormationPhase> phases = List.of(
                phase(200, 215, 250, 250, 80, 7, List.of(
                        cluster(200, 215, 250, 250, mainKeys()))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 9000, 4000, 0, 0, 2, 7, 0, null, null, null, null);
        return context("cw-cap-points-decided-01", 3, null, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of(),
                earned(10002, 100), earned(10004, 70), enemyEarned(20_001, 60));
    }

    // ===== 场景十二B：全歼胜利（对方全部阵亡、双方点数均 <1000；battle result 权威） =====

    static SingleTeamBattleAnalysisContext annihilationWin() {
        final List<TeamMemberFeatureSet> members = compactTeam();
        final List<TeamFormationPhase> phases = List.of(
                phase(200, 215, 250, 250, 80, 7, List.of(
                        cluster(200, 215, 250, 250, mainKeys()))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 11006, 3060, 0, 0, 7, 7, 0, null, null, null, null);
        return context("cw-annihilation-win-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of(),
                new double[]{60, 105, 150, 195, 240, 270, 285},
                earned(10002, 120), earned(10003, 120));
    }

    // ===== 场景十二C：被敌方全歼落败（本方 7 台全部阵亡、双方点数均 <1000；battle result 权威） =====

    static SingleTeamBattleAnalysisContext annihilationLoss() {
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 700, false, 90.0 + index * 30, null,
                    List.of(stationary(60, 260, 0, 0)), List.of(), List.of()));
        }
        final List<TeamFormationPhase> phases = List.of(
                phase(200, 215, 250, 250, 80, 7, List.of(
                        cluster(200, 215, 250, 250, mainKeys()))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 5000, 9000, 0, 0, 2, 0, 7, 180.0, 90.0, 270.0, null);
        return context("cw-annihilation-loss-01", 3, 2,
                new double[]{90, 120, 150, 180, 210, 240, 270},
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of(),
                earned(10002, 100));
    }

    // ===== 场景十三：5+2 分簇 false-positive（主力簇成员不得判单走） =====

    static SingleTeamBattleAnalysisContext mainClusterNoSolo() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 200, true, null, null,
                        List.of(stationary(60, 90, 0, 0)),
                        List.of(engagement(60, 75, 10_001L, List.of(20_001L, 20_002L))), List.of()),
                member(1, 0, true, null, null, List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(2, 0, true, null, null, List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(3, 0, true, null, null, List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(4, 0, true, null, null, List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(5, 200, true, null, null,
                        List.of(stationary(60, 90, 100, 150)),
                        List.of(engagement(60, 75, 10_006L, List.of(20_001L, 20_002L))), List.of()),
                member(6, 0, true, null, null,
                        List.of(stationary(60, 90, 100, 150)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                twoClusterPhase(60, 75, 300, 250, 400, 400, 0, 4, 5, 6),
                twoClusterPhase(75, 90, 350, 250, 400, 400, 0, 4, 5, 6));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 4000, 2000, 0, 0, 1, 7, 0, null, null, null, true);
        return context("cw-main-cluster-no-solo-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    // ===== false-positive：观测不足 / span 缺口 / 交火跨窗口去重 =====

    static SingleTeamBattleAnalysisContext partialObservation() {
        // 7 名成员存活但每窗口只观测到 4 人（3+1 子集）：不得把子集最大簇当作全局主力
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 0, true, null, null,
                    List.of(stationary(60, 90, 0, 0)), List.of(), List.of()));
        }
        final List<TeamFormationPhase> phases = List.of(
                new TeamFormationPhase(60, 75, new CanonicalMapPosition(250, 250), 80f, 4,
                        DecodeConfidence.EXACT, List.of(
                                cluster(60, 75, 250, 250, List.of(key(0), key(1), key(2))),
                                cluster(60, 75, 400, 400, List.of(key(6))))),
                new TeamFormationPhase(75, 90, new CanonicalMapPosition(300, 250), 80f, 4,
                        DecodeConfidence.EXACT, List.of(
                                cluster(75, 90, 300, 250, List.of(key(0), key(1), key(2))),
                                cluster(75, 90, 400, 400, List.of(key(6))))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 4000, 2000, 0, 0, 0, 7, 0, null, null, null, true);
        return context("cw-partial-observation-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    static SingleTeamBattleAnalysisContext gapNoMerge() {
        // [60,75] 与 [90,105] 中间缺失 75-90 phase：禁止跨缺口合并 span 计算距离增长
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 0, true, null, null,
                        List.of(move(60, 75, 100, 150, 100, 150, 2f),
                                move(90, 105, 0, 150, 0, 150, 2f)),
                        List.of(engagement(60, 105, 10_001L,
                                List.of(20_001L, 20_002L, 20_003L), 1800)), List.of()),
                member(1, 0, true, null, null, List.of(stationary(60, 105, 0, 0)), List.of(), List.of()),
                member(2, 0, true, null, null, List.of(stationary(60, 105, 0, 0)), List.of(), List.of()),
                member(3, 0, true, null, null, List.of(stationary(60, 105, 0, 0)), List.of(), List.of()),
                member(4, 0, true, null, null, List.of(stationary(60, 105, 0, 0)), List.of(), List.of()),
                member(5, 0, true, null, null, List.of(stationary(60, 105, 0, 0)), List.of(), List.of()),
                member(6, 0, true, null, null, List.of(stationary(60, 105, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                twoClusterPhase(60, 75, 300, 250, 100, 150, 1, 6, 0, 0),
                twoClusterPhase(90, 105, 300, 250, 0, 150, 1, 6, 0, 0));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-gap-no-merge-01", 3, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(40, 300),
                List.of(keyEvent(40, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    static SingleTeamBattleAnalysisContext engagementNotMultiplied() {
        // 同一交火段横跨 4 个 formation window：实际承伤 300、1 名敌人，不得累计成 1200/4 而误判脱节
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 0, true, null, null,
                        List.of(move(60, 120, 100, 150, 0, 150, 2f)),
                        List.of(engagement(60, 120, 10_001L, List.of(20_001L), 300)), List.of()),
                member(1, 0, true, null, null, List.of(stationary(60, 120, 0, 0)), List.of(), List.of()),
                member(2, 0, true, null, null, List.of(stationary(60, 120, 0, 0)), List.of(), List.of()),
                member(3, 0, true, null, null, List.of(stationary(60, 120, 0, 0)), List.of(), List.of()),
                member(4, 0, true, null, null, List.of(stationary(60, 120, 0, 0)), List.of(), List.of()),
                member(5, 0, true, null, null, List.of(stationary(60, 120, 0, 0)), List.of(), List.of()),
                member(6, 0, true, null, null, List.of(stationary(60, 120, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(60, 120,
                100, 150, 0, 150, 300, 250, 300, 250, key(0), mainKeysExcluding(0));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-engagement-not-multiplied-01", 3, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(40, 300),
                List.of(keyEvent(40, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    static SingleTeamBattleAnalysisContext benefitPartialOverlapUnknown() {
        // 队友交火 40-65s 与单走 span 60-90s 部分重叠：活动无法可靠归属到窗口（覆盖不足），
        // 后端不输出该窗口（不得硬生成任何结论）
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 0, true, null, null,
                        List.of(move(60, 90, 100, 150, 0, 150, 2f)),
                        List.of(engagement(60, 90, 10_001L, List.of(20_001L), 1000)), List.of()),
                member(1, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)),
                        List.of(favorableEngagement(40, 65, 10_002L)), List.of()),
                member(2, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(3, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(4, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(5, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(6, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(60, 90,
                100, 150, 0, 150, 300, 250, 300, 250, key(0), mainKeysExcluding(0));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-benefit-partial-overlap-unknown-01", 3, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(40, 300),
                List.of(keyEvent(40, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    static SingleTeamBattleAnalysisContext damagePartialBenefitUnknown() {
        // OBSERVED_DAMAGE_IS_PARTIAL + 没有队友活动：不得用「没有观察到」证明未发生，
        // 后端不输出该窗口（不得硬生成任何结论）
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 0, true, null, null,
                        List.of(move(60, 90, 100, 150, 0, 150, 2f)),
                        List.of(engagement(60, 90, 10_001L, List.of(20_001L), 1000)), List.of()),
                member(1, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(2, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(3, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(4, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(5, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()),
                member(6, 0, true, null, null,
                        List.of(stationary(60, 90, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = soloPhases(60, 90,
                100, 150, 0, 150, 300, 250, 300, 250, key(0), mainKeysExcluding(0));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-damage-partial-benefit-unknown-01", 3, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(40, 300),
                List.of(keyEvent(40, "TEAM_FIRST_CONTACT", "damage=120")),
                List.of(TeamSeparationEvidenceSkill.OBSERVED_DAMAGE_IS_PARTIAL));
    }
}
