package com.wotb.web.replay.ai.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleCategoryUtils;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.EngagementOutcome;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.List;

/**
 * AI 复盘评估 golden fixtures：synthetic 7v7 训练房/联赛场景。
 * <p>坐标语义：raw 回放坐标（±250 → canonical 0..500），移动段 distance 为 canonical 米。
 * 本类只产出 Step 1 可断言的基线证据（阵型/移动/阶段/关键事件）；
 * Step 2 的图控/拖延/脱节候选证据由 {@code TeamSoloIntentSkill} 从同一特征派生。</p>
 */
public final class AiEvalFixtures {

    private AiEvalFixtures() {
    }

    private static final String[] FRIENDLY_NAMES = {"H1", "H2", "M1", "M2", "M3", "T1", "L1"};
    private static final long[] FRIENDLY_TANKS = {4481L, 10785L, 14609L, 12305L, 14609L, 9489L, 4413L};

    public static SingleTeamBattleAnalysisContext context(final String fixtureKey) {
        return switch (fixtureKey) {
            case "cw-opening-mapcontrol-01" -> openingMapControl();
            case "cw-delay-hold-01" -> delayHold();
            case "cw-delay-sacrifice-capped-01" -> delaySacrificeCapped();
            case "cw-detach-push-01" -> detachPush();
            case "cw-solo-unknown-01" -> soloUnknown();
            case "cw-delay-no-payoff-01" -> delayNoPayoff();
            case "cw-detach-rotate-01" -> detachRotate();
            case "cw-delay-vs-detach-ambiguous-01" -> delayVsDetachAmbiguous();
            default -> throw new IllegalArgumentException("Unknown fixture: " + fixtureKey);
        };
    }

    // ===== 场景一：开局图控（散开拿视野，非脱节） =====

    private static SingleTeamBattleAnalysisContext openingMapControl() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 900, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 100, 150, 6f)), List.of(), List.of()),
                member(1, 900, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 100, -100, 6f)), List.of(), List.of()),
                member(2, 900, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, -150, 0, 5f)), List.of(), List.of()),
                member(3, 900, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 150, 0, 5f)), List.of(), List.of()),
                member(4, 900, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 0, -150, 5f)), List.of(), List.of()),
                member(5, 900, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, -60, 130, 4.5f)), List.of(), List.of()),
                member(6, 900, 0, true, null, null,
                        List.of(move(5, 40, 0, 0, 130, 130, 5f)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(15, 30, 250, 250, 140, 7, List.of(
                        cluster(15, 30, 350, 400, List.of("H1")),
                        cluster(15, 30, 300, 250, List.of("H2", "M1", "M2")),
                        cluster(15, 30, 130, 100, List.of("M3", "T1", "L1")))),
                phase(30, 45, 250, 250, 130, 7, List.of(
                        cluster(30, 45, 350, 400, List.of("H1")),
                        cluster(30, 45, 300, 250, List.of("H2", "M1", "M2")),
                        cluster(30, 45, 130, 100, List.of("M3", "T1", "L1")))),
                phase(45, 60, 260, 250, 100, 7, List.of(
                        cluster(45, 60, 350, 400, List.of("H1")),
                        cluster(45, 60, 280, 240, List.of("H2", "M1", "M2", "M3", "T1", "L1")))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true);
        return context("cw-opening-mapcontrol-01", 2, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    // ===== 场景二：单走卡点拖延（队友借机推进） =====

    private static SingleTeamBattleAnalysisContext delayHold() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 1100, 400, true, null, null,
                        List.of(move(45, 60, 0, 0, 100, 150, 14f), stationary(60, 240, 100, 150)),
                        List.of(engagement(120, 180, 10_001L, List.of(20_001L, 20_002L), 300, 200)), List.of()),
                member(1, 800, 200, true, null, null,
                        List.of(move(60, 150, 0, 0, 50, 0, 1f), move(150, 240, 50, 0, 150, 0, 1.5f)),
                        List.of(), List.of()),
                member(2, 800, 200, true, null, null,
                        List.of(move(60, 150, 0, 0, 50, 0, 1f), move(150, 240, 50, 0, 150, 0, 1.5f)),
                        List.of(), List.of()),
                member(3, 800, 200, true, null, null,
                        List.of(move(60, 150, 0, 0, 50, 0, 1f), move(150, 240, 50, 0, 150, 0, 1.5f)),
                        List.of(), List.of()),
                member(4, 800, 200, true, null, null,
                        List.of(move(60, 150, 0, 0, 50, 0, 1f), move(150, 240, 50, 0, 150, 0, 1.5f)),
                        List.of(), List.of()),
                member(5, 800, 200, true, null, null,
                        List.of(move(60, 150, 0, 0, 50, 0, 1f), move(150, 240, 50, 0, 150, 0, 1.5f)),
                        List.of(), List.of()),
                member(6, 500, 0, true, null, null,
                        List.of(stationary(60, 240, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(60, 75, 270, 260, 90, 7, List.of(
                        cluster(60, 75, 350, 400, List.of("10001")),
                        cluster(60, 75, 300, 250, List.of("10002", "10003", "10004", "10005", "10006", "10007")))),
                phase(150, 165, 330, 250, 90, 7, List.of(
                        cluster(150, 165, 350, 400, List.of("10001")),
                        cluster(150, 165, 380, 250, List.of("10002", "10003", "10004", "10005", "10006", "10007")))),
                phase(225, 240, 350, 250, 90, 7, List.of(
                        cluster(225, 240, 350, 400, List.of("10001")),
                        cluster(225, 240, 400, 250, List.of("10002", "10003", "10004", "10005", "10006", "10007")))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 5200, 1500, 0, 0, 1, 7, 0, null, null, null, true);
        return context("cw-delay-hold-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    // ===== 场景三：残局 1vN 牺牲拖延（队友借机占点） =====

    private static SingleTeamBattleAnalysisContext delaySacrificeCapped() {
        final double[] deaths = {240, 0, 0, 0, 0, 0, 0};
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 1100, 900, false, 240.0, deathProximity(180, 1.0),
                        List.of(stationary(180, 238, 100, 150)),
                        List.of(engagement(180, 238, 10_001L,
                                List.of(20_001L, 20_002L, 20_003L), 500, 900)), List.of()),
                member(1, 900, 300, true, null, null,
                        List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of()),
                member(2, 900, 300, true, null, null,
                        List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of()),
                member(3, 900, 300, true, null, null,
                        List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of()),
                member(4, 900, 300, true, null, null,
                        List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of()),
                member(5, 900, 300, true, null, null,
                        List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of()),
                member(6, 900, 300, true, null, null,
                        List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(180, 195, 270, 260, 90, 7, List.of(
                        cluster(180, 195, 350, 400, List.of("10001")),
                        cluster(180, 195, 300, 250, List.of("10002", "10003", "10004", "10005", "10006", "10007")))),
                phase(240, 255, 250, 150, 60, 6, List.of(
                        cluster(240, 255, 250, 150, List.of("10002", "10003", "10004", "10005", "10006", "10007")))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 6000, 2600, 0, 0, 1, 6, 1, 240.0, 240.0, 240.0, true);
        return context("cw-delay-sacrifice-capped-01", 3, 1, deaths,
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(50, 300),
                List.of(
                        keyEvent(50, "TEAM_FIRST_CONTACT", "damage=120"),
                        keyEvent(240, "TEAM_MEMBER_DESTROYED", "accountId=10001;nickname=H1")),
                List.of());
    }

    // ===== 场景四：单走推进被集火（队友无获利） =====

    private static SingleTeamBattleAnalysisContext detachPush() {
        final double[] deaths = {0, 0, 90, 0, 0, 0, 0};
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 800, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)),
                        List.of(), List.of()),
                member(1, 800, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)),
                        List.of(), List.of()),
                member(2, 400, 1800, false, 90.0, deathProximity(200, 1.0),
                        List.of(move(45, 90, 0, 0, -150, -100, 5.1f)),
                        List.of(engagement(50, 90, 10_003L, List.of(20_001L, 20_002L, 20_003L), 200, 1600)),
                        List.of()),
                member(3, 800, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)),
                        List.of(), List.of()),
                member(4, 800, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)),
                        List.of(), List.of()),
                member(5, 800, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)),
                        List.of(), List.of()),
                member(6, 800, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)),
                        List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(60, 75, 250, 240, 100, 7, List.of(
                        cluster(60, 75, 100, 150, List.of("10003")),
                        cluster(60, 75, 300, 250, List.of("10001", "10002", "10004", "10005", "10006", "10007")))),
                phase(120, 135, 300, 250, 40, 6, List.of(
                        cluster(120, 135, 300, 250, List.of("10001", "10002", "10004", "10005", "10006", "10007")))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3200, 3200, 0, 0, 0, 6, 1, 90.0, 90.0, 90.0, false);
        return context("cw-detach-push-01", 3, 2, deaths,
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(40, 300),
                List.of(
                        keyEvent(40, "TEAM_FIRST_CONTACT", "damage=120"),
                        keyEvent(90, "TEAM_MEMBER_DESTROYED", "accountId=10003;nickname=M1")),
                List.of());
    }

    // ===== 场景五：观测不足（无法确定） =====

    private static SingleTeamBattleAnalysisContext soloUnknown() {
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 600, 100, true, null, null,
                    List.of(), List.of(), List.of("TEAM_MEMBER_MOVEMENT_UNAVAILABLE")));
        }
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 4000, 800, 0, 0, 0, 7, 0, null, null, null, true);
        return context("cw-solo-unknown-01", 2, 1, new double[7],
                members, aggregate, List.of(), BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")),
                List.of("TEAM_MEMBER_MOVEMENT_UNAVAILABLE"));
    }

    // ===== 场景六：单走静止但无获利（不硬判拖延） =====

    private static SingleTeamBattleAnalysisContext delayNoPayoff() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 600, 300, true, null, null,
                        List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(1, 600, 300, true, null, null,
                        List.of(move(90, 100, 0, 0, 100, -100, 20f), stationary(100, 220, 100, -100)),
                        List.of(), List.of()),
                member(2, 600, 300, true, null, null,
                        List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(3, 600, 300, true, null, null,
                        List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(4, 600, 300, true, null, null,
                        List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(5, 600, 300, true, null, null,
                        List.of(stationary(90, 220, 0, 0)), List.of(), List.of()),
                member(6, 600, 300, true, null, null,
                        List.of(stationary(90, 220, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(120, 135, 260, 240, 80, 7, List.of(
                        cluster(120, 135, 350, 150, List.of("10002")),
                        cluster(120, 135, 250, 250, List.of("10001", "10003", "10004", "10005", "10006", "10007")))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3000, 1800, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-delay-no-payoff-01", 3, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    // ===== 场景七：脱节后队友转场接应成功 =====

    private static SingleTeamBattleAnalysisContext detachRotate() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 800, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(1, 800, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(2, 800, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(3, 600, 200, true, null, null,
                        List.of(move(60, 150, 0, 0, -150, -100, 2.5f)),
                        List.of(), List.of()),
                member(4, 800, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(5, 800, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()),
                member(6, 800, 200, true, null, null,
                        List.of(move(60, 120, 0, 0, 50, 0, 1f), move(120, 180, 50, 0, 60, -40, 2.5f)),
                        List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(60, 75, 270, 250, 90, 7, List.of(
                        cluster(60, 75, 100, 150, List.of("10004")),
                        cluster(60, 75, 300, 250, List.of("10001", "10002", "10003", "10005", "10006", "10007")))),
                phase(150, 165, 280, 230, 90, 7, List.of(
                        cluster(150, 165, 100, 150, List.of("10004")),
                        cluster(150, 165, 310, 210, List.of("10001", "10002", "10003", "10005", "10006", "10007")))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 5000, 1200, 0, 0, 1, 7, 0, null, null, null, true);
        return context("cw-detach-rotate-01", 3, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    // ===== 场景八：信号矛盾（静止+敌情 vs 队友半获利，不硬下标签） =====

    private static SingleTeamBattleAnalysisContext delayVsDetachAmbiguous() {
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 700, 300, true, null, null,
                        List.of(move(120, 260, 0, 0, 70, 30, 1f)), List.of(), List.of()),
                member(1, 500, 300, true, null, null,
                        List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(2, 500, 300, true, null, null,
                        List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(3, 500, 300, true, null, null,
                        List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(4, 600, 400, true, null, null,
                        List.of(move(100, 115, 0, 0, 150, 100, 15f), stationary(115, 260, 150, 100)),
                        List.of(engagement(130, 200, 10_005L, List.of(20_002L), 200, 300)), List.of()),
                member(5, 500, 300, true, null, null,
                        List.of(stationary(100, 260, 0, 0)), List.of(), List.of()),
                member(6, 500, 300, true, null, null,
                        List.of(stationary(100, 260, 0, 0)), List.of(), List.of()));
        final List<TeamFormationPhase> phases = List.of(
                phase(120, 135, 270, 260, 90, 7, List.of(
                        cluster(120, 135, 400, 350, List.of("10005")),
                        cluster(120, 135, 260, 260, List.of("10001", "10002", "10003", "10004", "10006", "10007")))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 3500, 2600, 0, 0, 0, 7, 0, null, null, null, false);
        return context("cw-delay-vs-detach-ambiguous-01", 2, 2, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    // ===== 构建辅助 =====

    private static SingleTeamBattleAnalysisContext context(
            final String key,
            final int arenaBonusType,
            final int winnerTeam,
            final double[] deathSecs,
            final List<TeamMemberFeatureSet> members,
            final TeamAggregateResult aggregate,
            final List<TeamFormationPhase> phases,
            final List<BattlePhaseSummary> battlePhases,
            final List<KeyBattleEvent> keyEvents,
            final List<String> limitations
    ) {
        final Battle battle = battle(arenaBonusType, winnerTeam, deathSecs);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, members, aggregate, TeamObservedAggregate.empty(),
                phases, List.of(), battlePhases, keyEvents,
                TeamFeatureCoverage.empty(), limitations, true);
        final BattleCategory category = BattleCategoryUtils.fromArenaBonusType(arenaBonusType);
        return new SingleTeamBattleAnalysisContext(
                "eval-" + key, null, key + ".wotbreplay", category, battle, 1, features,
                null, limitations, null);
    }

    private static Battle battle(final int arenaBonusType, final int winnerTeam, final double[] deathSecs) {
        final Battle battle = new Battle();
        battle.arenaId = "eval-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = arenaBonusType;
        battle.durationS = 300.0;
        battle.winnerTeam = winnerTeam;
        battle.recorder = FRIENDLY_NAMES[0];
        battle.players = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            battle.players.add(player(
                    10_001L + index, FRIENDLY_NAMES[index], "CHRD", 1,
                    FRIENDLY_TANKS[index], 900, deathSecs[index]));
        }
        for (int index = 0; index < 7; index++) {
            battle.players.add(player(
                    20_001L + index, "E" + (index + 1), "NOVA", 2,
                    FRIENDLY_TANKS[index], 800, 0));
        }
        return battle;
    }

    private static PlayerResult player(
            final long accountId,
            final String nickname,
            final String clan,
            final int team,
            final long tankId,
            final int damage,
            final double deathSec
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.clan = clan;
        player.team = team;
        player.tankId = tankId;
        player.tankName = resolveTankName(tankId);
        player.damageDealt = damage;
        player.survived = deathSec <= 0;
        player.deathTimeMillis = deathSec > 0 ? (long) (deathSec * 1000) : 0L;
        return player;
    }

    private static String resolveTankName(final long tankId) {
        final String name = ReplayDisplayNames.tankName(tankId, "");
        return name.isBlank() ? "T" + tankId : name;
    }

    private static TeamMemberFeatureSet member(
            final int index,
            final int damageDealt,
            final int damageReceived,
            final boolean survived,
            final Double deathSec,
            final TeamMemberFeatureSet.DeathProximity deathProximity,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<String> limitations
    ) {
        final long accountId = 10_001L + index;
        final long tankId = FRIENDLY_TANKS[index];
        return new TeamMemberFeatureSet(
                List.of((int) accountId), accountId, FRIENDLY_NAMES[index],
                tankId, resolveTankName(tankId), 1,
                DecodeConfidence.EXACT, damageDealt, damageReceived, 0, 0, 0,
                survived, deathSec, deathProximity, movements, engagements,
                List.of(), limitations);
    }

    private static TeamMemberFeatureSet.DeathProximity deathProximity(
            final double meters, final double deltaSec) {
        return new TeamMemberFeatureSet.DeathProximity(meters, deltaSec, DecodeConfidence.INFERRED);
    }

    private static MovementSegment move(
            final float start, final float end,
            final float x1, final float z1, final float x2, final float z2,
            final float speed) {
        final float distance = (float) Math.hypot(x2 - x1, z2 - z1);
        return new MovementSegment(start, end, MovementType.MOVING,
                new Vector3(x1, 0f, z1), new Vector3(x2, 0f, z2),
                distance, speed, DecodeConfidence.EXACT);
    }

    private static MovementSegment stationary(
            final float start, final float end, final float x, final float z) {
        return new MovementSegment(start, end, MovementType.STATIONARY,
                new Vector3(x, 0f, z), new Vector3(x, 0f, z),
                0f, 0f, DecodeConfidence.EXACT);
    }

    private static TeamFormationPhase phase(
            final float start, final float end,
            final float centroidX, final float centroidZ,
            final float dispersion, final int observed,
            final List<TeamFormationCluster> clusters) {
        return new TeamFormationPhase(start, end,
                new CanonicalMapPosition(centroidX, centroidZ),
                dispersion, observed, DecodeConfidence.EXACT, clusters);
    }

    private static TeamFormationCluster cluster(
            final float start, final float end,
            final float centroidX, final float centroidZ,
            final List<String> memberIdentities) {
        final CanonicalMapPosition centroid = new CanonicalMapPosition(centroidX, centroidZ);
        return new TeamFormationCluster(start, end, centroid,
                MapCoordinateResolution.Status.VALID, centroid.region(), 0,
                memberIdentities, DecodeConfidence.EXACT);
    }

    private static EngagementSummary engagement(
            final float start, final float end,
            final long allyAccountId, final List<Long> enemyAccountIds,
            final int dealt, final int received) {
        return new EngagementSummary(start, end, List.of(allyAccountId), enemyAccountIds,
                dealt, received,
                new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                EngagementOutcome.UNFAVORABLE, DecodeConfidence.PARTIAL);
    }

    private static KeyBattleEvent keyEvent(final float clock, final String type, final String label) {
        return new KeyBattleEvent(clock, type, label, DecodeConfidence.EXACT, "TEST", List.of());
    }
}
