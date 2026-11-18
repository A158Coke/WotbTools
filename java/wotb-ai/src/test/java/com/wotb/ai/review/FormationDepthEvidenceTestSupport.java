package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.List;

/** Shared fixtures for deterministic formation-depth evidence tests. */
class FormationDepthEvidenceTestSupport {
    static final String MAP = "holland";

    /** 真实 tankopedia id（tier10）：9489=E 100(HEAVY)、9297=FV215b 183(TD)、385=Progetto 65(MEDIUM)、19537=Vickers Light(LT)。 */
    static PlayerResult player(final long accountId, final int team, final String nickname, final long tankId) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.nickname = nickname;
        p.tankId = tankId;
        p.survived = true;
        return p;
    }


    static PositionChangedEvent pos(final int sequence, final float rawClock,
                                            final int entityId, final float x, final float z) {
        return new PositionChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0, x, 0f, z,
                0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    /** 双方 4 车，各自集中在不同区域；本队 1001 更靠敌方、1002 靠后。 */
    static ReplayReconstruction reconWithPositions(final Float battleStart) {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 本队（靠左，holland 界内）：1001 更靠敌方（前排），1002 靠后
        events.add(pos(10, 40f, 10, -100f, 0f));  // 1001 t=20
        events.add(pos(11, 42f, 10, -90f, 0f));   // 1001 t=22
        events.add(pos(12, 40f, 11, -200f, 0f));  // 1002 t=20
        events.add(pos(13, 42f, 11, -190f, 0f));  // 1002 t=22
        // 敌方（靠右，与本体不同九宫格区域）
        events.add(pos(20, 40f, 20, 200f, 0f));   // 2001 t=20
        events.add(pos(21, 42f, 20, 210f, 0f));   // 2001 t=22
        events.add(pos(22, 40f, 21, 230f, 50f));  // 2002 t=20
        events.add(pos(23, 42f, 21, 235f, 50f));  // 2002 t=22
        // 敌方 phase 末（t=100，opening=[0,100]）保持 CURRENT：敌方位置观测 ≥ 当前阈值内才算 current，
        // 不能只开局有位置（真实连续位置流；enemy stale → LAST_KNOWN → fail-close exact coverage）
        events.add(pos(24, 120f, 20, 210f, 0f));  // 2001 t=100
        events.add(pos(25, 120f, 21, 235f, 50f)); // 2002 t=100
        return new ReplayReconstruction(null, null, 100f, battleStart, List.of(),
                events, List.of(), null, null, null);
    }

    static Battle battle() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, "AllyFront", 9489L),
                player(1002L, 1, "AllyBack", 9297L), // TD：本队 HEAVY+TD → 有前排有后排
                player(2001L, 2, "EnemyA", 9297L),
                player(2002L, 2, "EnemyB", 9297L));
        return battle;
    }

    static String midBlock(final String section) {
        final int mid = section.indexOf("phase=mid");
        final int late = section.indexOf("phase=late");
        return late > mid ? section.substring(mid, late) : section.substring(mid);
    }

}
