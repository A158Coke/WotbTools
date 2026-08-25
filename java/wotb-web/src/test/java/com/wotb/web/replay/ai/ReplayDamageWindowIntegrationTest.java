package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 真实回放（common/fixtures/replays/random-battle-example.wotbreplay，rift 随机战）掉血窗口
 * 集成回归：真实 decoder 的 DamageEvent 账号字段为 null，必须经 ParticipantMappingEvent
 * 实体映射生成窗口；覆盖 battle-relative 时间、准备阶段排除、partial 抑制、
 * Harness 主路径与 fallback 提示词、团队路径、单一攻击者不得标集火、无致死宣称。
 */
class ReplayDamageWindowIntegrationTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();

    private static AiReplayAnalysisConfig config() {
        return new AiReplayAnalysisConfig(
                ESTIMATOR, "test-model", 100_000, 131_072, 8192, 1000, false, null, 315, 4096);
    }

    private static Path fixture() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replays", "random-battle-example.wotbreplay").normalize();
    }

    private static ReplayProcessingResult processFixture() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        return new DefaultReplayProcessingFacade()
                .process(new Source(fixture().getFileName().toString(), bytes),
                        ReplayProcessingOptions.full());
    }

    @Test
    void realReplayDamageWindowsResolvedThroughEntityMapping() throws Exception {
        final ReplayProcessingResult result = processFixture();
        final Battle battle = result.battle();
        assertNotNull(battle);
        assertNotNull(result.reconstruction());
        final long recorderAccount = battle.recorderResult() != null
                ? battle.recorderResult().accountId : 0L;
        assertTrue(recorderAccount > 0, "录像者账号应解析");

        final List<DamageEvent> damages = result.reconstruction().events().stream()
                .filter(DamageEvent.class::isInstance)
                .map(DamageEvent.class::cast)
                .toList();
        assertFalse(damages.isEmpty(), "真实回放必须有伤害事件");

        // 回归门禁：真实 decoder 事件直填账号恒为 null，直接按 victimAccountId 过滤必然为空。
        // 若有人把 Clusterer 改回直接使用 damage.victimAccountId()，以下断言会失败。
        final long directFiltered = damages.stream()
                .filter(d -> d.victimAccountId() != null && d.victimAccountId() == recorderAccount)
                .count();
        assertEquals(0, directFiltered,
                "真实 decoder 的 victimAccountId 恒为 null，必须经 entity 映射解析");

        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, result.reconstruction(), recorderAccount);
        assertFalse(windows.isEmpty(), "录像者必须经实体映射得到非空掉血窗口");
        final float duration = battle.durationS == null
                ? Float.MAX_VALUE : battle.durationS.floatValue();
        // hpLoss 语义：掉血事实来自 Type-7 权威采样（真实数字保留）；攻击者 attribution 在存在
        // 无法排除的 unsupported 变体（短体/zero-raw/非 direct 冲突证据）时 fail-closed（部分未解析
        // 是合法且必须的输出）。任何窗口都不得把同一攻击者算多个、不得在未解析时断言集火。
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
        // PR #107 第 5 轮回归：短体/zero-raw damage-method 变体现在产出冲突证据事件并真正参与
        // attribution fail-closed——本夹具（含短体/zero-raw 变体）必须存在诚实标记「攻击者部分未解析」
        // 的窗口（若有人回退成「warning 不产出事件」，此断言失败）；不得伪造攻击者。
        assertTrue(windows.stream().anyMatch(w -> w.attackersUnresolved()),
                "至少一个窗口必须诚实标记攻击者未解析（冲突证据 fail-closed）: " + windows);

        // Player 证据段：覆盖完整时输出真实数字；partial 时抑制并输出 UNAVAILABLE
        final StringBuilder full = new StringBuilder();
        PlayerEvidenceFormatter.appendRecorderDamageReceivedWindows(
                full, battle, result.reconstruction(), recorderAccount, false);
        final String fullEvidence = full.toString();
        assertTrue(fullEvidence.contains("RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口"), fullEvidence);
        assertTrue(fullEvidence.contains("掉血524"), fullEvidence);
        // 夹具含短体/zero-raw 冲突证据 → 窗口攻击者 fail-closed：诚实输出「攻击者0（攻击者部分未解析）」
        assertTrue(fullEvidence.contains("攻击者0"), fullEvidence);
        assertTrue(fullEvidence.contains("（攻击者部分未解析）"), fullEvidence);
        assertTrue(fullEvidence.contains("攻击者=1 → 短时间集中掉血/高压掉血窗口（不是集火）"), fullEvidence);
        assertFalse(fullEvidence.contains("致死"), "不得输出生产中恒为 false 的致死宣称");

        final StringBuilder partial = new StringBuilder();
        PlayerEvidenceFormatter.appendRecorderDamageReceivedWindows(
                partial, battle, result.reconstruction(), recorderAccount, true);
        final String partialEvidence = partial.toString();
        assertTrue(partialEvidence.contains("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), partialEvidence);
        assertFalse(partialEvidence.contains("掉血488"), partialEvidence);
        assertFalse(partialEvidence.contains("攻击者1"), partialEvidence);
    }

    @Test
    void harnessAndFallbackPromptsIncludeRealDamageWindows() throws Exception {
        final ReplayProcessingResult result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result);
        assertTrue(recorder.resolved());
        final PlayerBattleFeatureSet features = new DefaultPlayerBattleFeatureExtractor()
                .extract(result.reconstruction(), recorder, battle);
        final EvidenceSkillResult evidence = new EvidenceSkillEngine()
                .run(new EvidenceSkillContext(battle, result.reconstruction(), features, recorder));
        assertTrue(evidence.hasContent());
        // 覆盖完整（无 OBSERVED_DAMAGE_IS_PARTIAL）的 Harness 主路径：必须包含真实窗口数字
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

        // 真实特征（本夹具带 OBSERVED_DAMAGE_IS_PARTIAL）→ Harness 输出抑制标记而非数字
        final var partialPrepared = TacticalReviewPromptBuilder.prepare(
                null, evidence, battle, result.reconstruction(), features, recorder,
                ESTIMATOR, 100_000, 131_072, 8192, 1000);
        final String partialContent = partialPrepared.userContent();
        assertTrue(partialContent.contains("RECORDER_DAMAGE_RECEIVED_WINDOWS ===\n"
                + "UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), partialContent);
        assertFalse(partialContent.contains("掉血488"), partialContent);
        assertFalse(partialContent.contains("你输出"), partialContent);
        assertFalse(partialContent.contains("事件流输出:"), partialContent);
        // 引擎在 partial 下跳过 EngagementTradeSkill，Prompt 边界再防御性过滤：
        // 换血摘要/伤害数字/窗口聚合数字一律不得进入 final user prompt
        assertFalse(partialContent.contains("换血"), partialContent);
        assertFalse(partialContent.contains("damageDealt="), partialContent);
        assertFalse(partialContent.contains("damageReceived="), partialContent);
        assertFalse(partialContent.contains("recorderDamageDealt"), partialContent);
        assertFalse(partialContent.contains("recorderDamageReceived"), partialContent);

        // fallback（prepareFull）同样包含窗口
        final SinglePlayerBattleAnalysisContext ctx = new SinglePlayerBattleAnalysisContext(
                null, battle, completeFeatures, recorder,
                result.reconstruction().coverage(), List.of());
        final var fallback = PlayerReplayPromptBuilder.prepareFull(
                ctx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                com.wotb.web.replay.ai.AllowedLanguage.ZH);
        assertTrue(fallback.userPrompt().contains("RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口"),
                fallback.userPrompt());
        assertTrue(fallback.userPrompt().contains("掉血524"), fallback.userPrompt());
        // 同根因修复：逐次伤害与逐对手对炮段在真实事件（直填账号为 null）下也必须非空
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
        final ReplayProcessingResult result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result);
        assertTrue(recorder.resolved());
        final PlayerBattleFeatureSet features = new DefaultPlayerBattleFeatureExtractor()
                .extract(result.reconstruction(), recorder, battle);
        assertTrue(features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL"),
                "真实夹具必须带 OBSERVED_DAMAGE_IS_PARTIAL（前置条件）");
        // 使用真实 features（不移除 limitations）：partial 下三段事件流伤害数字必须全部抑制
        final SinglePlayerBattleAnalysisContext ctx = new SinglePlayerBattleAnalysisContext(
                null, battle, features, recorder, result.reconstruction().coverage(),
                features.limitations());
        final var zh = PlayerReplayPromptBuilder.prepareFull(
                ctx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                AllowedLanguage.ZH);
        assertNoEventStreamDamageNumbers(zh.userPrompt());
        // NON_ZH（Harness fallback 可达路径）同样抑制
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
    void fallbackKillVictimSectionsSuppressedWhenPartial() throws Exception {
        final ReplayProcessingResult result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result);
        assertTrue(recorder.resolved());
        final PlayerResult rec = battle.recorderResult();
        assertNotNull(rec);
        final PlayerResult enemy = battle.players.stream()
                .filter(p -> p != null && p.team != recorder.team())
                .findFirst().orElseThrow();
        // 构造双方 killVictims（事件流观测数据）：累计伤害 780 / 击穿 2、650 / 3
        rec.killVictims.add(new com.wotb.core.model.KillVictim(enemy.accountId, 780, 2));
        enemy.killVictims.add(new com.wotb.core.model.KillVictim(rec.accountId, 650, 3));

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
        assertKillVictimNumbersSuppressed(zhPrompt);
        assertTrue(zhPrompt.contains("你击杀了"), "partial 下应保留击杀身份: " + zhPrompt);
        assertTrue(zhPrompt.contains("击杀你的是"), "partial 下应保留击杀身份: " + zhPrompt);
        assertTrue(zhPrompt.contains("你的战绩"), "权威结算段不得被误删: " + zhPrompt);
        assertTrue(zhPrompt.contains("DAMAGE_EXCHANGE_AGGREGATED_OBSERVED ===\n"
                + "UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), zhPrompt);

        // NON_ZH（Harness fallback 可达路径）同样抑制
        final var en = PlayerReplayPromptBuilder.prepareFull(
                partialCtx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                AllowedLanguage.EN);
        assertKillVictimNumbersSuppressed(en.userPrompt());

        // complete coverage：累计伤害与击杀归因明细正常输出
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
        // hpLoss 语义：数字来自权威掉血推导（本夹具录像者对击杀目标未造成可证明掉血 → 0），
        // 身份线索来自 killVictims；不得再输出 raw 或 killVictims 构造数字。
        assertTrue(completePrompt.contains("累计直接伤害"), completePrompt);
        assertTrue(completePrompt.contains("致死前累计承受你"), completePrompt);
        assertTrue(completePrompt.contains("致死前对你累计造成"), completePrompt);
        assertFalse(completePrompt.contains("累计直接伤害780"), "构造的 killVictims 数字不得进入 prompt: " + completePrompt);
        assertFalse(completePrompt.contains("致死前累计承受你780"), completePrompt);
        assertFalse(completePrompt.contains("致死前对你累计造成650"), completePrompt);
    }

    private static void assertKillVictimNumbersSuppressed(final String prompt) {
        assertFalse(prompt.contains("累计直接伤害"), prompt);
        assertFalse(prompt.contains("累计直接伤害780"), prompt);
        assertFalse(prompt.contains("致死前累计承受你"), prompt);
        assertFalse(prompt.contains("致死前累计承受你780"), prompt);
        assertFalse(prompt.contains("致死前对你累计造成"), prompt);
        assertFalse(prompt.contains("致死前对你累计造成650"), prompt);
    }

    @Test
    void teamPathProducesWindowsForRealMembers() throws Exception {
        final ReplayProcessingResult result = processFixture();
        final Battle battle = result.battle();
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result);
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
        final TeamEvidenceFormatter.BudgetWriter writer = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendMemberDamageReceivedWindows(
                writer, battle, members, result.reconstruction(), false);
        final String content = writer.content();
        assertTrue(content.contains("MEMBER_DAMAGE_RECEIVED_WINDOWS（逐成员掉血窗口·事件流观测）"), content);
        assertTrue(content.contains("攻击者"), content);
        assertFalse(content.contains("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)"), content);
    }
}
