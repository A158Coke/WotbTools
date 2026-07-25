package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamPerspectiveResolverTest {

    @Test
    void resolvesFromAuthoritativeRecorderResult() {
        final Battle battle = battle("Recorder", player(100L, "Recorder", 2));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, null);

        assertTrue(result.resolved());
        assertEquals(2, result.perspectiveTeam());
        assertEquals(100L, result.recorderAccountId());
        assertEquals(DecodeConfidence.EXACT, result.confidence());
    }

    @Test
    void resolvesFromRecorderParticipantAndAccountMapping() {
        final Battle battle = battle("", player(100L, "Recorder", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(100L, "Recorder", 1, 7, "tank", true)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertTrue(result.resolved());
        assertEquals(1, result.perspectiveTeam());
        assertEquals(10, result.recorderEntityId());
    }

    @Test
    void nicknameFallbackIsInferred() {
        final Battle battle = battle("Recorder");
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(100L, "Recorder", 1, 7, "tank", false)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertTrue(result.resolved());
        assertEquals(DecodeConfidence.INFERRED, result.confidence());
        assertTrue(result.limitations().contains("RECORDER_MATCHED_BY_NICKNAME"));
    }

    @Test
    void invalidAuthoritativeTeamDoesNotUpgradeNicknameFallbackConfidence() {
        final Battle battle = battle(
                "Recorder", player(0L, "Recorder", 0));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(
                        100L, "Recorder", 1, 7, "tank", false)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertTrue(result.resolved());
        assertEquals(1, result.perspectiveTeam());
        assertEquals(DecodeConfidence.INFERRED, result.confidence());
        assertTrue(result.limitations().contains("RECORDER_MATCHED_BY_NICKNAME"));
    }

    @Test
    void recorderEntityCanBeResolvedByNicknameWhenAccountIdIsMissing() {
        final Battle battle = battle(
                "Recorder", player(0L, "Recorder", 1));
        final ParticipantMappingEvent event = new ParticipantMappingEvent(
                1, new ReplayTimestamp(1, null), 8,
                DecodeConfidence.EXACT, 10, 0L, "Recorder", 1);
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(
                        0L, "Recorder", 1, 7, "tank", true)),
                List.of(event));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertTrue(result.resolved());
        assertEquals(10, result.recorderEntityId());
        assertNull(result.recorderAccountId());
    }

    @Test
    void missingRecorderRemainsUnresolved() {
        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle(""), reconstruction(List.of(), List.of()));

        assertFalse(result.resolved());
        assertTrue(result.limitations().contains("PERSPECTIVE_TEAM_UNRESOLVED"));
    }

    @Test
    void teamZeroIsNotValid() {
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(100L, "Observer", 0, 0, "", true)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle(""), reconstruction);

        assertFalse(result.resolved());
        assertNull(result.perspectiveTeam());
    }

    @Test
    void consistentEvidenceKeepsExactTeam() {
        final Battle battle = battle("Recorder", player(100L, "Recorder", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(100L, "Recorder", 1, 7, "tank", true)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertEquals(1, result.perspectiveTeam());
        assertEquals(DecodeConfidence.EXACT, result.confidence());
    }

    @Test
    void conflictingTeamEvidenceIsRejected() {
        final Battle battle = battle("Recorder", player(100L, "Recorder", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(100L, "Recorder", 2, 7, "tank", true)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertFalse(result.resolved());
        assertTrue(result.limitations().contains("PERSPECTIVE_TEAM_CONFLICT"));
    }

    @Test
    void observerEntityDoesNotBecomePerspectiveTeam() {
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(100L, "Observer", 0, 0, "", true)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle("Observer"), reconstruction);

        assertFalse(result.resolved());
    }

    @Test
    void teamTaggedNonVehicleRecorderDoesNotBecomePerspectiveTeam() {
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(
                        100L, "Observer", 1, 0, "", true)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle(""), reconstruction);

        assertFalse(result.resolved());
        assertTrue(result.limitations().contains(
                "PERSPECTIVE_TEAM_UNRESOLVED"));
    }

    @Test
    void nonVehicleParticipantCannotConflictWithAuthoritativeTeam() {
        final Battle battle = battle(
                "Recorder", player(100L, "Recorder", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(
                        100L, "Recorder", 2, 0, "", true)),
                List.of(mapping(1, 10, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertTrue(result.resolved());
        assertEquals(1, result.perspectiveTeam());
        assertEquals(DecodeConfidence.EXACT, result.confidence());
    }

    @Test
    void missingEntityMappingDoesNotBlockAuthoritativeTeamFallback() {
        final Battle battle = battle("Recorder", player(100L, "Recorder", 1));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction(List.of(), List.of()));

        assertTrue(result.resolved());
        assertNull(result.recorderEntityId());
        assertTrue(result.limitations().contains("RECORDER_ENTITY_UNMAPPED"));
    }

    @Test
    void reentryUsesLatestEntityAndRecordsLimitation() {
        final Battle battle = battle("Recorder", player(100L, "Recorder", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(100L, "Recorder", 1, 7, "tank", true)),
                List.of(mapping(1, 10, 100L), mapping(5, 20, 100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertEquals(20, result.recorderEntityId());
        assertTrue(result.limitations().contains("RECORDER_ENTITY_REENTRY"));
    }

    @Test
    void lowConfidenceMappingDoesNotResolveRecorderEntity() {
        final Battle battle = battle("Recorder", player(100L, "Recorder", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(new BattleParticipant(
                        100L, "Recorder", 1, 7, "tank", true)),
                List.of(new ParticipantMappingEvent(
                        1,
                        new ReplayTimestamp(1, null),
                        8,
                        DecodeConfidence.PARTIAL,
                        10,
                        100L)));

        final TeamPerspectiveResolution result =
                TeamPerspectiveResolver.resolve(battle, reconstruction);

        assertTrue(result.resolved());
        assertNull(result.recorderEntityId());
        assertTrue(result.limitations().contains("RECORDER_ENTITY_UNMAPPED"));
    }

    private static Battle battle(final String recorder, final PlayerResult... players) {
        final Battle battle = new Battle();
        battle.recorder = recorder;
        battle.players = List.of(players);
        return battle;
    }

    private static PlayerResult player(
            final long accountId,
            final String nickname,
            final int team
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        return player;
    }

    private static ParticipantMappingEvent mapping(
            final int sequence,
            final int entityId,
            final long accountId
    ) {
        return new ParticipantMappingEvent(
                sequence,
                new ReplayTimestamp(sequence, null),
                8,
                DecodeConfidence.EXACT,
                entityId,
                accountId);
    }

    private static ReplayReconstruction reconstruction(
            final List<BattleParticipant> participants,
            final List<? extends ReplayEvent> events
    ) {
        return new ReplayReconstruction(
                null, null, 60f, null,
                participants, List.copyOf(events), List.of(), null, null, null);
    }
}
