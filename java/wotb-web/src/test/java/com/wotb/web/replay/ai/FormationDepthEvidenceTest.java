package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** FormationDepthEvidence：阵型深度（前后排）与控制区域确定性证据段渲染。 */
class FormationDepthEvidenceTest {

    private static final String MAP = "holland";

    private static PlayerResult player(final long accountId, final int team, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.nickname = nickname;
        p.survived = true;
        return p;
    }

    private static PositionChangedEvent pos(final int sequence, final float rawClock,
                                            final int entityId, final float x, final float z) {
        return new PositionChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0, x, 0f, z,
                0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    /** 双方 4 车，各自集中在不同区域；本队 1001 更靠敌方、1002 靠后。 */
    private static ReplayReconstruction reconWithPositions(final Float battleStart) {
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
        return new ReplayReconstruction(null, null, 100f, battleStart, List.of(),
                events, List.of(), null, null, null);
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, "AllyFront"),
                player(1002L, 1, "AllyBack"),
                player(2001L, 2, "EnemyA"),
                player(2002L, 2, "EnemyB"));
        return battle;
    }

    @Test
    void rendersFrontMidBackAndControlledRegions() {
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("=== FORMATION_DEPTH"), section);
        assertTrue(section.contains("phase=opening"), section);
        // 1001 更靠敌方 → 前排；1002 靠后 → 后排（account:<accountId> 与阵型簇一致）
        assertTrue(section.contains("frontLine=account:1001"), section);
        assertTrue(section.contains("backLine=account:1002"), section);
        // 双方驻留不同区域 → own 与 enemy 区域都存在
        assertTrue(section.contains("controlledRegions own=GRID_REGION_"), section);
        assertTrue(section.contains("controlledRegions enemy=GRID_REGION_"), section);
    }

    @Test
    void emptyWithoutReconOrMapping() {
        assertTrue(FormationDepthEvidence.renderSection(battle(), null, 1, MAP).isEmpty());
        final Battle empty = battle();
        empty.players = List.of();
        assertTrue(FormationDepthEvidence.renderSection(empty, reconWithPositions(20f), 1, MAP).isEmpty());
    }

    @Test
    void noFrontLineWithoutEnemyPositionsButOwnControlStillRendered() {
        final ReplayReconstruction recon = reconWithPositions(20f);
        final Battle battle = battle();
        // 仅保留本队实体映射与位置（2001/2002 的 mapping 事件去掉）
        final List<ReplayEvent> filtered = recon.events().stream()
                .filter(e -> !(e instanceof ParticipantMappingEvent m)
                        || (m.entityId() != 20 && m.entityId() != 21))
                .toList();
        final ReplayReconstruction ownOnly = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), new ArrayList<>(filtered), List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, ownOnly, 1, MAP);
        assertFalse(section.contains("frontLine="), "敌方无位置观测时不得输出前后排");
        assertTrue(section.contains("controlledRegions own=GRID_REGION_"), section);
    }
}
