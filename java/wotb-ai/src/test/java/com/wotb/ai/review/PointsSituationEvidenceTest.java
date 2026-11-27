package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.evidence.PointsSituationSkill;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PointsSituationEvidenceTest {

    private static final String MAP = "holland";

    private static PlayerResult player(final long accountId, final int team,
                                       final String nickname, final boolean survived) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.nickname = nickname;
        p.survived = survived;
        return p;
    }

    private static PositionChangedEvent pos(final int sequence, final float rawClock,
                                            final int entityId, final float x, final float z) {
        return new PositionChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0, x, 0f, z,
                0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    private static ReplayReconstruction reconWithPositions(final Float battleStart) {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(3, 40f, 10, -80f, 120f));
        events.add(pos(4, 42f, 10, -80f, 0f));
        events.add(pos(5, 44f, 10, -70f, 0f));
        events.add(pos(6, 40f, 20, 0f, 0f));
        events.add(pos(7, 42f, 20, 10f, 0f));
        return new ReplayReconstruction(null, null, 600f, battleStart, List.of(),
                events, List.of(), null, null, null);
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        final PlayerResult ally = player(1001L, 1, "Ally", false);
        ally.deathTimeMillis = 60_000L;
        ally.settlementLifeTimeSec = 60;
        battle.players = List.of(ally, player(2001L, 2, "EnemyA", true));
        return battle;
    }

    @Test
    void collectTracksResolvesEntitiesIntoPerTeamTracks() {
        final Battle battle = battle();
        final ReplayReconstruction recon = reconWithPositions(30f);
        final List<PointsSituationSkill.VehicleTrack> tracks =
                PointsSituationEvidence.collectTracks(battle, recon);
        assertEquals(2, tracks.size());
        final PointsSituationSkill.VehicleTrack ally = tracks.stream()
                .filter(t -> t.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(1, ally.team());
        assertEquals(3, ally.samples().size());
        assertEquals(10f, ally.samples().getFirst().timeSec());
        assertFalse(TeamEntityMapper.resolve(battle, recon).entitiesById().isEmpty());
    }

    @Test
    void collectTracksEmptyWithoutReconOrMapping() {
        assertTrue(PointsSituationEvidence.collectTracks(battle(), null).isEmpty());
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                List.of(), List.of(), List.of(), null, null, null);
        assertTrue(PointsSituationEvidence.collectTracks(battle(), recon).isEmpty());
    }

    @Test
    void renderSectionOutputsKillTimelinePresenceAndEntryWindows() {
        final String section = PointsSituationEvidence.renderSection(
                battle(), reconWithPositions(30f), 1, true, "本队", "对方");
        assertTrue(section.contains("POINTS_SITUATION"), section);
        assertTrue(section.contains("KILL_POINTS_TIMELINE"), section);
        assertTrue(section.contains("本队车辆被击毁 → 本队 -40 / 对方 +40"), section);
        assertTrue(section.contains("CAPTURE_PRESENCE"), section);
        assertTrue(section.contains("本队 1 车 / 对方 1 车"), section);
        assertTrue(section.contains("CONTROL_REGION_ENTRY_WINDOWS"), section);
        assertTrue(section.contains("目标 5 区"), section);
        assertTrue(section.contains("进入窗口车辆承受伤害不可用（OBSERVED_DAMAGE_IS_PARTIAL）"), section);
    }

    @Test
    void renderSectionFallsBackToKillTimelineOnlyWithoutRecon() {
        final String section = PointsSituationEvidence.renderSection(
                battle(), null, 1, true, "本队", "对方");
        assertTrue(section.contains("KILL_POINTS_TIMELINE"), section);
        assertFalse(section.contains("CAPTURE_PRESENCE"), section);
        assertFalse(section.contains("CONTROL_REGION_ENTRY_WINDOWS"), section);
    }

    @Test
    void tollCountsOnlyOppositeTeamResolvedAttackerDamageInsideWindow() {
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(3, 40f, 10, -80f, 120f));
        events.add(pos(4, 42f, 10, -80f, 0f));
        events.add(pos(5, 44f, 10, -70f, 0f));
        events.add(pos(6, 40f, 20, 0f, 0f));
        events.add(pos(7, 42f, 20, 10f, 0f));
        events.add(dmg(8, 42.5f, 20, 10, 400));
        events.add(dmg(9, 43f, 999, 10, 300));
        events.add(dmg(10, 43.5f, 10, 10, 250));
        events.add(dmg(11, 50f, 20, 10, 200));
        events.add(hp(12, 42.0f, 10, 2000));
        events.add(hp(13, 42.5f, 10, 1600));
        events.add(hp(14, 43.0f, 10, 1300));
        events.add(hp(15, 43.5f, 10, 1050));
        events.add(hp(16, 49.5f, 10, 1050));
        events.add(hp(17, 50.0f, 10, 850));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                List.of(), events, List.of(), null, null, null);

        final String section = PointsSituationEvidence.renderSection(
                battle, recon, 1, false, "本队", "对方");

        assertTrue(section.contains("总实际掉血 950"), section);
        assertTrue(section.contains("可归属敌方 400"), section);
        assertTrue(section.contains("来源未知 550"), section);
        assertTrue(section.contains("2 笔"), section);
        assertFalse(section.contains("总实际掉血 1150"), "窗口外伤害不得计入总掉血");
        assertFalse(section.contains("可归属敌方 1150"), "窗口外伤害不得计入可归属敌方");
    }

    private static DamageEvent dmg(final int sequence, final float rawClock,
                                   final int attackerEid, final int victimEid, final int amount) {
        return new DamageEvent(sequence, new ReplayTimestamp(rawClock, null), 8,
                DecodeConfidence.EXACT, attackerEid, victimEid, null, null, amount, false);
    }

    private static HealthChangedEvent hp(final int sequence, final float rawClock,
                                         final int entityId, final int currentHp) {
        return new HealthChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 7,
                DecodeConfidence.EXACT, entityId, currentHp, null, true);
    }

    @Test
    void renderSectionEmptyForInvalidPerspectiveOrNoData() {
        assertTrue(PointsSituationEvidence.renderSection(
                battle(), null, 3, true, "本队", "对方").isEmpty());
        final Battle battle = battle();
        battle.players = List.of(player(1001L, 1, "Ally", true));
        final Battle empty = new Battle();
        empty.mapName = MAP;
        assertTrue(PointsSituationEvidence.renderSection(
                battle, null, 1, true, "本队", "对方").isEmpty());
        assertTrue(PointsSituationEvidence.renderSection(
                empty, null, 1, true, "本队", "对方").isEmpty());
    }

    @Test
    void tollCountsUnattributedRealHpLossInTotal() {
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(pos(2, 40f, 10, -80f, 120f));
        events.add(pos(3, 42f, 10, -80f, 0f));
        events.add(pos(4, 44f, 10, -70f, 0f));
        events.add(hp(5, 42.0f, 10, 2000));
        events.add(hp(6, 42.5f, 10, 1623));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                List.of(), events, List.of(), null, null, null);

        final String section = PointsSituationEvidence.renderSection(
                battle, recon, 1, false, "本队", "对方");

        assertTrue(section.contains("总实际掉血 377"), section);
        assertTrue(section.contains("可归属敌方 0"), section);
        assertTrue(section.contains("来源未知 377"), section);
        assertTrue(section.contains("1 笔"), section);
    }

    @Test
    void tollUsesHpLossNotRawProtocolValue() {
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(3, 40f, 10, -80f, 120f));
        events.add(pos(4, 42f, 10, -80f, 0f));
        events.add(pos(5, 44f, 10, -70f, 0f));
        events.add(dmg(6, 42.5f, 20, 10, 767));
        events.add(hp(7, 42.0f, 10, 2000));
        events.add(hp(8, 42.5f, 10, 1623));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                List.of(), events, List.of(), null, null, null);

        final String section = PointsSituationEvidence.renderSection(
                battle, recon, 1, false, "本队", "对方");

        assertTrue(section.contains("总实际掉血 377"), section);
        assertTrue(section.contains("可归属敌方 377"), section);
        assertTrue(section.contains("来源未知 0"), section);
        assertFalse(section.contains("767"), "Type-8 rawProtocolValue 不得作为窗口承伤数字");
    }

    @Test
    void tollUnknownWhenAttackerTeamUnknown() {
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 99, 9999L));
        events.add(pos(3, 40f, 10, -80f, 120f));
        events.add(pos(4, 42f, 10, -80f, 0f));
        events.add(pos(5, 44f, 10, -70f, 0f));
        events.add(dmg(6, 42.5f, 99, 10, 400));
        events.add(hp(7, 42.0f, 10, 2000));
        events.add(hp(8, 42.5f, 10, 1600));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                List.of(), events, List.of(), null, null, null);

        final String section = PointsSituationEvidence.renderSection(
                battle, recon, 1, false, "本队", "对方");

        assertTrue(section.contains("总实际掉血 400"), section);
        assertTrue(section.contains("可归属敌方 0"), section);
        assertTrue(section.contains("来源未知 400"), section);
    }

    @Test
    void tollMultipleLossesNotDoubleCounted() {
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(3, 40f, 10, -80f, 120f));
        events.add(pos(4, 42f, 10, -80f, 0f));
        events.add(pos(5, 44f, 10, -70f, 0f));
        events.add(dmg(6, 42.5f, 20, 10, 200));
        events.add(dmg(7, 43.5f, 20, 10, 400));
        events.add(hp(8, 42.0f, 10, 2000));
        events.add(hp(9, 42.5f, 10, 1800));
        events.add(hp(10, 43.0f, 10, 1800));
        events.add(hp(11, 43.5f, 10, 1400));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                List.of(), events, List.of(), null, null, null);

        final String section = PointsSituationEvidence.renderSection(
                battle, recon, 1, false, "本队", "对方");

        assertTrue(section.contains("总实际掉血 600"), section);
        assertTrue(section.contains("可归属敌方 600"), section);
        assertFalse(section.contains("总实际掉血 1200"), "两次掉血不得重复计数");
    }
}
