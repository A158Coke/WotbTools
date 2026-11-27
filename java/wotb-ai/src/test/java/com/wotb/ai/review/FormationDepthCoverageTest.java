package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.PositionKnowledge;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.MAP;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.battle;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.midBlock;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.player;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.pos;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.reconWithPositions;

class FormationDepthCoverageTest {

    @Test
    void regionCoverageEmitsPresenceCountsNotControlTags() {
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ownPositionPresence="), "必须输出本方位置存在数");
        assertTrue(section.contains("enemyPositionPresence="), "必须输出敌方位置存在数");
        assertFalse(section.contains("(presence)"), "不得输出 (presence) 控制权标签");
        assertFalse(section.contains("(firepower)"), "不得输出 (firepower) 控制权标签");
    }

    @Test
    void regionCoverageStillEmittedWhenAllBacklineType() {
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9297L),
                player(1002L, 1, "AllyB", 9297L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), "无重甲阵容仍输出区域覆盖测量");
        assertFalse(section.contains("noArmorNote"), "不得输出控制权依赖注释");
    }

    @Test
    void controlRegionsContestedWhenSymmetric() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -100f, 0f));
        events.add(pos(12, 40f, 11, -95f, 0f));
        events.add(pos(20, 40f, 20, -105f, 5f));
        events.add(pos(21, 40f, 21, -90f, 5f));
        events.add(pos(22, 120f, 20, -105f, 5f));
        events.add(pos(23, 120f, 21, -90f, 5f));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),
                player(1002L, 1, "AllyB", 9489L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ratio="), "对称火力应输出 ratio 测量，got: " + section);
        assertFalse(section.contains("contested"), "不得输出 contested 权威标签，got: " + section);
    }

    @Test
    void postDeathPositionsExcludedFromControlFireCoverage() {
        final Battle battle = battle();
        battle.durationS = 100d;
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1001L) {
                pl.survived = false;
                pl.deathTimeMillis = 10_000L;
                pl.settlementLifeTimeSec = 10;
            }
        }
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -100f, 0f));
        events.add(pos(11, 40f, 11, -200f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertFalse(section.contains("account:1001"), "阵亡车辆不得进入阵型/覆盖测量, got: " + section);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
    }

    @Test
    void carriedFriendlyCountsInRegionPresence() {
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 30f, 10, -100f, 0f));
        events.add(pos(11, 30f, 11, 100f, -200f));
        events.add(pos(12, 28f, 20, 200f, 0f));
        events.add(pos(13, 28f, 21, 230f, 50f));
        events.add(pos(14, 44f, 20, 200f, 0f));
        events.add(pos(15, 44f, 21, 230f, 50f));
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        final String mid = midBlock(section);
        assertTrue(mid.contains("REGION_COVERAGE_MEASUREMENTS"), mid);
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"), mid);
        int ownPresenceTotal = 0;
        for (final String line : mid.split("\n")) {
            if (!line.contains("ownPositionPresence=")) {
                continue;
            }
            final int idx = line.indexOf("ownPositionPresence=") + "ownPositionPresence=".length();
            final int space = line.indexOf(' ', idx);
            final int value = Integer.parseInt(line.substring(idx, space > 0 ? space : line.length()));
            assertTrue(value <= 1, "presence 每区最多按 1 辆计，got " + value + ": " + line);
            ownPresenceTotal += value;
        }
        assertTrue(ownPresenceTotal == 2, "己方 2 辆（含 carry-forward）presence 合计 2，got: " + ownPresenceTotal);
    }

    @Test
    void regionPresenceCountsVehiclesNotPositionPackets() {
        final Battle battle = battle();
        battle.durationS = 60d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        int seq = 10;
        for (int i = 0; i < 100; i++) {
            events.add(pos(seq++, 40f + i * 0.1f, 10, -100f, 0f));
        }
        events.add(pos(seq++, 40f, 11, 100f, -200f));
        events.add(pos(seq++, 40f, 20, 200f, 0f));
        events.add(pos(seq++, 40f, 21, 230f, 50f));
        events.add(pos(seq++, 80f, 20, 200f, 0f));
        events.add(pos(seq++, 80f, 21, 230f, 50f));
        events.add(new com.wotb.core.replay.event.DamageEvent(seq, new ReplayTimestamp(30f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("ownPositionPresence="), section);
        for (final String line : section.split("\n")) {
            if (!line.contains("coverageCompleteness=ownRef=2/2") || !line.contains("ownPositionPresence=")) {
                continue;
            }
            final int idx = line.indexOf("ownPositionPresence=") + "ownPositionPresence=".length();
            final int space = line.indexOf(' ', idx);
            final int value = Integer.parseInt(line.substring(idx, space > 0 ? space : line.length()));
            assertTrue(value <= 1,
                    "presence 必须按车辆计 1（100 个包仍是 1 辆，不得膨胀到 100），got: " + line);
        }
    }

    @Test
    void spectatorDoesNotAffectCoverage() {
        final Battle battle = battle();
        battle.durationS = 100d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(new ParticipantMappingEvent(5, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 50, 9999L));
        events.add(pos(20, 40f, 10, -100f, 0f));
        events.add(pos(21, 40f, 11, -200f, 0f));
        events.add(pos(22, 40f, 20, 200f, 0f));
        events.add(pos(23, 40f, 21, 230f, 50f));
        events.add(pos(24, 120f, 20, 210f, 0f));
        events.add(pos(25, 120f, 21, 235f, 50f));
        for (int i = 0; i < 50; i++) {
            events.add(pos(30 + i, 40f + i * 0.5f, 50, 0f, 0f));
        }
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"),
                "spectator 不得影响 coverage completeness: " + section);
        assertFalse(section.contains("account:9999"), "spectator 账号不得进入阵型/覆盖测量: " + section);
    }

}
