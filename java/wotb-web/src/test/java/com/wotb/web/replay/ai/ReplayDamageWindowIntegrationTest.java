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
                ESTIMATOR, "test-model", 100_000, 131_072, 8192, 1000, false, null, 315);
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
        for (final DamageWindowClusterer.DamageWindow window : windows) {
            assertTrue(window.startSec() >= 0f, "battle-relative 时间不得为负: " + window);
            assertTrue(window.endSec() >= window.startSec());
            assertTrue(window.endSec() <= duration + 5f, "窗口不得超出战斗时长: " + window);
            assertTrue(window.totalDamage() > 0 && window.hitCount() > 0);
            // 本夹具录像者两次受击均为单一攻击者：不得当作集火
            assertEquals(1, window.uniqueAttackerCount(), "单一攻击者只能算 1 个攻击者: " + window);
            assertFalse(window.attackersUnresolved());
        }

        // Player 证据段：覆盖完整时输出真实数字；partial 时抑制并输出 UNAVAILABLE
        final StringBuilder full = new StringBuilder();
        PlayerEvidenceFormatter.appendRecorderDamageReceivedWindows(
                full, battle, result.reconstruction(), recorderAccount, false);
        final String fullEvidence = full.toString();
        assertTrue(fullEvidence.contains("RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口"), fullEvidence);
        assertTrue(fullEvidence.contains("掉血488"), fullEvidence);
        assertTrue(fullEvidence.contains("攻击者1"), fullEvidence);
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
        assertTrue(harnessContent.contains("掉血488"), harnessContent);
        assertTrue(harnessContent.contains("攻击者1"), harnessContent);
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

        // fallback（prepareFull）同样包含窗口
        final SinglePlayerBattleAnalysisContext ctx = new SinglePlayerBattleAnalysisContext(
                null, battle, completeFeatures, recorder,
                result.reconstruction().coverage(), List.of());
        final var fallback = PlayerReplayPromptBuilder.prepareFull(
                ctx, result.reconstruction(), ESTIMATOR, 100_000, 131_072, 8192, 1000,
                com.wotb.web.replay.ai.AllowedLanguage.ZH);
        assertTrue(fallback.userPrompt().contains("RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口"),
                fallback.userPrompt());
        assertTrue(fallback.userPrompt().contains("掉血488"), fallback.userPrompt());
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
