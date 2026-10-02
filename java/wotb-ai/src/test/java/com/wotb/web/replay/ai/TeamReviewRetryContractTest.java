package com.wotb.web.replay.ai;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.ReplayStreamHeader;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayStreamDiagnostics;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.ai.gateway.StreamConsumer;
import com.wotb.web.replay.dto.AiReviewDonePayload;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Team Call #2（v0.5 structured result）的 transport 契约：
 * <ul>
 *   <li>合法 structured JSON → 恰好 1 次 {@code SINGLE_TEAM_BATTLE} 请求；</li>
 *   <li>contract 失败 → 恰好 1 次 {@code SINGLE_TEAM_BATTLE_RECOVERY}（全新 stream() 调用，不串 buffer）；</li>
 *   <li>{@code completionText()} 是唯一 authoritative source（stream callback 只是 progress）；</li>
 *   <li>上游失败原样传播（绝不产出 partial 结果）；</li>
 *   <li>Team Call #2 显式 {@code JSON_OBJECT}，Call #1 保持 TEXT。</li>
 * </ul>
 */
class TeamReviewRetryContractTest {

    private static final float START_RAW = 1000f;

    /** 合法 v0.5 structured result。 */
    private static final String STRUCTURED_RESULT = "{"
            + "\"summary\":{\"verdict\":\"结论\",\"primaryDiagnosis\":\"诊断\"},"
            + "\"episodes\":[],\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[]}";

    @Test
    void structuredPrimaryUsesExactlyOneCall2Request() {
        final RetryGateway gateway = new RetryGateway(List.of(STRUCTURED_RESULT));
        final TeamReplayAnalysisService service = service(gateway);

        final AiReviewDonePayload result = analyze(service);

        assertNotNull(result.teamReview(), "v0.5 structured result must reach the done payload");
        assertEquals("结论", result.analysis(), "文本摘要取 structured result 的 verdict");
        assertEquals(1, gateway.teamCall2Requests(), "合法 structured JSON 只允许 1 次 Call #2 请求");
    }

    // ===== callRaw authoritative response source = completionText() =====

    @Test
    void completionTextIsAuthoritativeOverPartialCallbackChunks() {
        // stream() 回调只给零散 chunk，completionText 才是完整 structured result
        final StreamingGateway gateway = new StreamingGateway(
                List.of(STRUCTURED_RESULT), List.of("{", "\"summary", "\"verdict\"..."), null);
        final TeamReplayAnalysisService service = service(gateway);

        final AiReviewDonePayload result = analyze(service);

        assertEquals("结论", result.analysis(),
                "parser 必须以 completionText() 为唯一 authoritative source（非 callback 拼接）");
    }

    @Test
    void garbageCallbackDoesNotPolluteParse() {
        final StreamingGateway gateway = new StreamingGateway(
                List.of(STRUCTURED_RESULT), List.of("garbage chunk not json"), null);
        final TeamReplayAnalysisService service = service(gateway);

        final AiReviewDonePayload result = analyze(service);

        assertEquals("结论", result.analysis(), "callback 内容不得影响 completionText 的解析");
        assertEquals(1, gateway.teamReviewRequests(), "垃圾 callback 不得触发 recovery");
    }

    @Test
    void upstreamErrorNeverYieldsPartialResult() {
        // 上游失败（AI_TIMEOUT）→ 直接抛 AiUpstreamException，绝不返回 partial 结果
        final StreamingGateway gateway = new StreamingGateway(
                List.of(STRUCTURED_RESULT), List.of(), new AiUpstreamException("AI_TIMEOUT", 504, "corr-1"));
        final TeamReplayAnalysisService service = service(gateway);

        final AiUpstreamException e = assertThrows(AiUpstreamException.class, () -> analyze(service));

        assertEquals("AI_TIMEOUT", e.code(),
                "upstream error 必须原样传播（不是 AI_REVIEW_SCHEMA_FAILED，也不产出部分结果）");
    }

    @Test
    void recoveryUsesFreshIndependentResponseNoBufferCarry() {
        // attempt1 = "{}"（contract 失败）→ 唯一一次 recovery 用全新 stream() 响应成功
        final StreamingGateway gateway = new StreamingGateway(
                List.of("{}", STRUCTURED_RESULT), List.of("{", "\"summary", "\"..."), null);
        final TeamReplayAnalysisService service = service(gateway);

        final AiReviewDonePayload result = analyze(service);

        assertNotNull(result.teamReview(), "recovery 必须用全新响应重建 structured result");
        assertEquals(2, gateway.teamReviewRequests(), "contract 失败只允许一次 recovery");
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", gateway.lastTeamMode());
    }

    // ===== 只有 Team Call #2 使用 JSON_OBJECT =====

    @Test
    void teamCall2ExplicitlyUsesJsonObjectWhilePreBattleStaysText() {
        final RetryGateway gateway = new RetryGateway(List.of(STRUCTURED_RESULT));
        final TeamReplayAnalysisService service = service(gateway);
        analyze(service);

        final AiChatRequest teamCall2 = gateway.requests().stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .findFirst().orElseThrow();
        assertEquals(AiResponseFormat.JSON_OBJECT, teamCall2.responseFormat(),
                "Team Call #2 必须显式请求 JSON_OBJECT");

        // Call #1（Pre-Battle Strategic Prior）保持 TEXT，不得因本任务进入 JSON mode。
        final AiChatRequest preBattle = gateway.requests().stream()
                .filter(r -> "PRE_BATTLE_STRATEGIC_PRIOR".equals(r.analysisMode()))
                .findFirst().orElseThrow();
        assertEquals(AiResponseFormat.TEXT, preBattle.responseFormat(),
                "PRE_BATTLE_STRATEGIC_PRIOR 必须保持 TEXT");
    }

    // ---- fixture ----

    private static AiReviewDonePayload analyze(final TeamReplayAnalysisService service) {
        return service.analyzeTeam(teamBattle("arena-retry", "Ally", 1001L, 1), validRecon(),
                AllowedLanguage.ZH, AiReviewStreamListener.NOOP);
    }

    private static TeamReplayAnalysisService service(final AiChatGateway gateway) {
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                new ConservativeDeepSeekTokenEstimator(), "test-model",
                200_000, 131_072, 8192, 1000, true, "high", 315, 4096);
        return new TeamReplayAnalysisService(
                gateway, config,
                new PreBattleStrategicService(gateway, config, null),
                System::nanoTime, null);
    }

    private static Battle teamBattle(final String arenaId,
                                     final String recorderNickname,
                                     final long recorderAccountId,
                                     final int recorderTeam) {
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
        return battle;
    }

    private static ReplayReconstruction validRecon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 120.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(10, 10, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
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
     * 流式替身：{@code stream()} 按调用顺序返回预设 completionText，
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
            if (!isTeamMode(request)) {
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

        int teamReviewRequests() {
            return (int) requests.stream().filter(StreamingGateway::isTeamMode).count();
        }

        int teamCall2Requests() {
            return (int) requests.stream()
                    .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                    .count();
        }

        String lastTeamMode() {
            return requests.stream().filter(StreamingGateway::isTeamMode)
                    .reduce((first, second) -> second).orElseThrow().analysisMode();
        }

        static boolean isTeamMode(final AiChatRequest request) {
            return "SINGLE_TEAM_BATTLE".equals(request.analysisMode())
                    || "SINGLE_TEAM_BATTLE_RECOVERY".equals(request.analysisMode());
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
            // 预设响应序列只供 Team Call #2 消费；Call #1 的解析器不消费该序列（返回不可解析空对象即可）。
            final String response;
            if ("SINGLE_TEAM_BATTLE".equals(request.analysisMode())
                    || "SINGLE_TEAM_BATTLE_RECOVERY".equals(request.analysisMode())) {
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
}
