package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamAiPromptBuilderEvidenceTest extends TeamAiPromptBuilderTestSupport {
@Test
    void memberDamageReceivedWindowsRenderClustersAndRespectPartialSuppression() {
        final Battle battle = new Battle();
        battle.arenaId = "windows-arena";
        battle.mapName = "windows_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        final PlayerResult ally = new PlayerResult();
        ally.accountId = 10_001L;
        ally.nickname = "AllyA";
        ally.team = 1;
        ally.survived = true;
        battle.players = List.of(ally);
        final TeamMemberFeatureSet member = new TeamMemberFeatureSet(
                List.of(1), 10_001L, "AllyA", 4481L, "Kranvagn", 1,
                DecodeConfidence.EXACT, 1000, 800, 0, 0, 0,
                true, null, List.of(), List.of(), List.of(), List.of());
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                1, 1000, 800, 0, 0, 0, 1, 0, null, null, null, true);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, List.of(member), aggregate, TeamObservedAggregate.empty(),
                List.of(), List.of(), List.of(), List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
        final ReplayReconstruction recon = DamageWindowFixture.recon(30f,
                new DamageEvent(0, new ReplayTimestamp(35f, null), 8,
                        DecodeConfidence.EXACT, 0, 0, 20_001L, 10_001L, 400, false),
                new DamageEvent(1, new ReplayTimestamp(43f, null), 8,
                        DecodeConfidence.EXACT, 0, 0, 20_001L, 10_001L, 300, false));
        final SingleTeamBattleAnalysisContext context = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle, 1, features,
                new ReplayCoverage(0, 0, 0, 0, 0, 0.0, Map.of()),
                List.of(), recon);

        final String content = TeamAiPromptBuilder.single(context).content();
        assertTrue(content.contains("MEMBER_DAMAGE_RECEIVED_WINDOWS（逐成员掉血窗口·事件流观测）"), content);
        assertTrue(content.contains("AllyA"), content);
        assertTrue(content.contains("[0分05秒-0分13秒]掉血700/2次攻击者1"), content);
        assertFalse(content.contains("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), content);

        // 事件流覆盖不全时抑制数字（与 OBSERVED_EVENT_SUBSET 同口径）
        final SingleTeamBattleAnalysisContext partial = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle, 1, features,
                new ReplayCoverage(0, 0, 0, 0, 0, 0.0, Map.of()),
                List.of("OBSERVED_DAMAGE_IS_PARTIAL"), recon);
        final String partialContent = TeamAiPromptBuilder.single(partial).content();
        assertTrue(partialContent.contains("MEMBER_DAMAGE_RECEIVED_WINDOWS ===\n"
                + "UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), partialContent);
        assertFalse(partialContent.contains("[0分05秒-0分13秒]掉血700"), partialContent);
    }
    @Test
    void movementEvidenceIncludesStartAndEndCoordinates() {
        final SingleTeamBattleAnalysisContext base =
                contextWithNickname("Player");
        final MovementSegment movement = new MovementSegment(
                1f, 2f, MovementType.MOVING,
                new Vector3(10f, 0f, 20f),
                new Vector3(30f, 0f, 40f),
                28.3f, 28.3f, DecodeConfidence.EXACT);
        final TeamMemberFeatureSet member = new TeamMemberFeatureSet(
                List.of(10), 10_001L, "Player", 1L, "Tank", 1,
                DecodeConfidence.EXACT, 1000, 0, 0, 0, 0,
                true, null, List.of(movement), List.of(), List.of(), List.of());
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, List.of(member), base.features().authoritativeAggregate(),
                TeamObservedAggregate.empty(), List.of(), List.of(),
                List.of(), List.of(), TeamFeatureCoverage.empty(),
                List.of(), true);
        final SingleTeamBattleAnalysisContext context =
                new SingleTeamBattleAnalysisContext(
                        base.analysisUnitId(), base.battleId(), base.fileName(),
                        base.battleCategory(), base.battle(), 1, features,
                        base.coverage(), base.limitations(), null);

        final TeamAiPromptBuilder.PromptInput input =
                TeamAiPromptBuilder.single(context);

        assertTrue(input.content().contains("start="));
        assertTrue(input.content().contains("end="));
        assertTrue(input.content().contains("r="), "Prompts must have region");
        assertTrue(input.content().contains("s=VALID"), "Prompts must have coordinate status");
    }
    @Test
    void singlePromptContainsFormationSection() {
        final var input = TeamAiPromptBuilder.single(contextWithMembers(5, 3));
        assertTrue(input.content().contains("FORMATION_PHASES"),
                "Prompt must contain formation section");
    }
    @Test
    void singlePromptContainsBattlePhases() {
        final var input = TeamAiPromptBuilder.single(contextWithMembers(1, 1));
        assertTrue(input.content().contains("BATTLE_PHASES"),
                "Prompt must contain battle phases section");
    }
    @Test
    void observedDamageNumbersSuppressedWhenPartial() {
        final SingleTeamBattleAnalysisContext base = contextWithMembers(1, 1);
        final TeamObservedAggregate observed = new TeamObservedAggregate(
                18443, 11517, 70, 0);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                base.features().perspectiveTeam(),
                base.features().members(),
                base.features().authoritativeAggregate(),
                observed,
                base.features().formationPhases(),
                base.features().engagements(),
                base.features().battlePhases(),
                base.features().keyEvents(),
                base.features().coverage(),
                List.of("OBSERVED_DAMAGE_IS_PARTIAL"),
                true);
        final SingleTeamBattleAnalysisContext context = new SingleTeamBattleAnalysisContext(
                base.analysisUnitId(), base.battleId(), base.fileName(),
                base.battleCategory(), base.battle(), 1, features,
                base.coverage(), base.limitations(), null);

        final String content = TeamAiPromptBuilder.single(context).content();

        assertTrue(content.contains("OBSERVED_EVENT_SUBSET_NOT_AUTHORITATIVE"),
                "section header must remain");
        assertTrue(content.contains("numbersSuppressed=true"),
                "suppression flag must be present when OBSERVED_DAMAGE_IS_PARTIAL");
        assertFalse(content.contains("damageDealtSubset=18443"),
                "partial observed damage number must NOT leak into prompt: " + content);
        assertFalse(content.contains("damageReceivedSubset=11517"),
                "partial observed received number must NOT leak into prompt: " + content);
        assertTrue(content.contains("AUTHORITATIVE_TEAM_RESULT"),
                "authoritative single-source directive must remain");
    }
    @Test
    void deathTimelineUnknownDeathTimeRendersUnknownNotZeroClock() {
        final PlayerResult allyKnown = new PlayerResult();
        allyKnown.accountId = 10_001L;
        allyKnown.nickname = "AllyKnown";
        allyKnown.team = 1;
        allyKnown.tankId = 4481L;
        allyKnown.damageDealt = 1_000;
        allyKnown.survived = false;
        allyKnown.deathTimeMillis = 62_000L;
        allyKnown.survivalTimeSec = 62.0;
        allyKnown.settlementLifeTimeSec = 62;
        final PlayerResult allyUnknown = new PlayerResult();
        allyUnknown.accountId = 10_002L;
        allyUnknown.nickname = "AllyUnknown";
        allyUnknown.team = 1;
        allyUnknown.tankId = 4481L;
        allyUnknown.damageDealt = 1_000;
        allyUnknown.survived = false;
        allyUnknown.deathTimeMillis = 0L;
        allyUnknown.survivalTimeSec = 0.0;
        final PlayerResult enemy = new PlayerResult();
        enemy.accountId = 20_001L;
        enemy.nickname = "Enemy";
        enemy.team = 2;
        enemy.tankId = 4481L;
        enemy.damageDealt = 1_000;
        enemy.survived = true;

        final Battle battle = new Battle();
        battle.arenaId = "arena-death";
        battle.arenaBonusType = 2;
        battle.mapName = "test-map";
        battle.durationS = 180.0;
        battle.winnerTeam = 1;
        battle.recorder = "AllyKnown";
        battle.players = List.of(allyKnown, allyUnknown, enemy);
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhasesWithSurvival(
                50f, 180f,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle, 1));
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, List.of(), null, TeamObservedAggregate.empty(),
                List.of(), List.of(), phases, List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
        final SingleTeamBattleAnalysisContext context = new SingleTeamBattleAnalysisContext(
                "unit-death", null, "death.wotbreplay", null, battle, 1, features,
                null, List.of(), null);
        final String content = TeamAiPromptBuilder.single(context).content();

        assertFalse(content.contains("SOURCE="), "death precision provenance is not a business model");
        assertTrue(content.contains("1分02秒 本队 \"AllyKnown\""),
                "known death time must keep X分XX秒: " + content);
        assertTrue(content.contains("未知 本队 \"AllyUnknown\""),
                "unknown death time must render as 未知: " + content);
        assertTrue(content.contains("阵亡（时刻未知）"),
                "unknown death time must be marked: " + content);
        assertFalse(content.contains("阵亡@0分00秒"),
                "unknown death time must NOT render as 阵亡@0分00秒: " + content);
        assertFalse(content.contains("0分00秒 本队"),
                "unknown death time must NOT render as 0分00秒 本队: " + content);
        assertFalse(content.contains("0分00秒 对方"),
                "unknown death time must NOT render as 0分00秒 对方: " + content);
        assertTrue(content.indexOf("1分02秒 本队 \"AllyKnown\"")
                        < content.indexOf("未知 本队 \"AllyUnknown\""),
                "unknown death time must be sorted after known: " + content);
    }
    @Test
    void singlePromptContainsKeyEvents() {
        final var input = TeamAiPromptBuilder.single(contextWithMembers(1, 1));
        assertTrue(input.content().contains("KEY_EVENTS"),
                "Prompt must contain key events");
    }
    @Test
    void formationCanonicalCentroidIsNotReMappedAndCarriesRegion() {
        // Canonical centroid (250,250) must render as-is with region 5 — never resolved again
        // as if it were a raw replay coordinate (which would move it to ~312.5).
        final SingleTeamBattleAnalysisContext base = contextWithNickname("Player");
        final TeamFormationPhase phase = new TeamFormationPhase(
                0f, 15f, new CanonicalMapPosition(250f, 250f), 0f, 1,
                DecodeConfidence.EXACT, List.of());
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, base.features().members(), base.features().authoritativeAggregate(),
                TeamObservedAggregate.empty(), List.of(phase), List.of(),
                List.of(), List.of(), TeamFeatureCoverage.empty(), List.of(), true);
        final SingleTeamBattleAnalysisContext context =
                new SingleTeamBattleAnalysisContext(
                        base.analysisUnitId(), base.battleId(), base.fileName(),
                        base.battleCategory(), base.battle(), 1, features,
                        base.coverage(), base.limitations(), null);

        final TeamAiPromptBuilder.PromptInput input =
                TeamAiPromptBuilder.single(context);

        assertTrue(input.content().contains("(250.0,250.0)"),
                "Canonical centroid must render verbatim without double conversion");
        assertFalse(input.content().contains("(312.5"),
                "Centroid must not be double-converted as if raw");
    }
    @Test
    void teamEngagementsSuppressedWhenPartialButPresentWhenComplete() {
        final Battle battle = new Battle();
        battle.arenaId = "team-eng-arena";
        battle.mapName = "team_eng_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        final PlayerResult ally = new PlayerResult();
        ally.accountId = 10_001L;
        ally.nickname = "AllyA";
        ally.team = 1;
        ally.survived = true;
        battle.players = List.of(ally);
        final TeamEngagementSummary engagement = new TeamEngagementSummary(
                10f, 20f, List.of(10_001L), List.of(20_001L),
                1200, 800, List.of(20_001L), 3,
                DecodeConfidence.EXACT);
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                1, 1000, 800, 0, 0, 0, 1, 0, null, null, null, true);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, List.of(), aggregate, TeamObservedAggregate.empty(),
                List.of(), List.of(engagement), List.of(), List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
        final ReplayCoverage coverage = new ReplayCoverage(0, 0, 0, 0, 0, 0.0, Map.of());

        // partial：TEAM_ENGAGEMENTS 不得输出 dealtSubset/receivedSubset 等事件流伤害数字
        final SingleTeamBattleAnalysisContext partial = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle, 1, features,
                coverage, List.of("OBSERVED_DAMAGE_IS_PARTIAL"), null);
        final String partialContent = TeamAiPromptBuilder.single(partial).content();
        assertTrue(partialContent.contains("TEAM_ENGAGEMENTS_OBSERVED_SUBSET ===\n"
                + "UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), partialContent);
        assertFalse(partialContent.contains("dealtSubset="), partialContent);
        assertFalse(partialContent.contains("receivedSubset="), partialContent);
        assertFalse(partialContent.contains("damageDealtSubset="), partialContent);
        assertFalse(partialContent.contains("damageReceivedSubset="), partialContent);

        // complete coverage：Team Engagement 明细正常输出
        final SingleTeamBattleAnalysisContext complete = new SingleTeamBattleAnalysisContext(
                "unit-A", null, "f.wotbreplay", null, battle, 1, features,
                coverage, List.of(), null);
        final String completeContent = TeamAiPromptBuilder.single(complete).content();
        assertTrue(completeContent.contains("dealtSubset=1200"), completeContent);
        assertTrue(completeContent.contains("receivedSubset=800"), completeContent);
    }
}
