package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.evidence.PointsSituationSkill;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PointsSituationEvidence：轨迹采集与点数局势证据段渲染（holland 语义，5 区为占领点）。 */
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
        // 1001（本队）：从非占领点区域（2 区）移动进入 5 区（t=12 进入，t=14 仍在）→ 推进窗口；
        // 注意 holland 占领点区域集合为 {1,4,5,8,9}，接近段必须选在集合外的 2 区
        events.add(pos(3, 40f, 10, -80f, 120f));  // t=10 r2（非占领点区域）
        events.add(pos(4, 42f, 10, -80f, 0f));    // t=12 r5 进入
        events.add(pos(5, 44f, 10, -70f, 0f));    // t=14 r5
        // 2001（对方）：起点已在 5 区并停留 → 只有存在、无推进窗口
        events.add(pos(6, 40f, 20, 0f, 0f));      // t=10 r5
        events.add(pos(7, 42f, 20, 10f, 0f));     // t=12 r5
        return new ReplayReconstruction(null, null, 600f, battleStart, List.of(),
                events, List.of(), null, null, null);
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        final PlayerResult ally = player(1001L, 1, "Ally", false);
        ally.deathTimeMillis = 60_000L; // 60s 阵亡
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
        // 映射可用性（TeamEntityMapper 生产入口一致）
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
    void renderSectionOutputsKillTimelinePresenceAndPushWindows() {
        final String section = PointsSituationEvidence.renderSection(
                battle(), reconWithPositions(30f), 1, true, "本队", "对方");
        assertTrue(section.contains("POINTS_SITUATION"), section);
        assertTrue(section.contains("KILL_POINTS_TIMELINE"), section);
        assertTrue(section.contains("本队车辆被击毁 → 本队 -40 / 对方 +40"), section);
        assertTrue(section.contains("CAPTURE_PRESENCE"), section);
        assertTrue(section.contains("本队 1 车 / 对方 1 车"), section);
        assertTrue(section.contains("PUSH_WINDOWS"), section);
        assertTrue(section.contains("目标 5 区"), section);
        // damagePartial=true → 伤害数字抑制
        assertTrue(section.contains("推进方窗口内承受伤害不可用（OBSERVED_DAMAGE_IS_PARTIAL）"), section);
    }

    @Test
    void renderSectionFallsBackToKillTimelineOnlyWithoutRecon() {
        final String section = PointsSituationEvidence.renderSection(
                battle(), null, 1, true, "本队", "对方");
        assertTrue(section.contains("KILL_POINTS_TIMELINE"), section);
        assertFalse(section.contains("CAPTURE_PRESENCE"), section);
        assertFalse(section.contains("PUSH_WINDOWS"), section);
    }

    @Test
    void renderSectionEmptyForInvalidPerspectiveOrNoData() {
        assertTrue(PointsSituationEvidence.renderSection(
                battle(), null, 3, true, "本队", "对方").isEmpty());
        final Battle battle = battle();
        battle.players = List.of(player(1001L, 1, "Ally", true)); // 无阵亡 → 无击杀时间线
        final Battle empty = new Battle();
        empty.mapName = MAP;
        assertTrue(PointsSituationEvidence.renderSection(
                battle, null, 1, true, "本队", "对方").isEmpty());
        assertTrue(PointsSituationEvidence.renderSection(
                empty, null, 1, true, "本队", "对方").isEmpty());
    }
}
