package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** ObservedMaxHp：sentinel（0xFFFD=65533 / 0xFFFF=65535）绝不得污染实测最大血量；entry HP provenance。 */
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
        battle.players = List.of(player(1001L, 1, 29985L)); // SPHT tankopedia base 3400
        return battle;
    }

    private static List<ReplayEvent> eventsWithSentinels() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(10f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(hp(2, 10, 2000, DecodeConfidence.EXACT));  // 真实正 HP
        events.add(hp(3, 10, 65533, DecodeConfidence.EXACT)); // 0xFFFD 死亡 sentinel（解码层已归一化，此处兜底）
        events.add(hp(4, 10, 65535, DecodeConfidence.PARTIAL)); // 0xFFFF UNKNOWN sentinel
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
        // max(2000 观测, 3400 tankopedia base) = 3400；绝不可能是 65533/65535
        assertEquals(3400, battle.players.getFirst().observedMaxHp);
        assertTrue(battle.players.getFirst().observedMaxHp < 0xFF00);
        // 样本 2000 < base 3400 且无受击前证明 → 进场满血无法证明 → BASE_FALLBACK，entryHp=null
        assertEquals(EntryHpSource.BASE_FALLBACK, battle.players.getFirst().entryHpSource);
        assertNull(battle.players.getFirst().entryHp);
    }

    @Test
    void resolveFallsBackToTankopediaBaseWithoutObservation() {
        assertEquals(3400, ObservedMaxHp.resolve(null, 29985L));
        assertEquals(3400, ObservedMaxHp.resolve(2000, 29985L)); // max(观测, base)
    }

    @Test
    void preFirstDamageSampleAtOrAboveBaseProvesEntryExact() {
        // 首个 positive 样本 3600（> base 3400，含装备加成）严格早于首次受击 @20s
        // → 受击前满血被证明 → OBSERVED_EXACT，entryHp=3600
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(10f, null), 7,
                DecodeConfidence.EXACT, 10, 3600, null, true));
        events.add(new DamageEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 10, null, null, 400, false));
        final Battle battle = battle();
        ObservedMaxHp.populate(battle, events,
                TeamEntityMapper.resolve(battle, recon(events)));
        final PlayerResult p = battle.players.getFirst();
        assertEquals(EntryHpSource.OBSERVED_EXACT, p.entryHpSource);
        assertEquals(3600, p.entryHp);
    }

    @Test
    void sampleBelowBaseBeforeFirstDamageIsNotProvenEntry() {
        // 首个样本 3000 < base 3400（已掉血）且早于首次受击 → 不得证明为进场满血
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(5f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(10f, null), 7,
                DecodeConfidence.EXACT, 10, 3000, null, true));
        events.add(new DamageEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 10, null, null, 400, false));
        final Battle battle = battle();
        ObservedMaxHp.populate(battle, events,
                TeamEntityMapper.resolve(battle, recon(events)));
        assertEquals(EntryHpSource.BASE_FALLBACK, battle.players.getFirst().entryHpSource);
        assertNull(battle.players.getFirst().entryHp);
    }
}
