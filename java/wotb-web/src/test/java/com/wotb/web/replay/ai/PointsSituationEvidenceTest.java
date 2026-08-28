package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
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
        // 1001（本队）：从非占领点区域（2 区）移动进入 5 区（t=12 进入，t=14 仍在）→ 进入窗口；
        // 注意 holland 占领点区域集合为 {1,4,5,8,9}，接近段必须选在集合外的 2 区
        events.add(pos(3, 40f, 10, -80f, 120f));  // t=10 r2（非占领点区域）
        events.add(pos(4, 42f, 10, -80f, 0f));    // t=12 r5 进入
        events.add(pos(5, 44f, 10, -70f, 0f));    // t=14 r5
        // 2001（对方）：起点已在 5 区并停留 → 只有存在、无进入窗口
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
        ally.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
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
        // damagePartial=true → 伤害数字抑制
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
        // 进入窗口车辆 1001（本队）在 5 区进入窗口 [12,14]；构造窗口内外的伤害事件：
        //  - 窗口内 2001（对方）→1001 400：可归属敌方掉血
        //  - 窗口内 attackerEid=999（未映射，环境伤害）→1001 300：来源未知（计入总掉血、不计入敌方）
        //  - 窗口内 1001→1001 自伤 250：来源未知（计入总掉血、不计入敌方）
        //  - 窗口外（t=20）2001→1001 200：不计入（事件时间不在窗口内）
        // PR #107 Blocker 3：总实际掉血 = 400+300+250 = 950；可归属敌方 = 400；
        // 来源未知 = 550（2 笔：未解析 300 + 自伤 250）。
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(3, 40f, 10, -80f, 120f));  // t=10 r2（非占领点区域）
        events.add(pos(4, 42f, 10, -80f, 0f));    // t=12 r5 进入
        events.add(pos(5, 44f, 10, -70f, 0f));    // t=14 r5
        events.add(pos(6, 40f, 20, 0f, 0f));
        events.add(pos(7, 42f, 20, 10f, 0f));
        events.add(dmg(8, 42.5f, 20, 10, 400));   // 窗口内 对方→本队：可归属敌方
        events.add(dmg(9, 43f, 999, 10, 300));    // 攻击者未映射（环境伤害）：来源未知
        events.add(dmg(10, 43.5f, 10, 10, 250));  // 自伤（进入车辆打自己）：来源未知
        events.add(dmg(11, 50f, 20, 10, 200));    // t=20 窗口外：不计入
        // 权威 HP 链（victim eid=10 → 1001，从 2000 逐条递减），使每条 dmg 成为可 attribution 的掉血窗口
        events.add(hp(12, 42.0f, 10, 2000));
        events.add(hp(13, 42.5f, 10, 1600));   // 掉血 400 @12.5（2001→1001）
        events.add(hp(14, 43.0f, 10, 1300));   // 掉血 300 @13（999→1001）
        events.add(hp(15, 43.5f, 10, 1050));   // 掉血 250 @13.5（1001 自伤）
        events.add(hp(16, 49.5f, 10, 1050));
        events.add(hp(17, 50.0f, 10, 850));    // 窗口外（t=20）掉血 200：不计入
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 600f, 30f,
                List.of(), events, List.of(), null, null, null);

        final String section = PointsSituationEvidence.renderSection(
                battle, recon, 1, false, "本队", "对方");

        // 总实际掉血 950（含未知来源 550）；可归属敌方 400
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
        battle.players = List.of(player(1001L, 1, "Ally", true)); // 无阵亡 → 无击杀时间线
        final Battle empty = new Battle();
        empty.mapName = MAP;
        assertTrue(PointsSituationEvidence.renderSection(
                battle, null, 1, true, "本队", "对方").isEmpty());
        assertTrue(PointsSituationEvidence.renderSection(
                empty, null, 1, true, "本队", "对方").isEmpty());
    }
    // ---- PR #107 Blocker 3：总承伤包含无法归属的真实掉血；raw 永不补齐 ----

    @Test
    void tollCountsUnattributedRealHpLossInTotal() {
        // 窗口内只有一条无法归属的掉血（无 DAMAGE 通知，如火灾/撞击）：HP loss 377 已由
        // 连续 Type-7 sample 证明 → 总实际掉血 = 377；可归属敌方 = 0；来源未知 = 377。
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(pos(2, 40f, 10, -80f, 120f));  // t=10 r2（非占领点区域）
        events.add(pos(3, 42f, 10, -80f, 0f));    // t=12 r5 进入
        events.add(pos(4, 44f, 10, -70f, 0f));    // t=14 r5
        // 无 DAMAGE；HP 链显示 2000 @42 -> 1623 @42.5（掉血 377，无通知）
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
        // raw=767、HP loss=377（§12 实测结论）：输出只能使用 377，不得用 raw 补齐
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(3, 40f, 10, -80f, 120f));  // t=10 r2（非占领点区域）
        events.add(pos(4, 42f, 10, -80f, 0f));    // t=12 r5 进入
        events.add(pos(5, 44f, 10, -70f, 0f));    // t=14 r5
        // 窗口内 2001→1001：DAMAGE raw=767，但 HP 链显示 2000->1623（掉血 377）
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
        // 攻击者身份可解析但不在名册（队伍未知）→ 掉血计入总实际掉血、不计入可归属敌方
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 99, 9999L)); // 攻击者不在 battle.players（队伍未知）
        events.add(pos(3, 40f, 10, -80f, 120f));  // t=10 r2（非占领点区域）
        events.add(pos(4, 42f, 10, -80f, 0f));    // t=12 r5 进入
        events.add(pos(5, 44f, 10, -70f, 0f));    // t=14 r5
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
        // 同一 victim 窗口内两次掉血（每次 HP loss 对应唯一 HP sample 对）→ 各计一次，不重复
        final Battle battle = battle();
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(3, 40f, 10, -80f, 120f));  // t=10 r2（非占领点区域）
        events.add(pos(4, 42f, 10, -80f, 0f));    // t=12 r5 进入
        events.add(pos(5, 44f, 10, -70f, 0f));    // t=14 r5
        // 2000 -> 1800 @42.5（200），1800 -> 1400 @43.5（400）→ 总 600
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