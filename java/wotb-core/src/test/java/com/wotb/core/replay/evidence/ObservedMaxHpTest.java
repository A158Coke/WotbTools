package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ObservedMaxHpTest {

    private static PlayerResult player(final long accountId, final int team, final long tankId) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.survived = true;
        return p;
    }

    private static HealthChangedEvent hp(final int seq, final int entityId,
                                         final Integer current, final DecodeConfidence conf) {
        return new HealthChangedEvent(seq, new ReplayTimestamp(10f, null), 7, conf,
                entityId, current, null, current != null && current > 0);
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.players = List.of(player(1001L, 1, 29985L));
        return battle;
    }

    private static List<ReplayEvent> eventsWithSentinels() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(10f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(hp(2, 10, 2000, DecodeConfidence.EXACT));
        events.add(hp(3, 10, 65533, DecodeConfidence.EXACT));
        events.add(hp(4, 10, 65535, DecodeConfidence.PARTIAL));
        return events;
    }

    private static ReplayReconstruction recon(final List<ReplayEvent> events) {
        return new ReplayReconstruction(null, null, 100f, 10f,
                List.of(), events, List.of(), null, null, null);
    }

    @Test
    void sentinelHpNeverEntersObservedMax() {
        final Battle battle = battle();
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon(eventsWithSentinels()));
        final Map<Long, Integer> observed = ObservedMaxHp.byAccount(eventsWithSentinels(), mapping);
        assertEquals(2000, observed.get(1001L), "65533/65535 sentinel 不得进入 observedMaxHp");
        assertTrue(observed.get(1001L) < 0xFF00);
    }

    @Test
    void populateNeverWritesSentinelToPlayer() {
        final Battle battle = battle();
        ObservedMaxHp.populate(battle, eventsWithSentinels(),
                TeamEntityMapper.resolve(battle, recon(eventsWithSentinels())));
        assertEquals(3400, battle.players.getFirst().observedMaxHp);
        assertTrue(battle.players.getFirst().observedMaxHp < 0xFF00);
        assertEquals(EntryHpSource.BASE_FALLBACK, battle.players.getFirst().entryHpSource);
        assertNull(battle.players.getFirst().entryHp);
    }

    @Test
    void populatePreservesMaxAndTimelineReductionSemantics() {
        final Battle battle = battle();
        battle.players.getFirst().damageReceived = 400;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(20f, null), 7,
                DecodeConfidence.EXACT, 10, 3200, null, true));
        events.add(new HealthChangedEvent(3, new ReplayTimestamp(10f, null), 7,
                DecodeConfidence.EXACT, 10, 3600, null, true));
        events.add(new HealthChangedEvent(4, new ReplayTimestamp(5f, null), 7,
                DecodeConfidence.EXACT, 10, null, null, false, 0xFFFF, HpRawState.UNKNOWN_FFFF));
        events.add(new HealthChangedEvent(5, new ReplayTimestamp(1f, null), 7,
                DecodeConfidence.EXACT, 99, 9999, null, true));
        events.add(new DamageEvent(6, new ReplayTimestamp(30f, null), 8,
                DecodeConfidence.EXACT, 20, 10, null, null, 400, false));

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon(events));
        assertEquals(9999, ObservedMaxHp.byAccount(events, mapping).get(0L),
                "public max reduction keeps plausible unknown-account observations under account 0");

        ObservedMaxHp.populate(battle, events, mapping);

        final PlayerResult player = battle.players.getFirst();
        assertEquals(3600, player.observedMaxHp,
                "account max reduction ignores unknown sentinel and other accounts");
        assertEquals(EntryHpSource.OBSERVED_EXACT, player.entryHpSource,
                "timeline reduction must retain chronological first plausible sample");
        assertEquals(3600, player.entryHp);
        assertTrue(ObservedMaxHp.byAccount(null, mapping).isEmpty(),
                "null event input remains an empty max reduction");
    }

    @Test
    void resolveFallsBackToTankopediaBaseWithoutObservation() {
        assertEquals(3400, ObservedMaxHp.resolve(null, 29985L));
        assertEquals(3400, ObservedMaxHp.resolve(2000, 29985L));
    }

    @Test
    void preFirstDamageSampleAtOrAboveBaseProvesEntryExact() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(10f, null), 7,
                DecodeConfidence.EXACT, 10, 3600, null, true));
        events.add(new HealthChangedEvent(3, new ReplayTimestamp(20f, null), 7,
                DecodeConfidence.EXACT, 10, 3200, null, true));
        events.add(new DamageEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 10, null, null, 400, false));
        final Battle battle = battle();
        battle.players.getFirst().damageReceived = 400;
        ObservedMaxHp.populate(battle, events,
                TeamEntityMapper.resolve(battle, recon(events)));
        final PlayerResult p = battle.players.getFirst();
        assertEquals(EntryHpSource.OBSERVED_EXACT, p.entryHpSource);
        assertEquals(3600, p.entryHp);
    }

    @Test
    void sampleBelowBaseBeforeFirstDamageIsNotProvenEntry() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(10f, null), 7,
                DecodeConfidence.EXACT, 10, 3000, null, true));
        events.add(new HealthChangedEvent(3, new ReplayTimestamp(20f, null), 7,
                DecodeConfidence.EXACT, 10, 2600, null, true));
        events.add(new DamageEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 10, null, null, 400, false));
        final Battle battle = battle();
        battle.players.getFirst().damageReceived = 400;
        ObservedMaxHp.populate(battle, events,
                TeamEntityMapper.resolve(battle, recon(events)));
        assertEquals(EntryHpSource.BASE_FALLBACK, battle.players.getFirst().entryHpSource);
        assertNull(battle.players.getFirst().entryHp);
    }

    @Test
    void recorderOpeningHpFromMethod5IsAffirmedEvenBelowTankopediaBase() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new com.wotb.core.replay.event.RecorderHealthChangedEvent(
                2, new ReplayTimestamp(8f, null), 8,
                DecodeConfidence.EXACT, 10, 3200, 1));
        final Battle battle = battle();
        battle.recorder = "rec";
        battle.players.getFirst().nickname = "rec";
        ObservedMaxHp.populate(battle, events,
                TeamEntityMapper.resolve(battle, recon(events)));
        final PlayerResult p = battle.players.getFirst();
        assertEquals(EntryHpSource.OBSERVED_EXACT, p.entryHpSource,
                "recorder own-health mirror 是客户端直接权威，无需 damage coverage");
        assertEquals(3200, p.entryHp);
    }

    @Test
    void unobservedEarlyDamageMakesCoveragePartialAndFailsClosed() {
        final Battle battle = new Battle();
        battle.players = List.of(player(1001L, 1, 4481L));
        battle.players.getFirst().damageReceived = 200;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(10f, null), 7,
                DecodeConfidence.EXACT, 10, 2500, null, true));
        events.add(new HealthChangedEvent(3, new ReplayTimestamp(20f, null), 7,
                DecodeConfidence.EXACT, 10, 2400, null, true));
        events.add(new DamageEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 10, null, null, 100, false));
        ObservedMaxHp.populate(battle, events,
                TeamEntityMapper.resolve(battle, recon(events)));
        assertEquals(EntryHpSource.BASE_FALLBACK, battle.players.getFirst().entryHpSource,
                "受击覆盖 PARTIAL 时不得仅凭「样本早于首次观测受击」判 OBSERVED_EXACT");
        assertNull(battle.players.getFirst().entryHp);
    }

    @Test
    void partialCoverageWithoutAnyObservedDamageFailsClosed() {
        final Battle battle = new Battle();
        battle.players = List.of(player(1001L, 1, 4481L));
        battle.players.getFirst().damageReceived = 100;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(10f, null), 7,
                DecodeConfidence.EXACT, 10, 2500, null, true));
        ObservedMaxHp.populate(battle, events,
                TeamEntityMapper.resolve(battle, recon(events)));
        assertEquals(EntryHpSource.BASE_FALLBACK, battle.players.getFirst().entryHpSource);
        assertNull(battle.players.getFirst().entryHp);
    }
}
