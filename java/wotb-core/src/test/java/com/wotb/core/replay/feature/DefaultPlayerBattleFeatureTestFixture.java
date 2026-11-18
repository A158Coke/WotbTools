package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.List;
import java.util.Map;

abstract class DefaultPlayerBattleFeatureTestFixture {
    protected static final float BATTLE_START_RAW = 10f;

    protected static ReplayTimestamp ts(final float rawSec) {
        return new ReplayTimestamp(rawSec, null);
    }

    protected static PositionChangedEvent position(final int seq, final float time, final int eid,
                                                  final float x, final float z) {
        return new PositionChangedEvent(seq, ts(time), 10, DecodeConfidence.EXACT, eid, 0, 0,
                x, 0, z, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    protected static DamageEvent damage(final int seq, final float time, final int att, final int vic, final int dmg) {
        return new DamageEvent(seq, ts(time), 8, DecodeConfidence.EXACT, att, vic, null, null, dmg, false);
    }

    /** Type-7 propId=3 当前血量（EXACT；掉血推导的数据源）。 */
    protected static HealthChangedEvent health(final int seq, final float time, final int eid, final int hp) {
        return new HealthChangedEvent(seq, ts(time), 7, DecodeConfidence.EXACT, eid, hp, null, true);
    }
    /** dual-clock 血量样本。 */
    protected static HealthChangedEvent health(final int seq, final float raw, final Float battle, final int eid, final int hp) {
        return new HealthChangedEvent(seq, ts(raw, battle), 7, DecodeConfidence.EXACT, eid, hp, null, true);
    }

    protected static RoundFinishedEvent battleEnd(final int seq, final float time) {
        return new RoundFinishedEvent(seq, ts(time), 14, DecodeConfidence.EXACT, 1, 1, RoundFinishedEvent.FinishCause.ELIMINATION);
    }

    protected static ParticipantMappingEvent mapping(final int seq, final int eid, final long aid) {
        return new ParticipantMappingEvent(seq, ts(seq), 8, DecodeConfidence.EXACT, eid, aid);
    }

    protected static ReplayReconstruction recon(final Float battleStartRaw, final List<ReplayEvent> events) {
        final ReplayCoverage coverage = new ReplayCoverage(events.size(), events.size(), 0, 0, 0, 1.0, Map.of());
        return new ReplayReconstruction(null, null, 120f, battleStartRaw,
                List.of(
                        new com.wotb.core.replay.reconstruction.BattleParticipant(1001L, "Recorder", 1, 1, "T-34", true),
                        new com.wotb.core.replay.reconstruction.BattleParticipant(2001L, "Enemy", 2, 2, "T-49", false)),
                List.copyOf(events), List.of(), null, coverage, null);
    }

    protected static RecorderEntityMapping recorderMapping() {
        return new RecorderEntityMapping(1001L, 1, 1, "Recorder", 1, 1, DecodeConfidence.EXACT);
    }

        // ===== Dual-clock timestamp helpers =====

    protected static ReplayTimestamp ts(final float rawSec, final Float battleSec) {
        return new ReplayTimestamp(rawSec, battleSec);
    }

    protected static PositionChangedEvent position(final int seq, final float raw, final Float battle,
                                                  final int eid, final float x, final float z) {
        return new PositionChangedEvent(seq, ts(raw, battle), 10, DecodeConfidence.EXACT, eid, 0, 0,
                x, 0, z, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    protected static DamageEvent damage(final int seq, final float raw, final Float battle,
                                       final int att, final int vic, final int dmg) {
        return new DamageEvent(seq, ts(raw, battle), 8, DecodeConfidence.EXACT, att, vic, null, null, dmg, false);
    }


}
