package com.wotb.web.replay.ai.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleCategoryUtils;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.EngagementOutcome;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 复盘评估 golden fixtures：synthetic 7v7 训练房/联赛（争霸赛）场景。
 * <p>坐标语义：raw 回放坐标（±250 → canonical 0..500），移动段 distance 为 canonical 米；
 * 阵型簇成员身份使用 {@code account:<accountId>}（与 {@code DefaultTeamBattleFeatureExtractor.identityKey} 一致）。</p>
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
            case "cw-cap-win-01" -> capWinByPoints();
            case "cw-cap-stolen-01" -> capStolenWhileConcentrating();
            case "cw-cap-defense-01" -> capDefenseComeback();
            case "cw-cap-points-decided-01" -> capPointsDecided();
            default -> throw new IllegalArgumentException("Unknown fixture: " + fixtureKey);
        };
    }

    /** player 路径 fixture：battle + recon + features + recorder（供 AiEvalPromptProbe 走真实证据链）。 */
    public record PlayerFixture(
            Battle battle,
            ReplayReconstruction recon,
            PlayerBattleFeatureSet features,
            RecorderEntityMapping recorder
    ) {
    }

    public static PlayerFixture playerFixture(final String fixtureKey) {
        return switch (fixtureKey) {
            case "player-opening-mapcontrol-01" -> playerOpeningMapControl();
            case "player-delay-hold-01" -> playerDelayHold();
            case "player-detach-push-01" -> playerDetachPush();
            default -> throw new IllegalArgumentException("Unknown player fixture: " + fixtureKey);
        };
    }

    /** 随机战开局图控：录像者开局散开、未接火未阵亡 → OPENING_MAP_CONTROL。 */
    private static PlayerFixture playerOpeningMapControl() {
        return playerFixtureOf(
                0, true,
                List.of(move(5, 40, 0, 0, 100, 150, 6f)),
                List.of(),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f});
    }

    /** 随机战卡点拖延：录像者静止 + 敌情压力 → SOLO_DELAY。 */
    private static PlayerFixture playerDelayHold() {
        return playerFixtureOf(
                200, true,
                List.of(stationary(60, 75, 100, 150)),
                List.of(playerEngagement(60, 75)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f});
    }

    /** 随机战单走推进被集火：移动 + 无掩护 + 承伤高 → SOLO_DETACHED。 */
    private static PlayerFixture playerDetachPush() {
        return playerFixtureOf(
                1800, true,
                List.of(move(60, 75, 200, 200, 180, 180, 5f)),
                List.of(),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f});
    }

    private static PlayerFixture playerFixtureOf(
            final int recorderDamageReceived,
            final boolean recorderSurvived,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final float[] rawClocks
    ) {
        final Battle battle = new Battle();
        battle.arenaId = "eval-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.recorder = "rec1";
        battle.players = new ArrayList<>();
        battle.players.add(playerResult(1001L, "rec1", 1, recorderDamageReceived, recorderSurvived));
        battle.players.add(playerResult(1002L, "mate1", 1, 0, true));
        battle.players.add(playerResult(2001L, "enemy1", 2, 0, true));

        final List<BattleStateCheckpoint> checkpoints = new ArrayList<>();
        for (final float raw : rawClocks) {
            checkpoints.add(playerCheckpoint(raw));
        }
        final ReplayMetadata meta = new ReplayMetadata(
                "eval-arena", "team_map", "11.0", "11.0", 1, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(
                true, rawClocks.length, rawClocks.length, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true, 1000f, true);
        final List<com.wotb.core.replay.event.ReplayEvent> events = List.of(
                new ParticipantMappingEvent(
                        0, new ReplayTimestamp(1000f, 0f), 8, DecodeConfidence.EXACT, 1, 1001L),
                new DamageEvent(
                        1, new ReplayTimestamp(1010f, 10f), 8, DecodeConfidence.EXACT,
                        1, 4, null, null, 420, false));
        final ReplayReconstruction recon = new ReplayReconstruction(
                meta, header, 300f, 1000f,
                List.of(new BattleParticipant(1001L, "rec1", 1, 4481, "Kranvagn", true)),
                events, checkpoints, checkpoints.getLast().stateSnapshot(), coverage, diag);
        final RecorderEntityMapping recorder = new RecorderEntityMapping(
                1001L, 1, 1, "rec1", 1, 4481, DecodeConfidence.EXACT);
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                movements, engagements, phases, List.of(), List.of(), true);
        return new PlayerFixture(battle, recon, features, recorder);
    }

    private static BattleStateCheckpoint playerCheckpoint(final float rawClockSec) {
        final Map<Integer, VehicleState> vehicles = new HashMap<>();
        vehicles.put(1, vehicleState(1, 1001L, 1, 200f, 200f));
        vehicles.put(2, vehicleState(2, 1002L, 1, 0f, 0f));
        vehicles.put(3, vehicleState(3, 1003L, 1, 0f, 0f));
        return new BattleStateCheckpoint(rawClockSec, 0,
                new BattleStateSnapshot(rawClockSec, rawClockSec - 1000f,
                        BattleLifecycle.IN_PROGRESS, vehicles, Map.of(), List.of(), false, null));
    }

    private static VehicleState vehicleState(final int entityId, final long accountId,
                                             final int team, final float x, final float z) {
        final VehicleState vehicle = new VehicleState(entityId, 0f);
        vehicle.setAccountId(accountId);
        vehicle.setTeam(team);
        vehicle.setPosition(new Vector3(x, 0f, z));
        vehicle.setCurrentHealth(1000);
        vehicle.setMaxHealth(1000);
        vehicle.setLifeState(LifeState.ALIVE);
        vehicle.setObservationState(ObservationState.OBSERVED);
        return vehicle;
    }

    private static PlayerResult playerResult(final long accountId, final String nickname,
                                             final int team, final int damageReceived,
                                             final boolean survived) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        player.tankId = 4481L;
        player.damageReceived = damageReceived;
        player.survived = survived;
        return player;
    }

    private static EngagementSummary playerEngagement(final float start, final float end) {
        return new EngagementSummary(start, end, List.of(1001L), List.of(2001L),
                300, 200, new Vector3(100f, 0f, 150f), new Vector3(100f, 0f, 150f),
                EngagementOutcome.UNFAVORABLE, DecodeConfidence.PARTIAL);
    }

    // ===== 场景一：开局图控（散开拿视野，非脱节） =====

    private static SingleTeamBattleAnalysisContext openingMapControl() {
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
                        cluster(15, 30, 300, 250, List.of(key(1), key(2), key(3))),
                        cluster(15, 30, 130, 100, List.of(key(4), key(5), key(6))))),
                phase(30, 45, 250, 250, 130, 7, List.of(
                        cluster(30, 45, 350, 400, List.of(key(0))),
                        cluster(30, 45, 300, 250, List.of(key(1), key(2), key(3))),
                        cluster(30, 45, 130, 100, List.of(key(4), key(5), key(6))))),
                phase(45, 60, 260, 250, 100, 7, List.of(
                        cluster(45, 60, 280, 240, mainKeys()))));
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true);
        return context("cw-opening-mapcontrol-01", 2, 1, new double[7],
                members, aggregate, phases, BattlePhaseSummary.buildRelativePhases(60, 300),
                List.of(keyEvent(60, "TEAM_FIRST_CONTACT", "damage=120")), List.of());
    }

    // ===== 场景二：单走卡点拖延（队友借机推进） =====

    private static SingleTeamBattleAnalysisContext delayHold() {
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

    // ===== 场景三：残局 1vN 牺牲拖延（队友借机占点） =====

    private static SingleTeamBattleAnalysisContext delaySacrificeCapped() {
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

    // ===== 场景四：单走推进被集火（队友无获利） =====

    private static SingleTeamBattleAnalysisContext detachPush() {
        final double[] deaths = {0, 0, 90, 0, 0, 0, 0};
        final List<TeamMemberFeatureSet> members = List.of(
                member(0, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()),
                member(1, 300, true, null, null,
                        List.of(move(45, 90, 0, 0, 50, 0, 1f), stationary(90, 300, 50, 0)), List.of(), List.of()),
                member(2, 1800, false, 90.0, deathProximity(200, 1.0),
                        List.of(move(45, 90, 0, 0, -150, -100, 5.1f)),
                        List.of(engagement(50, 90, 10_003L, List.of(20_001L, 20_002L, 20_003L))), List.of()),
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

    // ===== 场景五：观测不足（无法确定） =====

    private static SingleTeamBattleAnalysisContext soloUnknown() {
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 100, true, null, null,
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

    // ===== 场景七：脱节后队友转场接应成功 =====

    private static SingleTeamBattleAnalysisContext detachRotate() {
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

    // ===== 场景八：信号矛盾（静止+敌情 vs 队友半获利，不硬下标签） =====

    private static SingleTeamBattleAnalysisContext delayVsDetachAmbiguous() {
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

    // ===== 场景九：占点致胜（点数推断） =====

    private static SingleTeamBattleAnalysisContext capWinByPoints() {
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

    private static SingleTeamBattleAnalysisContext capStolenWhileConcentrating() {
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

    private static SingleTeamBattleAnalysisContext capDefenseComeback() {
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

    private static SingleTeamBattleAnalysisContext capPointsDecided() {
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

    // ===== 构建辅助 =====

    private static List<TeamMemberFeatureSet> compactTeam() {
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 300, true, null, null,
                    List.of(stationary(60, 260, 0, 0)), List.of(), List.of()));
        }
        return members;
    }

    private static TeamMemberFeatureSet teammateAdvancing(final int index) {
        return member(index, 200, true, null, null,
                List.of(move(60, 150, 0, 0, 50, 0, 1f), move(150, 240, 50, 0, 150, 0, 1.5f)),
                List.of(), List.of());
    }

    private static TeamMemberFeatureSet cappingTeammate(final int index) {
        return member(index, 300, true, null, null,
                List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of());
    }

    private static SingleTeamBattleAnalysisContext context(
            final String key,
            final int arenaBonusType,
            final Integer winnerTeam,
            final double[] deathSecs,
            final List<TeamMemberFeatureSet> members,
            final TeamAggregateResult aggregate,
            final List<TeamFormationPhase> phases,
            final List<BattlePhaseSummary> battlePhases,
            final List<KeyBattleEvent> keyEvents,
            final List<String> limitations,
            final Earned... points
    ) {
        final Battle battle = battle(arenaBonusType, winnerTeam, deathSecs, points);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, members, aggregate, TeamObservedAggregate.empty(),
                phases, List.of(), battlePhases, keyEvents,
                TeamFeatureCoverage.empty(), limitations, true);
        final BattleCategory category = BattleCategoryUtils.fromArenaBonusType(arenaBonusType);
        return new SingleTeamBattleAnalysisContext(
                "eval-" + key, null, key + ".wotbreplay", category, battle, 1, features,
                null, limitations, null);
    }

    private record Earned(long accountId, int victoryPointsEarned) {
    }

    private static Earned earned(final long accountId, final int points) {
        return new Earned(accountId, points);
    }

    private static Earned enemyEarned(final long accountId, final int points) {
        return new Earned(accountId, points);
    }

    private static Battle battle(final int arenaBonusType, final Integer winnerTeam,
                                 final double[] deathSecs, final Earned[] points) {
        final Battle battle = new Battle();
        battle.arenaId = "eval-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = arenaBonusType;
        battle.durationS = 300.0;
        battle.winnerTeam = winnerTeam;
        battle.recorder = FRIENDLY_NAMES[0];
        battle.players = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            final PlayerResult player = player(
                    10_001L + index, FRIENDLY_NAMES[index], "CHRD", 1,
                    FRIENDLY_TANKS[index], 900, deathSecs[index]);
            player.victoryPointsEarned = pointsFor(points, player.accountId);
            battle.players.add(player);
        }
        for (int index = 0; index < 7; index++) {
            final PlayerResult player = player(
                    20_001L + index, "E" + (index + 1), "NOVA", 2,
                    FRIENDLY_TANKS[index], 800, 0);
            player.victoryPointsEarned = pointsFor(points, player.accountId);
            battle.players.add(player);
        }
        return battle;
    }

    private static int pointsFor(final Earned[] points, final long accountId) {
        if (points == null) {
            return 0;
        }
        for (final Earned earned : points) {
            if (earned.accountId() == accountId) {
                return earned.victoryPointsEarned();
            }
        }
        return 0;
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
                DecodeConfidence.EXACT, 900, damageReceived, 0, 0, 0,
                survived, deathSec, deathProximity, movements, engagements,
                List.of(), limitations);
    }

    private static TeamMemberFeatureSet.DeathProximity deathProximity(
            final double meters, final double deltaSec) {
        return new TeamMemberFeatureSet.DeathProximity(meters, deltaSec, DecodeConfidence.INFERRED);
    }

    private static String key(final int index) {
        return "account:" + (10_001L + index);
    }

    private static List<String> mainKeys() {
        return List.of(key(0), key(1), key(2), key(3), key(4), key(5), key(6));
    }

    private static List<String> mainKeysExcluding(final int soloIndex) {
        final List<String> keys = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            if (index != soloIndex) {
                keys.add(key(index));
            }
        }
        return keys;
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

    /** 15s 窗口序列：单走簇质心（可选渐变）+ 主力簇质心（可选渐变），首尾拼接成连续单走时段。 */
    private static List<TeamFormationPhase> soloPhases(
            final float start, final float end,
            final float soloX1, final float soloZ1, final float soloX2, final float soloZ2,
            final float mainX1, final float mainZ1, final float mainX2, final float mainZ2,
            final String soloIdentity, final List<String> mainIdentities) {
        final List<TeamFormationPhase> phases = new ArrayList<>();
        float t = start;
        int guard = 0;
        while (t < end && guard < 100) {
            final float windowEnd = Math.min(t + 15f, end);
            final float progress = (windowEnd - start) / Math.max(1f, end - start);
            final float soloX = lerp(soloX1, soloX2, progress);
            final float soloZ = lerp(soloZ1, soloZ2, progress);
            final float mainX = lerp(mainX1, mainX2, progress);
            final float mainZ = lerp(mainZ1, mainZ2, progress);
            phases.add(new TeamFormationPhase(
                    t, windowEnd, new CanonicalMapPosition(mainX, mainZ), 90f, 7,
                    DecodeConfidence.EXACT, List.of(
                            cluster(t, windowEnd, soloX, soloZ, List.of(soloIdentity)),
                            cluster(t, windowEnd, mainX, mainZ, mainIdentities))));
            t = windowEnd;
            guard++;
        }
        return phases;
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
            final long allyAccountId, final List<Long> enemyAccountIds) {
        return new EngagementSummary(start, end, List.of(allyAccountId), enemyAccountIds,
                300, 200, new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                EngagementOutcome.UNFAVORABLE, DecodeConfidence.PARTIAL);
    }

    private static KeyBattleEvent keyEvent(final float clock, final String type, final String label) {
        return new KeyBattleEvent(clock, type, label, DecodeConfidence.EXACT, "TEST", List.of());
    }

    private static float lerp(final float from, final float to, final float progress) {
        return from + (to - from) * progress;
    }
}
