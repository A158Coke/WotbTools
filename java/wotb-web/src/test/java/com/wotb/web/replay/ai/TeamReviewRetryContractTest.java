package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.BatchAnalyzer;
import com.wotb.core.replay.processing.ReplayIdentity;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.ai.gateway.StreamConsumer;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Natural Coach 轮：Team Call #2 事实一致性校验 + LLM 自修循环编排契约。
 * <p>流程（docs/current-plan.md §13/§14）：Draft → validate；FAIL → targeted rewrite；
 * FAIL → full rewrite；仍 FAIL → fail-safe（AI_REVIEW_GROUNDING_FAILED）。Backend 绝不代改句子。</p>
 */
class TeamReviewRetryContractTest {

    private static final float START_RAW = 1000f;

    private static final String GOOD_ENVELOPE = "{"
            + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
            + "\"reviewMarkdown\":\"## 团队复盘\\n\\n这是一段复盘。\",\"claims\":[]}";
    /** V6 冲突：无 LOS 证据的硬事实断言（this draft must fail validation）。 */
    private static final String BAD_ENVELOPE = "{"
            + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
            + "\"reviewMarkdown\":\"这波对方所有车辆都拥有直接炮线。\",\"claims\":[]}";

    @Test
    void passOnFirstDraftUsesSingleCall2Request() {
        final RetryGateway gateway = new RetryGateway(List.of(GOOD_ENVELOPE));
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        assertEquals("## 团队复盘\n\n这是一段复盘。", result.analysis());
        assertEquals(1, gateway.teamCall2Requests(),
                "首次通过只允许 1 次 Call #2 请求");
    }

    @Test
    void conflictTriggersTargetedRewriteThenPasses() {
        // Draft FAIL（V6）→ 反馈后重写 PASS
        final RetryGateway gateway = new RetryGateway(List.of(BAD_ENVELOPE, GOOD_ENVELOPE));
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        assertEquals("## 团队复盘\n\n这是一段复盘。", result.analysis());
        assertEquals(2, gateway.teamCall2Requests(),
                "Draft FAIL 后必须有一次 LLM 自修重写");
        // 第二次请求的用户输入必须包含 validator 反馈（LLM 自行改写，Backend 不代改）
        final AiChatRequest rewrite = gateway.requests().stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .reduce((a, b) -> b).orElseThrow();
        assertTrue(rewrite.userPrompt().contains("事实一致性校验反馈"),
                "重写请求必须携带 validator 反馈: " + rewrite.userPrompt());
        assertTrue(rewrite.userPrompt().contains("[V6]"),
                "重写请求反馈必须包含具体冲突 checkId: " + rewrite.userPrompt());
    }

    @Test
    void repeatedConflictsExhaustRetriesAndFailSafe() {
        final RetryGateway gateway = new RetryGateway(List.of(BAD_ENVELOPE, BAD_ENVELOPE, BAD_ENVELOPE));
        final TeamReplayAnalysisService service = service(gateway);
        final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context(gateway, service), AllowedLanguage.ZH));
        assertEquals("AI_REVIEW_GROUNDING_FAILED", e.code(),
                "重试耗尽必须 fail-safe 为 AI_REVIEW_GROUNDING_FAILED");
        assertEquals(TeamReplayAnalysisService.MAX_VALIDATION_ATTEMPTS, gateway.teamCall2Requests(),
                "必须恰好 3 次尝试（draft + targeted + full）后 fail-safe");
    }

    @Test
    void parseFailureAlsoTriggersRewrite() {
        // 非 JSON 输出（旧自由文本）→ parse FAIL → 反馈重写
        final RetryGateway gateway = new RetryGateway(List.of("team review 自由文本", GOOD_ENVELOPE));
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        assertEquals("## 团队复盘\n\n这是一段复盘。", result.analysis());
        assertEquals(2, gateway.teamCall2Requests());
    }

    // ===== Review B1-1：callRaw authoritative response source = completionText() =====

    @Test
    void completionTextIsAuthoritativeOverPartialCallbackChunks() {
        // stream() 回调只给零散 chunk（{ / "primary / Diagnosis...），completionText 是完整 envelope
        final StreamingGateway gateway = new StreamingGateway(
                List.of(GOOD_ENVELOPE), List.of("{", "\"primary", "Diagnosis\"..."), null);
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertEquals("## 团队复盘\n\n这是一段复盘。", result.analysis(),
                "envelope parser 必须以 completionText() 为唯一 authoritative source（非 callback 拼接）");
    }

    @Test
    void garbageCallbackDoesNotPolluteParse() {
        // 回调发出非 JSON 垃圾，completionText 是合法 envelope → 仍正确解析
        final StreamingGateway gateway = new StreamingGateway(
                List.of(GOOD_ENVELOPE), List.of("garbage chunk not json"), null);
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertEquals("## 团队复盘\n\n这是一段复盘。", result.analysis(),
                "callback 内容不得影响 completionText 的解析");
    }

    @Test
    void upstreamErrorNeverYieldsPartialEnvelope() {
        // 上游失败（AI_TIMEOUT）→ 直接抛 AiUpstreamException，绝不返回 partial envelope
        final StreamingGateway gateway = new StreamingGateway(
                List.of(GOOD_ENVELOPE), List.of(), new AiUpstreamException("AI_TIMEOUT", 504, "corr-1"));
        final TeamReplayAnalysisService service = service(gateway);
        final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context(gateway, service), AllowedLanguage.ZH));
        assertEquals("AI_TIMEOUT", e.code(),
                "upstream error 必须原样传播（不是 AI_REVIEW_GROUNDING_FAILED，也不产出部分结果）");
    }

    @Test
    void retryUsesFreshIndependentResponsesNoBufferCarry() {
        // 每轮 attempt 独立 stream()：attempt1 冲突 → attempt2 全新 GOOD envelope（无前一轮 buffer 串扰）
        final StreamingGateway gateway = new StreamingGateway(
                List.of(BAD_ENVELOPE, GOOD_ENVELOPE), List.of("{", "\"primary", "Diagnosis\"..."), null);
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertEquals("## 团队复盘\n\n这是一段复盘。", result.analysis());
        assertEquals(2, gateway.teamCall2Requests(),
                "Draft FAIL 后必须用全新响应重写，不串前一轮 buffer");
    }

    // ---- fixture ----

    private static TeamReplayAnalysisService service(final AiChatGateway gateway) {
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                new ConservativeDeepSeekTokenEstimator(), "test-model",
                200_000, 131_072, 8192, 1000, true, "high", 315, 4096);
        return new TeamReplayAnalysisService(
                gateway, config,
                new PreBattleStrategicService(gateway, config, null),
                new TeamAutopsyService(gateway, config, null),
                System::nanoTime, null);
    }

    private static SingleTeamBattleAnalysisContext context(final AiChatGateway gateway,
                                                           final TeamReplayAnalysisService service) {
        final List<ReplayPerspectiveGroup> groups = new BatchAnalyzer().analyze(
                List.of(teamResult("retry.wotbreplay", "arena-retry", "Ally", 1001L, 1, validRecon())))
                .groups();
        return service.buildSingleTeamContext(groups.getFirst());
    }

    private static ReplayProcessingResult teamResult(final String fileName,
                                                     final String arenaId,
                                                     final String recorderNickname,
                                                     final long recorderAccountId,
                                                     final int recorderTeam,
                                                     final ReplayReconstruction recon) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 120.0;
        battle.winnerTeam = 1;
        battle.recorder = recorderNickname;
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            final PlayerResult ally = new PlayerResult();
            ally.accountId = recorderTeam == 1 && i == 0 ? recorderAccountId : 1001L + i;
            ally.nickname = recorderTeam == 1 && i == 0 ? recorderNickname : "Ally" + i;
            ally.team = 1;
            ally.tankId = 4481L;
            ally.tankName = "Kranvagn";
            ally.damageDealt = 1000;
            ally.survived = true;
            players.add(ally);
        }
        for (int i = 0; i < 2; i++) {
            final PlayerResult enemy = new PlayerResult();
            enemy.accountId = 2001L + i;
            enemy.nickname = "Enemy" + i;
            enemy.team = 2;
            enemy.tankId = 29985L;
            enemy.tankName = "SPHT";
            enemy.damageDealt = 800;
            enemy.survived = true;
            players.add(enemy);
        }
        battle.players = players;
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                fileName, ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("hash-" + fileName, arenaId, "11.0", "team_map",
                        recorderAccountId, null),
                battle, recon, null, capabilities, null, null);
    }

    private static ReplayReconstruction validRecon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 120.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(true, 10, 10, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true, START_RAW, true);
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mapping(0, 1, 1001L));
        events.add(mapping(1, 2, 1002L));
        events.add(mapping(2, 3, 2001L));
        events.add(mapping(3, 4, 2002L));
        events.add(position(4, 1, 0, 10f, 10f));
        events.add(position(5, 2, 0, 20f, 20f));
        events.add(position(6, 3, 0, -10f, -10f));
        events.add(position(7, 4, 0, -20f, -20f));
        events.add(health(8, 1, 0, 2000, true));
        events.add(health(9, 2, 0, 1800, true));
        events.add(health(10, 3, 0, 1500, true));
        events.add(health(11, 4, 0, 1500, true));
        events.add(new DamageEvent(12, new ReplayTimestamp(START_RAW + 5f, null), 8,
                DecodeConfidence.EXACT, 1, 3, null, null, 420, false));
        return new ReplayReconstruction(meta, header, 120f, START_RAW, List.of(),
                events, List.of(), BattleStateSnapshot.empty(), coverage, diag);
    }

    private static ParticipantMappingEvent mapping(final int seq, final int eid, final long accountId) {
        return new ParticipantMappingEvent(seq, new ReplayTimestamp(START_RAW, null), 8,
                DecodeConfidence.EXACT, eid, accountId);
    }

    private static PositionChangedEvent position(final int seq, final int eid, final float battleSec,
                                                 final float x, final float z) {
        return new PositionChangedEvent(seq, new ReplayTimestamp(START_RAW + battleSec, null), 10,
                DecodeConfidence.EXACT, eid, 0, 0, x, 0f, z, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    private static HealthChangedEvent health(final int seq, final int eid, final float battleSec,
                                             final int hp, final boolean alive) {
        return new HealthChangedEvent(seq, new ReplayTimestamp(START_RAW + battleSec, null), 7,
                DecodeConfidence.EXACT, eid, hp, null, alive);
    }

    /**
     * Review B1-1 流式替身：{@code stream()} 按调用顺序返回预设 completionText，
     * 并先向 callback 发出预设 chunk（可为零散 JSON / 垃圾）——验证 callRaw 只用
     * completionText()（authoritative），callback 仅为 progress。
     */
    private static final class StreamingGateway implements AiChatGateway {
        final List<String> completions;
        final List<String> callbackChunks;
        final RuntimeException upstreamError;
        final List<AiChatRequest> requests = new CopyOnWriteArrayList<>();
        int index;

        StreamingGateway(final List<String> completions,
                         final List<String> callbackChunks,
                         final RuntimeException upstreamError) {
            this.completions = completions;
            this.callbackChunks = callbackChunks;
            this.upstreamError = upstreamError;
        }

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public AiChatResponse stream(final AiChatRequest request, final StreamConsumer consumer) {
            requests.add(request);
            if (upstreamError != null) {
                throw upstreamError;
            }
            if (!"SINGLE_TEAM_BATTLE".equals(request.analysisMode())) {
                return new AiChatResponse("{}", "DeepSeek", "test-model",
                        0, 0, 0, 0, 0, 0, "stop");
            }
            for (final String chunk : callbackChunks) {
                consumer.onDelta(chunk);
            }
            final String completion = completions.get(Math.min(index, completions.size() - 1));
            index++;
            return new AiChatResponse(completion, "DeepSeek", "test-model",
                    0, 0, 0, 0, 0, 0, "stop");
        }

        @Override
        public AiChatResponse chat(final AiChatRequest request) {
            return stream(request, delta -> {
            });
        }

        int teamCall2Requests() {
            return (int) requests.stream()
                    .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                    .count();
        }
    }

    /** 按调用顺序返回预设响应的替身；从不发起真实 HTTP。 */
    private static final class RetryGateway implements AiChatGateway {
        final List<String> responses;
        final List<AiChatRequest> requests = new CopyOnWriteArrayList<>();
        int index;

        RetryGateway(final List<String> responses) {
            this.responses = responses;
        }

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public AiChatResponse chat(final AiChatRequest request) {
            requests.add(request);
            // 预设响应序列只供 Team Call #2（SINGLE_TEAM_BATTLE）消费；
            // Call #1 / Autopsy 的解析器不消费该序列（返回不可解析空对象即可）。
            final String response;
            if ("SINGLE_TEAM_BATTLE".equals(request.analysisMode())) {
                response = responses.get(Math.min(index, responses.size() - 1));
                index++;
            } else {
                response = "{}";
            }
            return new AiChatResponse(response, "DeepSeek", "test-model",
                    0, 0, 0, 0, 0, 0, "stop");
        }

        List<AiChatRequest> requests() {
            return requests;
        }

        int teamCall2Requests() {
            return (int) requests.stream()
                    .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                    .count();
        }
    }
    // ===== P0-2/P0-6：structured metadata 冲突不阻塞输出（production availability） =====

    /** 仅 metadata 冲突（引用不存在的证据编号，正文无事实错误）→ 直接放行，不发起 LLM retry。 */
    @Test
    void metadataOnlyConflictsPassWithoutRetry() {
        // claim 引用不存在的证据编号 → EVIDENCE（STRUCTURED_METADATA）；正文无 V2/V3/V4/V5/V6 硬事实。
        final String metadataEnvelope = "{"
                + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n这是一段复盘。\","
                + "\"claims\":[{"
                + "\"text\":\"1分20秒-1分40秒这段时间是转折。\","
                + "\"evidenceIds\":[\"E999\"]"
                + "}]}";
        final RetryGateway gateway = new RetryGateway(List.of(metadataEnvelope));
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        assertEquals("## 团队复盘\n\n这是一段复盘。", result.analysis());
        assertEquals(1, gateway.teamCall2Requests(),
                "P0-2: metadata-only 冲突必须 1 次 Call #2 直接放行（不触发 LLM retry）");
    }

    /** 连续多次 metadata-only 冲突也不得 fail-safe 502（旧行为 3 次全量重写后 502）。 */
    @Test
    void repeatedMetadataConflictsNeverFailSafe() {
        final String metadataEnvelope = "{"
                + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n这是一段复盘。\","
                + "\"claims\":[{"
                + "\"text\":\"1分20秒-1分40秒这段时间是转折。\","
                + "\"evidenceIds\":[\"E999\"]"
                + "}]}";
        final RetryGateway gateway = new RetryGateway(
                List.of(metadataEnvelope, metadataEnvelope, metadataEnvelope));
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        assertEquals(1, gateway.teamCall2Requests(),
                "P0-6: 多次 metadata-only 冲突必须 1 次调用放行，绝不 3 次重写后 502");
    }

    /** HARD 事实冲突仍必须 retry（V6 无 LOS 证据硬事实），不得被 metadata 放行吞掉。 */
    @Test
    void hardFactConflictStillRetries() {
        final RetryGateway gateway = new RetryGateway(List.of(BAD_ENVELOPE, GOOD_ENVELOPE));
        final TeamReplayAnalysisService service = service(gateway);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        assertEquals(2, gateway.teamCall2Requests(),
                "P0-2: HARD 事实冲突（V6）仍必须触发 LLM retry");
    }

    /** HARD 事实冲突连续 3 次 → 仍 fail-safe 502（保留）。 */
    @Test
    void hardFactConflictsStillFailSafeAfterExhaustion() {
        final RetryGateway gateway = new RetryGateway(
                List.of(BAD_ENVELOPE, BAD_ENVELOPE, BAD_ENVELOPE));
        final TeamReplayAnalysisService service = service(gateway);
        final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context(gateway, service), AllowedLanguage.ZH));
        assertEquals("AI_REVIEW_GROUNDING_FAILED", e.code(),
                "HARD 事实冲突重试耗尽仍必须 fail-safe（不静默输出矛盾）");
        assertEquals(TeamReplayAnalysisService.MAX_VALIDATION_ATTEMPTS, gateway.teamCall2Requests(),
                "HARD 冲突仍恰好 3 次尝试后 fail-safe");
    }

    // ===== docs/current-plan.md §7/§25：只有 Team Call #2 使用 JSON_OBJECT =====

    @Test
    void teamCall2ExplicitlyUsesJsonObjectWhilePreBattleStaysText() {
        final RetryGateway gateway = new RetryGateway(List.of(GOOD_ENVELOPE));
        final TeamReplayAnalysisService service = service(gateway);
        service.analyzeSingleTeamContext(context(gateway, service), AllowedLanguage.ZH);

        final AiChatRequest teamCall2 = gateway.requests().stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .findFirst().orElseThrow();
        assertEquals(AiResponseFormat.JSON_OBJECT, teamCall2.responseFormat(),
                "Team Call #2 必须显式请求 JSON_OBJECT（§7）");

        // Call #1（Pre-Battle Strategic Prior）保持 TEXT，不得因本任务进入 JSON mode（§6/§25）。
        final AiChatRequest preBattle = gateway.requests().stream()
                .filter(r -> "PRE_BATTLE_STRATEGIC_PRIOR".equals(r.analysisMode()))
                .findFirst().orElseThrow();
        assertEquals(AiResponseFormat.TEXT, preBattle.responseFormat(),
                "PRE_BATTLE_STRATEGIC_PRIOR 必须保持 TEXT（§25）");
    }
}