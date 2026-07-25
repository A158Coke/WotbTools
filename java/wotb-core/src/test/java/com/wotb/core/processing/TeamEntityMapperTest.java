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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamEntityMapperTest {

    @Test
    void mapsAlliedAndEnemyEntitiesByAccount() {
        final Battle battle = battle(
                player(100L, "Ally", 1),
                player(200L, "Enemy", 2));
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(
                battle,
                reconstruction(
                        List.of(
                                participant(100L, "Ally", 1),
                                participant(200L, "Enemy", 2)),
                        List.of(event(1, 10, 100L), event(2, 20, 200L))));

        assertEquals(1, mapping.identity(10).team());
        assertEquals(2, mapping.identity(20).team());
        assertEquals(1, mapping.mappedMembers(1));
    }

    @Test
    void unknownAccountIsNotAttributed() {
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(
                battle(player(100L, "Ally", 1)),
                reconstruction(List.of(), List.of(event(1, 99, 999L))));

        assertNull(mapping.identity(99));
        assertTrue(mapping.limitations().contains("TEAM_ENTITY_MAPPING_INSUFFICIENT"));
    }

    @Test
    void partialAndUnknownMappingEventsAreNotAttributed() {
        final Battle battle = battle(player(100L, "Ally", 1));
        for (final DecodeConfidence confidence : List.of(
                DecodeConfidence.PARTIAL, DecodeConfidence.UNKNOWN)) {
            final TeamEntityMapping mapping = TeamEntityMapper.resolve(
                    battle,
                    reconstruction(
                            List.of(participant(100L, "Ally", 1)),
                            List.of(event(1, 10, 100L, confidence))));

            assertNull(mapping.identity(10));
            assertTrue(mapping.limitations().contains(
                    "TEAM_ENTITY_MAPPING_INSUFFICIENT"));
        }
    }

    @Test
    void teamTaggedNonVehicleParticipantIsNotAttributed() {
        final BattleParticipant observer =
                new BattleParticipant(999L, "Observer", 1, 0, "", false);

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(
                battle(),
                reconstruction(
                        List.of(observer),
                        List.of(event(1, 10, 999L))));

        assertNull(mapping.identity(10));
        assertTrue(mapping.limitations().contains(
                "TEAM_ENTITY_MAPPING_INSUFFICIENT"));
    }

    @Test
    void nonVehicleParticipantCannotBypassFilterThroughNickname() {
        final BattleParticipant observer =
                new BattleParticipant(999L, "SameName", 1, 0, "", false);

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(
                battle(player(100L, "SameName", 1)),
                reconstruction(
                        List.of(observer),
                        List.of(event(1, 10, 999L))));

        assertNull(mapping.identity(10));
        assertTrue(mapping.limitations().contains(
                "TEAM_ENTITY_MAPPING_INSUFFICIENT"));
    }

    @Test
    void missingAccountIdCanUseUniqueNicknameEvidence() {
        final Battle battle = battle(player(100L, "Ally", 1));
        final BattleParticipant participant =
                new BattleParticipant(0L, "Ally", 1, 7, "tank", false);
        final ParticipantMappingEvent event = new ParticipantMappingEvent(
                1, new ReplayTimestamp(1, null), 8,
                DecodeConfidence.EXACT, 10, 0L, "Ally", 1);

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(
                battle, reconstruction(List.of(participant), List.of(event)));

        assertEquals(100L, mapping.identity(10).accountId());
        assertEquals(1, mapping.identity(10).team());
        assertEquals(DecodeConfidence.INFERRED, mapping.identity(10).confidence());
        assertEquals(List.of(10), mapping.entityIds(100L));
    }

    @Test
    void participantNicknameFallbackIsInferred() {
        final Battle battle = battle(player(100L, "SameName", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(participant(999L, "SameName", 1)),
                List.of(event(1, 10, 999L)));

        final TeamEntityMapping mapping =
                TeamEntityMapper.resolve(battle, reconstruction);
        final TeamEntityIdentity identity = mapping.identity(10);

        assertEquals(1, identity.team());
        assertEquals(100L, identity.accountId());
        assertEquals(DecodeConfidence.INFERRED, identity.confidence());
        assertEquals(List.of(10), mapping.entityIds(100L));
        assertTrue(mapping.entityIds(999L).isEmpty());
    }

    @Test
    void entityReentryKeepsEveryEntityForAccount() {
        final Battle battle = battle(player(100L, "Ally", 1));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(participant(100L, "Ally", 1)),
                List.of(event(1, 10, 100L), event(5, 30, 100L)));

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, reconstruction);

        assertEquals(List.of(10, 30), mapping.entityIds(100L));
        assertEquals(1, mapping.mappedMembers(1));
    }

    @Test
    void conflictingEntityReuseIsExcluded() {
        final Battle battle = battle(
                player(100L, "A", 1),
                player(200L, "B", 2));
        final ReplayReconstruction reconstruction = reconstruction(
                List.of(participant(100L, "A", 1), participant(200L, "B", 2)),
                List.of(event(1, 10, 100L), event(2, 10, 200L)));

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, reconstruction);

        assertNull(mapping.identity(10));
        assertTrue(mapping.entityIds(100L).isEmpty());
        assertTrue(mapping.entityIds(200L).isEmpty());
        assertEquals(1, mapping.ambiguousEntityCount());
        assertTrue(mapping.limitations().contains("TEAM_ENTITY_MAPPING_CONFLICT"));
    }

    private static Battle battle(final PlayerResult... players) {
        final Battle battle = new Battle();
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
        player.tankId = accountId + 1;
        player.tankName = "tank-" + accountId;
        return player;
    }

    private static BattleParticipant participant(
            final long accountId,
            final String nickname,
            final int team
    ) {
        return new BattleParticipant(accountId, nickname, team, 1, "tank", false);
    }

    private static ParticipantMappingEvent event(
            final int sequence,
            final int entityId,
            final long accountId
    ) {
        return event(sequence, entityId, accountId, DecodeConfidence.EXACT);
    }

    private static ParticipantMappingEvent event(
            final int sequence,
            final int entityId,
            final long accountId,
            final DecodeConfidence confidence
    ) {
        return new ParticipantMappingEvent(
                sequence, new ReplayTimestamp(sequence, null), 8,
                confidence, entityId, accountId);
    }

    private static ReplayReconstruction reconstruction(
            final List<BattleParticipant> participants,
            final List<? extends ReplayEvent> events
    ) {
        return new ReplayReconstruction(
                null, null, 60f, null, participants, List.copyOf(events),
                List.of(), null, null, null);
    }
}
