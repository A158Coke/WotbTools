package com.wotb.web.replay.ai;

import com.wotb.web.replay.ai.eval.AiEvalFixtures;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.evidence.EvidenceType;
import com.wotb.core.replay.evidence.TeamSeparationEvidenceSkill;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.map.MapTacticalSemantics;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Backend Evidence Boundary（PR #103 架构收口）生产链路回归测试 R1–R8。
 * <p>核心原则：Backend Evidence 只表示 observed facts / deterministic derived measurements /
 * neutral structural classifications；不输出 player intent、tactical correctness、tactical
 * benefit、tactical blame 或 recommendation——战术解释全部由 LLM 完成。</p>
 */
class BackendEvidenceBoundaryTest {

    // R1 — Team separation 满足旧 SOLO_DELAY 条件时只输出中性证据
    @Test
    void r1TeamSeparationDoesNotEmitTacticalVerdictForDelayPattern() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-delay-hold-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        assertFalse(evidence.isEmpty(), "separation window must be emitted");
        for (final AiEvidence e : evidence) {
            assertEquals(EvidenceType.SPATIAL_SEPARATION, e.type());
            assertEquals("SEPARATION_WINDOW", e.labels().get("kind"), e.summary());
            // 旧战术 verdict 词汇必须消失
            assertFalse(e.summary().contains("SOLO_DELAY"), e.summary());
            assertFalse(e.summary().contains("单走拖延"), e.summary());
            assertFalse(e.summary().contains("队友获利"), e.summary());
            assertFalse(e.summary().contains("卡点"), e.summary());
            assertFalse(e.summary().contains("守点"), e.summary());
            assertFalse(e.numbers().containsKey("teammateBenefit"));
            assertFalse(e.labels().containsKey("intent"));
            // 事实必须存在
            assertTrue(e.numbers().containsKey("distanceM"));
            assertTrue(e.numbers().containsKey("stationaryRatio"));
            assertTrue(e.numbers().containsKey("observedEnemyNearby"));
            assertTrue(e.numbers().containsKey("damageReceivedDuringSpan"));
        }
    }

    // R2 — 旧 SOLO_DETACHED 条件：只输出中性证据 + 事实
    @Test
    void r2TeamSeparationDoesNotEmitTacticalVerdictForDetachPattern() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-detach-push-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        assertFalse(evidence.isEmpty(), "separation window must be emitted");
        for (final AiEvidence e : evidence) {
            assertEquals("SEPARATION_WINDOW", e.labels().get("kind"), e.summary());
            assertFalse(e.summary().contains("SOLO_DETACHED"), e.summary());
            assertFalse(e.summary().contains("单走脱节"), e.summary());
            assertFalse(e.summary().contains("无掩护"), e.summary());
            assertTrue(e.numbers().containsKey("distanceM"));
            assertTrue(e.numbers().containsKey("distanceGrowthM"));
            assertTrue(e.numbers().containsKey("stationaryRatio"));
            assertTrue(e.numbers().containsKey("damageReceivedDuringSpan"));
            assertTrue(e.numbers().containsKey("deathDuringSpan"));
        }
    }

    // R3 — OPENING_SPREAD 仍允许，但 summary 只描述空间结构
    @Test
    void r3OpeningSpreadSummaryDescribesOnlySpatialStructure() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-opening-mapcontrol-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        assertFalse(evidence.isEmpty());
        for (final AiEvidence e : evidence) {
            if (!"OPENING_SPREAD".equals(e.labels().get("kind"))) {
                continue;
            }
            assertFalse(e.summary().contains("图控"), e.summary());
            assertFalse(e.summary().contains("拿视野"), e.summary());
            assertFalse(e.summary().contains("侦察收益"), e.summary());
            assertFalse(e.summary().contains("地图信息收益"), e.summary());
            assertTrue(e.summary().contains("空间") || e.summary().contains("开局分散"), e.summary());
        }
    }

    // R4 — partial coverage：数字 UNKNOWN/省略，不通过「没有观察到 → false → verdict」
    @Test
    void r4PartialCoverageNeverLeadsToTacticalVerdict() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-partial-observation-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        for (final AiEvidence e : evidence) {
            assertFalse(e.summary().contains("拖延") || e.summary().contains("脱节"), e.summary());
            // movementState=UNKNOWN 表示覆盖不足，不得当 MOVING 下结论
            if ("UNKNOWN".equals(e.labels().get("movementState"))) {
                assertFalse(e.summary().contains("MOVING"), e.summary());
            }
        }
    }

    // R5 — Team production integration：Skill → TeamEvidenceFormatter → TeamAiPromptBuilder
    @Test
    void r5TeamProductionPromptHasFactsButNoBackendVerdict() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-delay-hold-01");
        final String user = TeamAiPromptBuilder.single(ctx, List.of(), null, null, Integer.MAX_VALUE).content();
        assertTrue(user.contains("SPATIAL_SEPARATION_EVIDENCE"), "必须渲染空间分离证据段");
        assertTrue(user.contains("kind=SEPARATION_WINDOW"), "必须输出中性结构分类: " + user);
        assertTrue(user.contains("distanceM="), "必须包含距离事实");
        assertTrue(user.contains("stationaryRatio="), "必须包含静止占比事实");
        assertFalse(user.contains("SOLO_DELAY"), "production prompt 不得包含 SOLO_DELAY: " + user);
        assertFalse(user.contains("SOLO_DETACHED"), "production prompt 不得包含 SOLO_DETACHED");
        assertFalse(user.contains("单走拖延"), "production prompt 不得包含单走拖延");
        assertFalse(user.contains("单走脱节"), "production prompt 不得包含单走脱节");
        assertFalse(user.contains("teammateBenefit"), "production prompt 不得包含 teammateBenefit");
        assertFalse(user.contains("intent="), "production prompt 不得包含 intent= 标签");
    }

    // R6 — Player production integration：Skill → TacticalReviewPromptBuilder
    @Test
    void r6PlayerProductionPromptHasFactsButNoBackendVerdict() {
        final AiEvalFixtures.PlayerFixture fixture =
                AiEvalFixtures.playerFixture("player-delay-hold-01");
        final EvidenceSkillResult evidence = new EvidenceSkillEngine().run(
                new EvidenceSkillContext(fixture.battle(), fixture.recon(),
                        fixture.features(), fixture.recorder()));
        final TacticalReviewPromptBuilder.PreparedHarnessPrompt prepared =
                TacticalReviewPromptBuilder.prepare(
                        null, evidence, fixture.battle(), fixture.recon(), fixture.features(),
                        fixture.recorder(), new ConservativeDeepSeekTokenEstimator(),
                        1_000_000, 1_000_000, 32_768, 0);
        final String user = prepared.userContent();
        assertTrue(user.contains("SPATIAL_SEPARATION"), "player 必须渲染空间分离证据: " + user);
        assertFalse(user.contains("单走拖延"), "player prompt 不得包含单走拖延: " + user);
        assertFalse(user.contains("单走脱节"), "player prompt 不得包含单走脱节: " + user);
        assertFalse(user.contains("无掩护"), "player prompt 不得包含无掩护: " + user);
        assertFalse(user.contains("SOLO_DELAY"), "player prompt 不得包含 SOLO_DELAY");
        assertFalse(user.contains("SOLO_DETACHED"), "player prompt 不得包含 SOLO_DETACHED");
    }

    // R7 — Prompt contract：Backend evidence != tactical verdict；LLM 拥有解释权
    @Test
    void r7PromptContractSaysBackendEvidenceIsNotTacticalVerdict() {
        final String zh = AiPromptLibrary.zh("team/single");
        assertTrue(zh.contains("不是战术 verdict"), "prompt 必须声明 Backend Evidence 不是战术 verdict");
        assertTrue(zh.contains("是你（LLM）的职责"), "prompt 必须声明战术判断是 LLM 的职责");
        assertTrue(zh.contains("supported tactical inference"), "prompt 必须要求 LLM 得出 supported tactical inference");
        assertTrue(zh.contains("SPATIAL_SEPARATION_EVIDENCE"), "prompt 必须引用 SPATIAL_SEPARATION_EVIDENCE");
        assertFalse(zh.contains("SOLO_DELAY"), "prompt 不得再引用 SOLO_DELAY 候选");
        assertFalse(zh.contains("SOLO_DETACHED"), "prompt 不得再引用 SOLO_DETACHED 候选");
        // EN/RU 同步
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(zh, AllowedLanguage.EN);
        assertTrue(en.contains("NOT tactical verdicts"), "EN 必须声明不是战术 verdict");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(zh, AllowedLanguage.RU);
        assertTrue(ru.contains("а НЕ тактические вердикты"), "RU 必须声明不是战术 verdict");
    }

    // R8 — Golden 3:1 由 TeamReviewRealReplayProbeTest（wotb-core）负责硬断言：
    // 109–128s / 3:1 / 7v7→4v6 / collapse core；样本存在时断言，样本缺失时自动跳过。
    // 此处不保留 fake test（assertTrue(true) 已于 PR #103 第三轮删除）。

    // R9 — BehindLine production 不再输出吸血/避战/利用队友等战术 verdict
    @Test
    void r9BehindLineProductionEmitsOnlyMeasurements() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-delay-hold-01");
        final String user = TeamAiPromptBuilder.single(ctx, List.of(), null, null, Integer.MAX_VALUE).content();
        if (user.contains("BEHIND_LINE_HP_ADVANTAGE")) {
            assertFalse(user.contains("吸血"), "BehindLine 不得输出吸血: " + user);
            assertFalse(user.contains("避战"), "BehindLine 不得输出避战: " + user);
            assertFalse(user.contains("利用队友输出"), "BehindLine 不得输出利用队友输出");
            assertFalse(user.contains("利用队友扛伤"), "BehindLine 不得输出利用队友扛伤");
            assertFalse(user.contains("前线型车辆未上前线"), "BehindLine 不得输出前线型未上前线");
            assertFalse(user.contains("degree="), "BehindLine 不得输出 tactical degree");
        }
    }

    // R10 — Formation production 不输出权威 map-control verdict
    @Test
    void r10FormationOutputHasCoverageMeasurementsButNoControlVerdict() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-opening-mapcontrol-01");
        final String user = TeamAiPromptBuilder.single(ctx, List.of(), null, null, Integer.MAX_VALUE).content();
        assertFalse(user.contains("controlRegions own="), "不得输出 controlRegions own 权威标签");
        assertFalse(user.contains("controlRegions contested="), "不得输出 controlRegions contested 权威标签");
        assertFalse(user.contains("controlRegions enemy="), "不得输出 controlRegions enemy 权威标签");
        if (user.contains("REGION_COVERAGE_MEASUREMENTS")) {
            assertTrue(user.contains("ownPositionPresence="), "必须输出位置存在测量");
            assertTrue(user.contains("ownWeightedCoverageScore="), "必须输出加权覆盖分数");
            assertTrue(user.contains("coverageCompleteness="), "必须输出覆盖完整性");
        }
    }

    // R11 — Team/Player Prompt 无 PUSH_WINDOWS，统一 CONTROL_REGION_ENTRY_WINDOWS
    @Test
    void r11PromptsUseControlRegionEntryWindowsNotPushWindows() {
        final String team = AiPromptLibrary.zh("team/single");
        assertFalse(team.contains("PUSH_WINDOWS"), "team prompt 不得含 PUSH_WINDOWS");
        assertTrue(team.contains("CONTROL_REGION_ENTRY_WINDOWS"), "team prompt 必须统一 CONTROL_REGION_ENTRY_WINDOWS");
        final String player = AiPromptLibrary.zh("player/tactical");
        assertFalse(player.contains("PUSH_WINDOWS"), "player prompt 不得含 PUSH_WINDOWS");
        assertTrue(player.contains("CONTROL_REGION_ENTRY_WINDOWS"), "player prompt 必须统一 CONTROL_REGION_ENTRY_WINDOWS");
        // EN/RU 同步（本地化后不得残留中文规则、不得含旧术语）
        final String teamEn = TeamPromptLocalizer.localizeTeamSystemPrompt(team, AllowedLanguage.EN);
        assertFalse(teamEn.contains("PUSH_WINDOWS"), "team EN 不得含 PUSH_WINDOWS");
        final String playerEn = PlayerPromptRules.localizePlayerSystemPrompt(player, AllowedLanguage.EN);
        assertFalse(playerEn.contains("PUSH_WINDOWS"), "player EN 不得含 PUSH_WINDOWS");
        final String teamRu = TeamPromptLocalizer.localizeTeamSystemPrompt(team, AllowedLanguage.RU);
        assertFalse(teamRu.contains("PUSH_WINDOWS"), "team RU 不得含 PUSH_WINDOWS");
    }

    // R12 — 无 evidence→mandatory mistake 固定映射：旧句式「…时，必须指出防守方失误」不得再出现
    // （新规则只以否定语境引用该说法：「不得把…固定映射成『必须指出防守方失误』」，允许出现）
    @Test
    void r12NoEvidenceToMandatoryDefensiveMistakeMapping() {
        final String team = AiPromptLibrary.zh("team/single");
        assertFalse(team.contains("过路费明显不足）时，必须指出防守方失误"), "不得存在 evidence→必须指出防守方失误 固定映射: " + team);
        assertFalse(team.contains("必须指出你方防守失误）"), "不得存在 evidence→必须指出防守方失误 固定映射");
        final String player = AiPromptLibrary.zh("player/tactical");
        assertFalse(player.contains("过路费明显不足）时，必须指出你方防守失误"), "player 不得存在固定映射: " + player);
    }

    // R13 — Player separation numeric consistency：numbers 与 summary 同源（0/0 bug 回归）
    @Test
    void r13PlayerSeparationNumbersAndSummaryConsistent() {
        final AiEvalFixtures.PlayerFixture fixture =
                AiEvalFixtures.playerFixture("player-detach-push-01");
        final EvidenceSkillResult evidence = new EvidenceSkillEngine().run(
                new EvidenceSkillContext(fixture.battle(), fixture.recon(),
                        fixture.features(), fixture.recorder()));
        for (final AiEvidence e : evidence.evidence()) {
            if (e.type() != EvidenceType.SPATIAL_SEPARATION) {
                continue;
            }
            final double dealt = e.numbers().getOrDefault("damageDealtDuringSpan", 0.0);
            final double received = e.numbers().getOrDefault("damageReceivedDuringSpan", 0.0);
            // numbers 与 summary 必须一致：summary 引用同一组测量
            if (dealt > 0 || received > 0) {
                final String s = e.summary();
                assertTrue(s.contains("窗口内输出 " + Math.round(dealt)),
                        "summary 必须引用与 numbers 相同的输出测量: " + s + " vs " + dealt);
                assertTrue(s.contains("承伤 " + Math.round(received)),
                        "summary 必须引用与 numbers 相同的承伤测量: " + s + " vs " + received);
            }
            // numbers 自身不得出现 0/0 但 summary 有值的不一致（两个 key 必须都在）
            assertTrue(e.numbers().containsKey("damageDealtDuringSpan"));
            assertTrue(e.numbers().containsKey("damageReceivedDuringSpan"));
        }
    }
}
