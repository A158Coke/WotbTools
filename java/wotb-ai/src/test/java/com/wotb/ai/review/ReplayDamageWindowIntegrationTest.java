package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReplayDamageWindowIntegrationTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();

    private static AiReplayAnalysisConfig config() {
        return new AiReplayAnalysisConfig(
                ESTIMATOR, "test-model", 100_000, 131_072, 8192, 1000, false, null, 315, 4096);
    }

    private static ReplayFactsFixtures.Facts processFixture() {
        return ReplayFactsFixtures.load("random-battle-example");
    }

    @Test
    void realReplayDamageWindowsResolvedThroughEntityMapping() throws Exception {
        final ReplayFactsFixtures.Facts result = processFixture();
        final Battle battle = result.battle();
        assertNotNull(battle);
        assertNotNull(result.reconstruction());
        final long recorderAccount = battle.recorderResult() != null
                ? battle.recorderResult().accountId : 0L;
        assertTrue(recorderAccount > 0, "录像者账号应解析");

        final List<VehicleHitEvent> damages = result.reconstruction().events().stream()
                .filter(VehicleHitEvent.class::isInstance)
                .map(VehicleHitEvent.class::cast)
                .toList();
        assertFalse(damages.isEmpty(), "真实回放必须有伤害事件");

        assertEquals(0, damages.stream().filter(d -> d.victimEntityId() <= 0).count(),
                "真实 decoder 的 VehicleHitEvent victimEntityId 必须可解析");

        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, result.reconstruction(), recorderAccount);
        assertFalse(windows.isEmpty(), "录像者必须经实体映射得到非空掉血窗口");
        final float duration = battle.durationS == null
                ? Float.MAX_VALUE : battle.durationS.floatValue();
        for (final DamageWindowClusterer.DamageWindow window : windows) {
            assertTrue(window.startSec() >= 0f, "battle-relative 时间不得为负: " + window);
            assertTrue(window.endSec() >= window.startSec());
            assertTrue(window.endSec() <= duration + 5f, "窗口不得超出战斗时长: " + window);
            assertTrue(window.totalDamage() > 0 && window.hitCount() > 0);
            assertTrue(window.uniqueAttackerCount() <= 1,
                    "单一攻击者只能算 1 个攻击者（不得把同一攻击者算多个）: " + window);
            assertFalse(window.focusFireCandidate() && window.attackersUnresolved(),
                    "攻击者未解析时不得断言集火: " + window);
        }
        assertTrue(windows.stream().anyMatch(w -> w.attackersUnresolved()),
                "至少一个窗口必须诚实标记攻击者未解析（冲突证据 fail-closed）: " + windows);

        final StringBuilder full = new StringBuilder();
        PlayerCombatEvidenceFormatter.appendRecorderDamageReceivedWindows(
                full, battle, result.reconstruction(), recorderAccount, false);
        final String fullEvidence = full.toString();
        assertTrue(fullEvidence.contains("RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口"), fullEvidence);
        assertTrue(fullEvidence.contains("掉血524"), fullEvidence);
        assertTrue(fullEvidence.contains("攻击者0"), fullEvidence);
        assertTrue(fullEvidence.contains("（攻击者部分未解析）"), fullEvidence);
        assertTrue(fullEvidence.contains("攻击者=1 → 短时间集中掉血/高压掉血窗口（不是集火）"), fullEvidence);
        assertFalse(fullEvidence.contains("致死"), "不得输出生产中恒为 false 的致死宣称");

        final StringBuilder partial = new StringBuilder();
        PlayerCombatEvidenceFormatter.appendRecorderDamageReceivedWindows(
                partial, battle, result.reconstruction(), recorderAccount, true);
        final String partialEvidence = partial.toString();
        assertTrue(partialEvidence.contains("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), partialEvidence);
        assertFalse(partialEvidence.contains("掉血488"), partialEvidence);
        assertFalse(partialEvidence.contains("攻击者1"), partialEvidence);
    }

    @Test
    void harnessAndFallbackPromptsIncludeRealDamageWindows() throws Exception {
        final ReplayFactsFixtures.Facts result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result.battle(), result.reconstruction());
        assertTrue(recorder.resolved());
        final PlayerBattleFeatureSet features = new DefaultPlayerBattleFeatureExtractor()
                .extract(result.reconstruction(), recorder, battle);
        final EvidenceSkillResult evidence = new EvidenceSkillEngine()
                .run(new EvidenceSkillContext(battle, result.reconstruction(), features, recorder));
        assertTrue(evidence.hasContent());
        final PlayerBattleFeatureSet completeFeatures = new PlayerBattleFeatureSet(
                features.movements(), features.engagements(), features.phases(),
                features.keyEvents(), List.of(), features.hasFeatures());
        final var harnessPrepared = TacticalReviewPromptBuilder.prepare(
                null, evidence, battle, result.reconstruction(), completeFeatures, recorder,
                ESTIMATOR, 100_000, 131_072, 8192, 1000);
        final String harnessContent = harnessPrepared.userContent();
        assertTrue(harnessContent.contains("RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口"), harnessContent);
        assertTrue(harnessContent.contains("掉血524"), harnessContent);
        assertTrue(harnessContent.contains("攻击者0"), harnessContent);
        assertTrue(harnessContent.contains("（攻击者部分未解析）"), harnessContent);
        assertFalse(harnessContent.contains("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), harnessContent);
        assertTrue(harnessContent.indexOf("======================== TASK")
                        > harnessContent.indexOf("RECORDER_DAMAGE_RECEIVED_WINDOWS"),
                "掉血窗口段必须位于 TASK 之前");

        final var partialPrepared = TacticalReviewPromptBuilder.prepare(
                null, evidence, battle, result.reconstruction(), features, recorder,
                ESTIMATOR, 100_000, 131_072, 8192, 1000);
        final String partialContent = partialPrepared.userContent();
        assertTrue(partialContent.contains("RECORDER_DAMAGE_RECEIVED_WINDOWS ===\n"
                + "UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), partialContent);
        assertFalse(partialContent.contains("掉血488"), partialContent);
        assertFalse(partialContent.contains("你输出"), partialContent);
        assertFalse(partialContent.contains("事件流输出:"), partialContent);
        assertFalse(partialContent.contains("换血"), partialContent);
        assertFalse(partialContent.contains("damageDealt="), partialContent);
        assertFalse(partialContent.contains("damageReceived="), partialContent);
        assertFalse(partialContent.contains("recorderDamageDealt"), partialContent);
        assertFalse(partialContent.contains("recorderDamageReceived"), partialContent);

        final SinglePlayerBattleAnalysisContext ctx = new SinglePlayerBattleAnalysisContext(
                null, battle, completeFeatures, recorder,
                result.reconstruction().coverage(), List.of());
        final var fallback = PlayerReplayPromptBuilder.prepareFull(
                ctx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                com.wotb.ai.review.AllowedLanguage.ZH);
        assertTrue(fallback.userPrompt().contains("RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口"),
                fallback.userPrompt());
        assertTrue(fallback.userPrompt().contains("掉血524"), fallback.userPrompt());
        assertTrue(fallback.userPrompt().contains("PER_HIT_DAMAGE_EVENTS_OBSERVED"),
                fallback.userPrompt());
        assertFalse(fallback.userPrompt().contains("PER_HIT_DAMAGE_EVENTS_UNAVAILABLE"),
                fallback.userPrompt());
        assertTrue(fallback.userPrompt().contains("DAMAGE_EXCHANGE_BY_OPPONENT_OBSERVED"),
                fallback.userPrompt());
        assertTrue(fallback.userPrompt().contains("对你造成了"),
                "逐次伤害必须包含录像者受击行（hpLoss 语义: 「…对你造成了N点伤害」）: "
                        + fallback.userPrompt());
    }

    @Test
    void fallbackPromptSuppressesAllEventStreamDamageNumbersWhenPartial() throws Exception {
        final ReplayFactsFixtures.Facts result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result.battle(), result.reconstruction());
        assertTrue(recorder.resolved());
        final PlayerBattleFeatureSet features = new DefaultPlayerBattleFeatureExtractor()
                .extract(result.reconstruction(), recorder, battle);
        assertTrue(features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL"),
                "真实夹具必须带 OBSERVED_DAMAGE_IS_PARTIAL（前置条件）");
        final SinglePlayerBattleAnalysisContext ctx = new SinglePlayerBattleAnalysisContext(
                null, battle, features, recorder, result.reconstruction().coverage(),
                features.limitations());
        final var zh = PlayerReplayPromptBuilder.prepareFull(
                ctx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                AllowedLanguage.ZH);
        assertNoEventStreamDamageNumbers(zh.userPrompt());
        final var en = PlayerReplayPromptBuilder.prepareFull(
                ctx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                AllowedLanguage.EN);
        assertNoEventStreamDamageNumbers(en.userPrompt());
    }

    private static void assertNoEventStreamDamageNumbers(final String prompt) {
        final long markers = prompt.split("UNAVAILABLE \\(OBSERVED_DAMAGE_IS_PARTIAL\\)", -1).length - 1;
        assertTrue(markers >= 3,
                "逐对手/逐炮/掉血窗口三段都应有 UNAVAILABLE 标记，实际 " + markers + "\n" + prompt);
        assertFalse(prompt.contains("DAMAGE_EXCHANGE_BY_OPPONENT_OBSERVED"), prompt);
        assertFalse(prompt.contains("PER_HIT_DAMAGE_EVENTS_OBSERVED"), prompt);
        assertFalse(prompt.contains("你对其造成"), prompt);
        assertFalse(prompt.contains("造成了"), prompt);
        assertFalse(prompt.contains("掉血524"), prompt);
        assertFalse(prompt.contains("攻击者1"), prompt);
        assertFalse(prompt.contains("事件流输出:"), prompt);
        assertFalse(prompt.contains("事件流损失血量:"), prompt);
        assertFalse(prompt.contains("事件流观测输出子集"), prompt);
        assertFalse(prompt.contains("累计直接伤害"), prompt);
        assertFalse(prompt.contains("致死前累计承受你"), prompt);
        assertFalse(prompt.contains("致死前对你累计造成"), prompt);
    }

    @Test
    void killAttributionIdentityRetainedFromCanonicalTerminalWhenPartial() throws Exception {
        final ReplayFactsFixtures.Facts result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result.battle(), result.reconstruction());
        assertTrue(recorder.resolved());
        final PlayerResult rec = battle.recorderResult();
        assertNotNull(rec);

        final PlayerBattleFeatureSet features = new DefaultPlayerBattleFeatureExtractor()
                .extract(result.reconstruction(), recorder, battle);
        assertTrue(features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        final SinglePlayerBattleAnalysisContext partialCtx = new SinglePlayerBattleAnalysisContext(
                null, battle, features, recorder, result.reconstruction().coverage(),
                features.limitations());
        final var zh = PlayerReplayPromptBuilder.prepareFull(
                partialCtx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                AllowedLanguage.ZH);
        final String zhPrompt = zh.userPrompt();
        assertKillAttributionNumbersSuppressed(zhPrompt);
        assertTrue(zhPrompt.contains("你击杀了"), "partial 下应保留 canonical 击杀身份: " + zhPrompt);
        assertTrue(zhPrompt.contains("你的战绩"), "权威结算段不得被误删: " + zhPrompt);
        assertTrue(zhPrompt.contains("DAMAGE_EXCHANGE_AGGREGATED_OBSERVED ===\n"
                + "UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), zhPrompt);

        final var en = PlayerReplayPromptBuilder.prepareFull(
                partialCtx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                AllowedLanguage.EN);
        assertKillAttributionNumbersSuppressed(en.userPrompt());

        final PlayerBattleFeatureSet completeFeatures = new PlayerBattleFeatureSet(
                features.movements(), features.engagements(), features.phases(),
                features.keyEvents(), List.of(), features.hasFeatures());
        final SinglePlayerBattleAnalysisContext completeCtx = new SinglePlayerBattleAnalysisContext(
                null, battle, completeFeatures, recorder, result.reconstruction().coverage(),
                List.of());
        final var complete = PlayerReplayPromptBuilder.prepareFull(
                completeCtx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                AllowedLanguage.ZH);
        final String completePrompt = complete.userPrompt();
        assertTrue(completePrompt.contains("你击杀了"), "complete 下 canonical 击杀身份应保留: " + completePrompt);
        assertFalse(completePrompt.contains("累计直接伤害780"), "构造的 killVictims 数字不得进入 prompt: " + completePrompt);
        assertFalse(completePrompt.contains("致死前累计承受你780"), completePrompt);
        assertFalse(completePrompt.contains("致死前对你累计造成650"), completePrompt);
    }

    private static void assertKillAttributionNumbersSuppressed(final String prompt) {
        assertFalse(prompt.contains("累计直接伤害"), prompt);
        assertFalse(prompt.contains("累计直接伤害780"), prompt);
        assertFalse(prompt.contains("致死前累计承受你"), prompt);
        assertFalse(prompt.contains("致死前累计承受你780"), prompt);
        assertFalse(prompt.contains("致死前对你累计造成"), prompt);
        assertFalse(prompt.contains("致死前对你累计造成650"), prompt);
    }

    @Test
    void teamPathProducesWindowsForRealMembers() throws Exception {
        final ReplayFactsFixtures.Facts result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result.battle(), result.reconstruction());
        assertTrue(recorder.resolved());
        final int perspectiveTeam = recorder.team() != null ? recorder.team() : 1;
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (final PlayerResult p : battle.players) {
            if (p != null && p.team == perspectiveTeam) {
                members.add(new TeamMemberFeatureSet(
                        List.of(), p.accountId, p.nickname, p.tankId, p.tankName, p.team,
                        DecodeConfidence.EXACT,
                        p.damageDealt, p.damageReceived, p.damageAssisted, p.damageBlocked, p.kills,
                        p.survived, p.deathTimeMillis > 0 ? p.deathTimeMillis / 1000.0 : null,
                        List.of(), List.of(), List.of(), List.of()));
            }
        }
        assertFalse(members.isEmpty());
        final TeamPromptBudgetWriter writer = new TeamPromptBudgetWriter();
        TeamBattleEvidenceFormatter.appendMemberDamageReceivedWindows(
                writer, battle, members, result.reconstruction(), false);
        final String content = writer.content();
        assertTrue(content.contains("MEMBER_DAMAGE_RECEIVED_WINDOWS（逐成员掉血窗口·事件流观测）"), content);
        assertTrue(content.contains("攻击者"), content);
        assertFalse(content.contains("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), content);
    }
}
