package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayStreamHeader;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityCreatedEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Timeline 测试共享 fixture（battle-relative 时间 = raw - START_RAW）。 */
final class TimelineTestFixtures {

    static final float START_RAW = 100f;
    static final long RECORDER_ACCOUNT = 1001L;
    static final long FRIENDLY_ACCOUNT = 1002L;
    static final long ENEMY_ACCOUNT = 2001L;
    static final long ENEMY2_ACCOUNT = 2002L;
    static final int RECORDER_EID = 1;
    static final int FRIENDLY_EID = 2;
    static final int ENEMY_EID = 3;
    static final int ENEMY2_EID = 4;

    private TimelineTestFixtures() {
    }

    static int seq = 0;

    static ReplayTimestamp ts(final double battleSec) {
        return new ReplayTimestamp((float) (START_RAW + battleSec), null);
    }

    static PlayerResult player(final long accountId, final int team, final long tankId,
                               final String tankName, final boolean survived) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.tankName = tankName;
        p.survived = survived;
        p.deathTimeMillis = survived ? 0 : 30_000L;
        p.survivalTimeSec = survived ? 60.0 : 30.0;
        if (!survived) {
            p.settlementLifeTimeSec = 30.0;
        }
        return p;
    }

    static Battle battle(final double durationSec) {
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = durationSec;
        b.players = List.of(
                player(RECORDER_ACCOUNT, 1, 6225, "FV215b", false),
                player(FRIENDLY_ACCOUNT, 1, 7297, "60TP", true),
                player(ENEMY_ACCOUNT, 2, 6251, "E 75", true),
                player(ENEMY2_ACCOUNT, 2, 6225, "FV215b", true));
        return b;
    }

    static ParticipantMappingEvent mapping(final int eid, final long accountId) {
        return new ParticipantMappingEvent(seq++, ts(0), 8, DecodeConfidence.EXACT, eid, accountId);
    }

    static EntityCreatedEvent created(final int eid, final double battleSec) {
        return new EntityCreatedEvent(seq++, ts(battleSec), 0, DecodeConfidence.EXACT,
                eid, new byte[0]);
    }

    static PositionChangedEvent position(final int eid, final double battleSec,
                                         final float x, final float z, final float yawRad) {
        return new PositionChangedEvent(seq++, ts(battleSec), 10, DecodeConfidence.EXACT,
                eid, 0, 0, x, 0f, z, 0f, 0f, 0f, yawRad, 0f, 0f, 0);
    }

    static HealthChangedEvent health(final int eid, final double battleSec,
                                     final Integer currentHp, final Boolean alive) {
        return new HealthChangedEvent(seq++, ts(battleSec), 7, DecodeConfidence.EXACT,
                eid, currentHp, null, alive);
    }

    static TurretDirectionChangedEvent turret(final int eid, final double battleSec,
                                              final double relYawDeg) {
        return new TurretDirectionChangedEvent(seq++, ts(battleSec), 7, DecodeConfidence.EXACT,
                eid, relYawDeg);
    }

    static DamageEvent damage(final int attackerEid, final int victimEid,
                              final double battleSec, final int amount) {
        return new DamageEvent(seq++, ts(battleSec), 8, DecodeConfidence.EXACT,
                attackerEid, victimEid, null, null, amount, false);
    }

    static RoundFinishedEvent battleEnded(final double battleSec) {
        return new RoundFinishedEvent(seq++, ts(battleSec), 14, DecodeConfidence.EXACT, 1, 1, RoundFinishedEvent.FinishCause.ELIMINATION);
    }

    static ReplayReconstruction recon(final double durationSec, final List<ReplayEvent> events) {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 1, "rec1", "", durationSec, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(1, 1, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final BattleStateSnapshot finalState = BattleStateSnapshot.empty();
        return new ReplayReconstruction(
                meta, header, (float) durationSec, START_RAW, List.of(),
                List.copyOf(events), List.of(), finalState, coverage, diag);
    }

    /** 标准个人复盘场景：双方各 2 车、录像者/友方位置流 + 敌方位置流 + HP + 伤害。 */
    static List<ReplayEvent> standardEvents() {
        seq = 0;
        final List<ReplayEvent> out = new ArrayList<>();
        out.add(mapping(RECORDER_EID, RECORDER_ACCOUNT));
        out.add(mapping(FRIENDLY_EID, FRIENDLY_ACCOUNT));
        out.add(mapping(ENEMY_EID, ENEMY_ACCOUNT));
        out.add(mapping(ENEMY2_EID, ENEMY2_ACCOUNT));
        out.add(created(RECORDER_EID, 0));
        out.add(created(FRIENDLY_EID, 0));
        out.add(created(ENEMY_EID, 0));
        out.add(created(ENEMY2_EID, 0));
        out.add(position(RECORDER_EID, 0, 10f, 10f, 0f));
        out.add(position(FRIENDLY_EID, 0, 20f, 20f, 0f));
        out.add(position(ENEMY_EID, 0, -10f, -10f, 0f));
        out.add(position(ENEMY2_EID, 0, -20f, -20f, 0f));
        out.add(health(RECORDER_EID, 0, 2000, true));
        out.add(health(FRIENDLY_EID, 0, 1800, true));
        out.add(health(ENEMY_EID, 0, 1500, true));
        out.add(health(ENEMY2_EID, 0, 1500, true));
        return out;
    }

    static TimelinePerspective personalPerspective() {
        return TimelinePerspective.personal(RECORDER_ACCOUNT, 1);
    }
}
