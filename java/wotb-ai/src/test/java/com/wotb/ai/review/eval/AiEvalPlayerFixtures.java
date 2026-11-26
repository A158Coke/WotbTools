package com.wotb.ai.review.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.evidence.TeamSeparationEvidenceSkill;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayStreamDiagnostics;
import com.wotb.core.replay.reconstruction.ReplayStreamHeader;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.move;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.stationary;

final class AiEvalPlayerFixtures {
    record PlayerFixture(
            Battle battle,
            ReplayReconstruction recon,
            PlayerBattleFeatureSet features,
            RecorderEntityMapping recorder
    ) {
    }

    private AiEvalPlayerFixtures() {
    }

    static PlayerFixture playerFixture(final String fixtureKey) {
        return switch (fixtureKey) {
            case "player-opening-mapcontrol-01" -> playerOpeningMapControl();
            case "player-delay-hold-01" -> playerDelayHold();
            case "player-detach-push-01" -> playerDetachPush();
            case "player-no-growth-01" -> playerNoGrowth();
            case "player-unknown-stationary-01" -> playerUnknownStationary();
            case "player-opening-contact-01" -> playerOpeningContact();
            case "player-thin-coverage-01" -> playerThinCoverage();
            case "player-partial-overlap-strong-signals-01" -> playerPartialOverlapStrongSignals();
            case "player-damage-partial-opening-01" -> playerDamagePartialOpening();
            default -> throw new IllegalArgumentException("Unknown player fixture: " + fixtureKey);
        };
    }

    private static PlayerFixture playerOpeningMapControl() {
        return playerFixtureOf(
                0, true,
                List.of(move(5, 40, 0, 0, 100, 150, 6f)),
                List.of(),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f},
                new float[]{200f, 200f, 200f});
    }

    private static PlayerFixture playerDelayHold() {
        return playerFixtureOf(
                200, true,
                List.of(stationary(60, 75, 100, 150)),
                List.of(playerEngagement(60, 75)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f},
                new float[]{200f, 200f});
    }

    private static PlayerFixture playerDetachPush() {
        return playerFixtureOf(
                1800, true,
                List.of(move(60, 75, 200, 200, 240, 240, 5f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 240f},
                new float[]{200f, 240f});
    }

    private static PlayerFixture playerNoGrowth() {
        return playerFixtureOf(
                1800, true,
                List.of(move(60, 75, 200, 200, 200, 200, 5f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f},
                new float[]{200f, 200f});
    }

    private static PlayerFixture playerUnknownStationary() {
        return playerFixtureOf(
                1800, true,
                List.of(move(5, 10, 200, 200, 200, 200, 1f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f},
                new float[]{200f, 200f});
    }

    private static PlayerFixture playerOpeningContact() {
        return playerFixtureOf(
                200, true,
                List.of(move(5, 40, 0, 0, 100, 150, 6f)),
                List.of(playerEngagement(5, 40, 200)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f},
                new float[]{200f, 200f, 200f});
    }

    private static PlayerFixture playerThinCoverage() {
        return playerFixtureOf(
                1800, true,
                List.of(move(60, 61, 200, 200, 200, 200, 5f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1065f, 1075f},
                new float[]{200f, 200f, 240f},
                new float[]{200f, 200f, 240f});
    }

    private static PlayerFixture playerPartialOverlapStrongSignals() {
        return playerFixtureOf(
                0, true,
                List.of(move(60, 75, 200, 200, 240, 240, 5f)),
                List.of(playerEngagement(40, 65, 1000)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1065f, 1075f},
                new float[]{200f, 200f, 240f},
                new float[]{200f, 200f, 240f});
    }

    private static PlayerFixture playerDamagePartialOpening() {
        return playerFixtureOf(
                0, true,
                List.of(move(5, 40, 0, 0, 100, 150, 6f)),
                List.of(),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f},
                new float[]{200f, 200f, 200f},
                List.of(TeamSeparationEvidenceSkill.OBSERVED_DAMAGE_IS_PARTIAL));
    }

    private static PlayerFixture playerFixtureOf(
            final int recorderDamageReceived,
            final boolean recorderSurvived,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final float[] rawClocks,
            final float[] recorderXs,
            final float[] recorderZs
    ) {
        return playerFixtureOf(recorderDamageReceived, recorderSurvived, movements,
                engagements, phases, rawClocks, recorderXs, recorderZs, List.of());
    }

    private static PlayerFixture playerFixtureOf(
            final int recorderDamageReceived,
            final boolean recorderSurvived,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final float[] rawClocks,
            final float[] recorderXs,
            final float[] recorderZs,
            final List<String> limitations
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
        for (int index = 0; index < rawClocks.length; index++) {
            checkpoints.add(playerCheckpoint(rawClocks[index], recorderXs[index], recorderZs[index]));
        }
        final ReplayMetadata meta = new ReplayMetadata(
                "eval-arena", "team_map", "11.0", "11.0", 1, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(rawClocks.length, rawClocks.length, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
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
                movements, engagements, phases, List.of(), limitations, true);
        return new PlayerFixture(battle, recon, features, recorder);
    }

    private static BattleStateCheckpoint playerCheckpoint(final float rawClockSec,
                                                          final float recorderX,
                                                          final float recorderZ) {
        final Map<Integer, VehicleState> vehicles = new HashMap<>();
        vehicles.put(1, vehicleState(1, 1001L, 1, recorderX, recorderZ));
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
        return playerEngagement(start, end, 200);
    }

    private static EngagementSummary playerEngagement(final float start, final float end,
                                                      final int damageReceived) {
        return new EngagementSummary(start, end, List.of(), List.of(),
                300, damageReceived, new Vector3(100f, 0f, 150f), new Vector3(100f, 0f, 150f),
                DecodeConfidence.PARTIAL);
    }
}
