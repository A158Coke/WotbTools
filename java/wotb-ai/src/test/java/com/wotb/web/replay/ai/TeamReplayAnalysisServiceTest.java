package com.wotb.web.replay.ai;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.ReplayStreamHeader;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.processing.BattleCategory;
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
import com.wotb.web.replay.dto.AiReviewDonePayload;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link TeamReplayAnalysisService#analyzeTeam}（Team AI 唯一 production 编排入口）契约：
 * Call #1 prior 注入 / 团队 Prompt 契约 / v0.5 structured result 解析与 salvage /
 * 唯一一次 recovery / token 与 contract 事件日志。
 */
class TeamReplayAnalysisServiceTest {

    private static final String PRIOR_JSON = """
            {
              "teamA": {"composition": {"mobility": "HIGH"}, "strengths": ["重坦正面推进"], "weaknesses": ["w1"], "preferredPlans": ["左路集结"]},
              "teamB": {"composition": {"mobility": "MEDIUM"}, "strengths": ["中坦机动拉扯"], "weaknesses": ["w2"], "preferredPlans": ["中路控制"]},
              "keyMatchups": [{"area": "GRID_REGION_5", "advantage": "TEAM_A", "reason": "r"}],
              "strategicWinConditions": [{"team": "TEAM_A", "condition": "c"}],
              "hypotheses": [{"id": "H1", "claim": "开局左路集结", "reason": "rs"}]
            }""";

    private static String structuredResult() {
        return "{\"summary\":{\"verdict\":\"team review\",\"primaryDiagnosis\":\"诊断\"},"
                + "\"episodes\":[],\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[]}";
    }

    private static String structuredResultWithEpisode() {
        return "{\"summary\":{\"verdict\":\"team review\",\"primaryDiagnosis\":\"诊断\"},"
                + "\"episodes\":[{\"id\":\"E1\",\"startSec\":10,\"endSec\":20,"
                + "\"title\":\"关键回合\",\"analysis\":\"TACTICAL_TEXT\",\"playerKeys\":[]}],"
                + "\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[]}";
    }

    private static String structuredResultWithEpisodes(final int count) {
        final String episodes = IntStream.range(0, count)
                .mapToObj(index -> "{\"id\":\"E" + (index + 1)
                        + "\",\"startSec\":10,\"endSec\":20,\"title\":\"episode\","
                        + "\"analysis\":\"TACTICAL_TEXT\",\"playerKeys\":[]}")
                .collect(java.util.stream.Collectors.joining(","));
        return "{\"summary\":{\"verdict\":\"team review\",\"primaryDiagnosis\":\"诊断\"},"
                + "\"episodes\":[" + episodes + "],\"trainingSuggestions\":[],"
                + "\"reviewFocus\":[],\"highContributors\":[]}";
    }

    /**
     * 契约测试用 Gateway 替身：捕获传给 Gateway 的完整 {@link AiChatRequest}，
     * 返回可配置的 {@link AiChatResponse}；从不发起真实 HTTP。
     */
    static final class TeamGateway implements AiChatGateway {
        final List<AiChatRequest> requests = new CopyOnWriteArrayList<>();
        final List<String> teamCompletionSequence = new CopyOnWriteArrayList<>();
        final List<AiChatResponse> teamResponseSequence = new CopyOnWriteArrayList<>();
        volatile String nextCompletionText = structuredResult();
        volatile String preBattleCompletionText;
        volatile RuntimeException nextError;
        volatile boolean configured = true;

        @Override
        public boolean isConfigured() {
            return configured;
        }

        @Override
        public AiChatResponse chat(final AiChatRequest request) {
            requests.add(request);
            if (nextError != null) {
                throw nextError;
            }
            if ("PRE_BATTLE_STRATEGIC_PRIOR".equals(request.analysisMode())
                    && preBattleCompletionText != null) {
                return new AiChatResponse(preBattleCompletionText, "DeepSeek", "test-model",
                        0, 0, 0, 0, 0, 0, "stop");
            }
            if ("SINGLE_TEAM_BATTLE".equals(request.analysisMode())
                    || "SINGLE_TEAM_BATTLE_RECOVERY".equals(request.analysisMode())) {
                if (!teamResponseSequence.isEmpty()) {
                    return teamResponseSequence.remove(0);
                }
                if (!teamCompletionSequence.isEmpty()) {
                    return new AiChatResponse(teamCompletionSequence.remove(0), "DeepSeek", "test-model",
                            0, 0, 0, 0, 0, 0, "stop");
                }
            }
            return new AiChatResponse(nextCompletionText, "DeepSeek", "test-model",
                    0, 0, 0, 0, 0, 0, "stop");
        }
    }

    private static AiReplayAnalysisConfig config() {
        return new AiReplayAnalysisConfig(new ConservativeDeepSeekTokenEstimator(), "test-model",
                200000, 131072, 8192, 1000, true, "high", 315, 4096);
    }

    private TeamGateway gateway;
    private Logger teamReviewLogger;
    private ListAppender<ILoggingEvent> teamReviewAppender;

    @BeforeEach
    void setUp() {
        gateway = new TeamGateway();
        teamReviewLogger = (Logger) LoggerFactory.getLogger(TeamReplayAnalysisService.class);
        teamReviewAppender = new ListAppender<>();
        teamReviewAppender.start();
        teamReviewLogger.addAppender(teamReviewAppender);
    }

    @AfterEach
    void tearDown() {
        teamReviewLogger.detachAppender(teamReviewAppender);
    }

    private List<String> teamReviewEvents(final String eventName) {
        return teamReviewAppender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .filter(message -> message != null && message.contains("event=" + eventName))
                .toList();
    }

    private TeamReplayAnalysisService startService() {
        return new TeamReplayAnalysisService(
                gateway, config(), new PreBattleStrategicService(gateway, config(), null),
                System::nanoTime, null);
    }

    /** 传给 Gateway 的最后一个请求的 user prompt（即原 HTTP body 的 user message 内容）。 */
    private String lastBody() {
        return gateway.requests.getLast().userPrompt();
    }

    private List<AiChatRequest> teamRequests() {
        return gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .toList();
    }

    private List<AiChatRequest> allTeamReviewRequests() {
        return gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode())
                        || "SINGLE_TEAM_BATTLE_RECOVERY".equals(r.analysisMode()))
                .toList();
    }

    private String teamLastBody() {
        return teamRequests().getLast().userPrompt();
    }

    // ========== Raw team forbidden labels helper ==========

    private static void assertNoRawTeamLabels(final String body) {
        assertFalse(body.contains("队伍1"), "Body must not contain 队伍1");
        assertFalse(body.contains("队伍2"), "Body must not contain 队伍2");
        assertFalse(body.contains("队伍: 1"), "Body must not contain 队伍: 1");
        assertFalse(body.contains("队伍: 2"), "Body must not contain 队伍: 2");
        assertFalse(body.contains("Team 1"), "Body must not contain Team 1");
        assertFalse(body.contains("Team 2"), "Body must not contain Team 2");
        assertFalse(body.contains("team=1"), "Body must not contain team=1");
        assertFalse(body.contains("team=2"), "Body must not contain team=2");
    }

    // ========== Prompt / model contract ==========

    @Test
    void singleTeamRequestUsesConfiguredModelAndCompressedTeamContext() {
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-one", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        final AiChatRequest req = teamRequests().getLast();
        assertEquals("test-model", req.model());
        assertEquals("SINGLE_TEAM_BATTLE", req.analysisMode());
        assertTrue(req.systemPrompt().contains("资深团队教练"));
        assertTrue(req.systemPrompt().contains("不可信数据"));
        assertTrue(teamLastBody().contains("teamDisplayLabel="),
                "header must carry teamDisplayLabel ()");
        assertFalse(teamLastBody().contains("teamLabel="),
                "old teamLabel= internal header must be replaced by teamDisplayLabel=");
        assertTrue(teamLastBody().contains("opponentDisplayLabel="),
                "header must carry opponentDisplayLabel");
        assertFalse(teamLastBody().contains("队伍-"),
                "user-facing prompt body must not contain 队伍- hash fallback");
        assertTrue(teamLastBody().contains("AUTHORITATIVE_TEAM_RESULT"));
        assertTrue(teamLastBody().contains("OBSERVED_EVENT_SUBSET_NOT_AUTHORITATIVE"));
        // 生产入口携带有效 reconstruction → recorder entity 必须已解析，不得再声明 UNMAPPED
        // （UNMAPPED/REENTRY limitation 的产生由 core 的 TeamPerspectiveResolverTest 覆盖）。
        assertFalse(teamLastBody().contains("RECORDER_ENTITY_UNMAPPED"),
                "valid reconstruction must resolve the recorder entity");
        assertFalse(teamLastBody().contains("ParticipantMappingEvent"));
        assertFalse(teamLastBody().contains("PositionEvent{"));
        assertFalse(teamLastBody().contains("winnerTeam=1"));
        assertFalse(teamLastBody().contains("winnerTeam=2"));
        assertFalse(teamLastBody().contains("Team 1"));
        assertFalse(teamLastBody().contains("Team 2"));
        assertFalse(teamLastBody().contains("队伍1"));
        assertFalse(teamLastBody().contains("队伍2"));
        assertNoRawTeamLabels(teamLastBody());
    }

    @Test
    void singleTeamRequestContainsResultLabel() {
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-result", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertTrue(teamLastBody().contains("result=TEAM_WIN")
                        || teamLastBody().contains("result=TEAM_LOSS")
                        || teamLastBody().contains("result=DRAW_OR_UNKNOWN"),
                "Request body must contain result=TEAM_WIN/LOSS/DRAW_OR_UNKNOWN, not winnerTeam=");
        assertFalse(teamLastBody().contains("winnerTeam="));
    }

    @Test
    void teamPerspectiveInjectsCall1Prior() {
        gateway.preBattleCompletionText = PRIOR_JSON;
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-prior", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        final String body = teamLastBody();
        assertTrue(body.contains("PRE-BATTLE STRATEGIC PRIOR"),
                "Team review prompt must contain the Call #1 strategic prior");
        assertTrue(body.contains("TEAM_A（你的队伍"),
                "Prior must be relabeled to the perspective team");
        assertTrue(body.contains("开局左路集结"),
                "Prior hypotheses must be rendered");
        assertTrue(body.contains("战略假设（复盘对照：预期 vs 实际，考虑一波流等特殊战局）"),
                "Prior hypotheses section must ask for expectation-vs-actual comparison");
    }

    @Test
    void teamPerspectivePriorFailureStillReturnsReview() {
        gateway.preBattleCompletionText = "not a json object";
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-prior-fail", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertTrue(teamLastBody().contains("赛前战略基线不可用"),
                "Prior failure must degrade gracefully with an explicit unavailable marker");
    }

    @Test
    void singleTeamPerspectiveUsesSingleTeamContext() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertNotNull(result.teamReview());
        // 单文件 team single 路径：SINGLE_TEAM_CONTEXT，无 MULTI_TEAM_CONTEXT / PERSPECTIVE 分区
        assertTrue(teamLastBody().contains("SINGLE_TEAM_CONTEXT"),
                "Must use SINGLE_TEAM_CONTEXT");
        assertTrue(teamLastBody().contains("teamDisplayLabel="),
                "Single-team context must contain teamDisplayLabel");
        assertFalse(teamLastBody().contains("MULTI_TEAM_CONTEXT"),
                "Must NOT use MULTI_TEAM_CONTEXT");
        assertFalse(teamLastBody().contains("PERSPECTIVE 1"),
                "Single-team context must not contain PERSPECTIVE labels");
        assertFalse(teamLastBody().contains("PERSPECTIVE 2"),
                "Single-team context must not contain PERSPECTIVE labels");
    }

    @Test
    void teamAnalyzeGroupsExposesRenderedPreBattleSectionWhenPriorAvailable() {
        gateway.preBattleCompletionText = PRIOR_JSON;
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);
        assertEquals("team review", result.analysis(),
                "summary compatibility text must be unaffected by preBattleSection");
        assertNotNull(result.teamReview());
        final String section = result.preBattleSection();
        assertNotNull(section, "Call #1 prior must be rendered when available");
        assertTrue(section.contains("赛前预测"), "section must be user-visible Chinese");
        assertTrue(section.contains("我方画像"), "perspective team must be rendered as 我方画像 without hash label");
        assertFalse(section.contains("队伍-"), "PreBattle user-visible section must not contain 队伍- hash fallback");
        assertTrue(section.contains("重坦正面推进"), "teamA strengths must be readable");
        assertTrue(section.contains("关键对阵"), "key matchups must be present");
        assertFalse(section.contains("PRE-BATTLE"), "machine section header must be removed");
    }

    @Test
    void teamAnalyzeGroupsNullSectionWhenPriorUnavailable() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertNotNull(result.teamReview());
        assertNull(result.preBattleSection(),
                "failed Call #1 must not block the review, section stays null");
    }

    @Test
    void teamCall2ForwardsThinkingOptionFromConfig() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        analyzeTeam(service, fixture, AllowedLanguage.ZH);
        final AiChatRequest review = gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("team Call #2 request must reach the gateway"));
        assertTrue(review.thinkingEnabled(),
                "team Call #2 must forward call2ThinkingEnabled from config");
        assertEquals("high", review.reasoningEffort(),
                "team Call #2 must forward reasoningEffort when thinking enabled");
    }

    // ========== v0.5 structured result：salvage / recovery ==========

    @Test
    void invalidOptionalSchemaReferencesAreSalvagedWithoutRecovery() {
        gateway.teamCompletionSequence.add(optionalReferencesResult());
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("normalized-arena", "Ally", 1001L, 1);

        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_contract_salvage_completed").stream()
                .anyMatch(message -> message.contains("result=SUCCESS")));
    }

    @Test
    void salvageableUnknownFieldDoesNotTriggerRecovery() {
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":[],\"trainingSuggestions\":[],\"reviewFocus\":[],"
                + "\"highContributors\":[],\"unknown\":true}");
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("repair-arena", "Ally", 1001L, 1);

        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_contract_salvage_completed").stream()
                .anyMatch(message -> message.contains("root.unknown_field")));
    }

    @Test
    void incidentInvalidReferencesAreSalvagedWithoutRecovery() {
        final String initial = "{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":[{\"id\":\"E1\",\"startSec\":10,\"endSec\":20,"
                + "\"title\":\"title\",\"analysis\":\"TACTICAL_TEXT\",\"playerKeys\":[]}],"
                + "\"trainingSuggestions\":[],\"reviewFocus\":[],"
                + "\"highContributors\":[{\"playerKey\":\"UNKNOWN_PLAYER\","
                + "\"episodeId\":\"E1\",\"reason\":\"reason\"}],\"unknown\":true}";
        gateway.teamCompletionSequence.add(initial);
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("mixed-repair-arena", "Ally", 1001L, 1);

        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_contract_salvage_completed").stream()
                .anyMatch(message -> message.contains("removedReferences=1")));
    }

    @Test
    void partiallyInvalidEpisodePlayerKeysAreFilteredWithoutRecovery() {
        gateway.teamCompletionSequence.add(structuredResultWithEpisode()
                .replace("\"playerKeys\":[]", "\"playerKeys\":[\"P1\",\"UNKNOWN\",\"P1\"]"));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("partial-player-keys-arena",
                "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(List.of("P1", "P1"),
                result.teamReview().episodes().getFirst().playerKeys());
        assertEquals(1, allTeamReviewRequests().size());
    }

    @Test
    void recoveryUnknownFieldsAreRejectedWithoutThirdCall() {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\","
                + "\"unknown_field\":\"repair metadata\"},\"episodes\":[],"
                + "\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[],"
                + "\"unknown_field\":\"repair metadata\"}");
        final var service = startService();

        final AiUpstreamException error = assertThrows(AiUpstreamException.class,
                () -> analyzeTeam(service, teamResultWithRecon("recovery-unknown-arena",
                        "Ally", 1001L, 1), AllowedLanguage.ZH));

        assertEquals("AI_REVIEW_SCHEMA_FAILED", error.code());
        assertEquals(2, allTeamReviewRequests().size());
        assertTrue(allTeamReviewRequests().getLast().systemPrompt().contains("RECOVERY 严格约束"));
    }

    @Test
    void recoveryFailureStopsAfterExactlyTwoCallsWithNoUsableResult() {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add("not json");
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("repair-fail-arena", "Ally", 1001L, 1);

        final AiUpstreamException error = assertThrows(AiUpstreamException.class,
                () -> analyzeTeam(service, fixture, AllowedLanguage.ZH));

        assertEquals("AI_REVIEW_SCHEMA_FAILED", error.code());
        assertEquals(2, allTeamReviewRequests().size());
    }

    @Test
    void truncatedJsonWithReadableStringsTriggersOnlyOneRecovery() {
        gateway.teamCompletionSequence.add(
                "{\"summary\":{\"verdict\":\"本局开局过度分散，中期应该保持集火并尽快转场");
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("truncated-json-arena", "Ally",
                1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").stream()
                .anyMatch(message -> message.contains("reason=UNPARSEABLE_RESPONSE")));
    }

    @Test
    void oversizedInvalidJsonTriggersOneRecovery() {
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"" + "x".repeat(65_000));
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("long-plain-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
    }

    @Test
    void validStructuredJsonRemainsSingleCall() {
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("large-structured-arena", "Ally",
                1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").isEmpty());
    }

    @Test
    void recoveryLogsPrimaryCompletionLengthAndCumulativeTokens() {
        final String primaryCompletion = "{}";
        gateway.teamResponseSequence.add(new AiChatResponse(primaryCompletion, "DeepSeek", "test-model",
                11, 13, 24, 0, 0, 0, "stop"));
        gateway.teamResponseSequence.add(new AiChatResponse(structuredResult(), "DeepSeek", "test-model",
                17, 19, 36, 0, 0, 0, "stop"));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("recovery-metadata-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").stream()
                .anyMatch(message -> message.contains("primaryResponseLength=2")));
        assertEquals(AiResponseFormat.JSON_OBJECT, allTeamReviewRequests().getLast().responseFormat());
        assertTrue(teamReviewEvents("team_review_completed").stream()
                .anyMatch(message -> message.contains("result=RECOVERY_SUCCESS")
                        && message.contains("totalPromptTokens=28")
                        && message.contains("totalCompletionTokens=32")));
    }

    @Test
    void recoveryStructuredResultLogsCumulativeTokensAndUsesExactlyTwoCalls() {
        gateway.teamResponseSequence.add(new AiChatResponse("{}", "DeepSeek", "test-model",
                5, 7, 12, 0, 0, 0, "stop"));
        gateway.teamResponseSequence.add(new AiChatResponse(
                structuredResult(), "DeepSeek", "test-model",
                11, 13, 24, 0, 0, 0, "stop"));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("recovery-plain-text-arena", "Ally",
                1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
        assertTrue(teamReviewEvents("team_review_completed").stream()
                .anyMatch(message -> message.contains("result=RECOVERY_SUCCESS")
                        && message.contains("totalPromptTokens=16")
                        && message.contains("totalCompletionTokens=20")));
    }

    @Test
    void recoveryRunsOnlyWhenPrimaryHasNoUsableContent() {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("recovery-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").stream()
                .anyMatch(message -> message.contains("reason=MINIMUM_CONTRACT_UNRECOVERABLE")));
    }

    @Test
    void episodeCardinalitySalvageUsesOnlyPrimaryCall() {
        gateway.teamCompletionSequence.add(structuredResultWithEpisodes(
                TeamAiReviewResultParser.MAX_EPISODES + 1));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("cardinality-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(TeamAiReviewResultParser.MAX_EPISODES, result.teamReview().episodes().size());
        assertEquals(1, allTeamReviewRequests().size(), "cardinality salvage must not trigger recovery");
    }

    @Test
    void wrongEpisodesTypeTriggersExactlyOneRecovery() {
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":\"wrong-type\",\"trainingSuggestions\":[],\"reviewFocus\":[],"
                + "\"highContributors\":[]}");
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("wrong-type-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
    }

    @ParameterizedTest
    @ValueSource(strings = {"EN", "RU"})
    void recoveryUserInstructionFollowsAllowedLanguage(final String languageName) {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add(structuredResult());
        final AllowedLanguage language = AllowedLanguage.valueOf(languageName);
        final var service = startService();

        analyzeTeam(service, teamResultWithRecon("localized-recovery-arena", "Ally", 1001L, 1),
                language);

        final String prompt = allTeamReviewRequests().getLast().userPrompt();
        assertFalse(prompt.contains("这是唯一一次 recovery"));
        assertTrue(prompt.contains(language == AllowedLanguage.EN
                ? "This is the only recovery attempt"
                : "Это единственная попытка recovery"));
    }

    @Test
    void teamStreamingEmitsEvidenceDoneBeforeReviewCall() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final List<String> stages = new CopyOnWriteArrayList<>();
        final List<String> tokens = new CopyOnWriteArrayList<>();
        service.analyzeTeam(fixture.battle(), fixture.reconstruction(), AllowedLanguage.ZH,
                new AiReviewStreamListener() {
            @Override
            public void onStage(final String stage) {
                stages.add(stage);
            }

            @Override
            public void onToken(final String delta) {
                tokens.add(delta);
            }
        });
        assertTrue(stages.contains("evidence_done"),
                "team path must emit evidence_done so the stage indicator advances: " + stages);
        assertTrue(gateway.requests.stream()
                        .anyMatch(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode())),
                "team Call #2 request must be issued");
    }

    @Test
    void duplicateTeamMemberLimitationRendersIntoTeamPrompt() {
        // 重复 accountId 的 context 无法由 analyzeTeam 的 TeamContextBuilder 产生，因此
        // 直接覆盖 production 使用的两段契约：RosterEvidence 检测 + Team Prompt 渲染。
        final SingleTeamBattleAnalysisContext context = duplicateMemberContext();
        final TeamRosterResolver.RosterEvidence evidence = TeamRosterResolver.RosterEvidence.from(context);
        assertTrue(evidence.limitations().contains("DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS"),
                "RosterEvidence must detect duplicate member account ids: " + evidence.limitations());

        final String body = TeamAiPromptBuilder.single(context, evidence.limitations(), null,
                new ConservativeDeepSeekTokenEstimator(), 200_000).content();
        assertTrue(body.contains("unitLimitations=["),
                "Body must use the unitLimitations= prefix");
        assertTrue(unitLimitationsOf(body).contains("DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS"),
                "unitLimitations must contain DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS, got: "
                        + unitLimitationsOf(body));
        assertFalse(body.contains("mandatory="),
                "Body must not use old mandatory= prefix");
        assertNoRawTeamLabels(body);
    }

    @Test
    void singleTeamPerspectiveProducesOneRequest() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        analyzeTeam(service, fixture, AllowedLanguage.ZH);
        final List<AiChatRequest> teamRequests = teamRequests();
        assertEquals(1, teamRequests.size(),
                "Single team perspective must produce exactly 1 team request");

        final String first = teamRequests.get(0).userPrompt();
        // file= 恒为空（生产入口不再携带 fileName），改为断言「录像者所在队伍即视角队伍」。
        assertTrue(perspectiveBodySection(first).contains("Ally"),
                "Request must be the ally perspective");
        assertFalse(perspectiveBodySection(first).contains("Enemy"),
                "Ally perspective body must not contain the opposing team's members");
        assertTrue(first.contains("OPPOSING_TEAM_LINEUP_AUTHORITATIVE"),
                "Ally perspective must still describe the opposing lineup");
        assertTrue(first.contains("Enemy"),
                "The opposing team's players are allowed as OPPOSING_TEAM_LINEUP evidence");
    }

    /**
     * 取 perspective 主体证据（对方阵容段之前的部分）。
     */
    private static String perspectiveBodySection(final String body) {
        final int idx = body.indexOf("OPPOSING_TEAM_LINEUP_AUTHORITATIVE");
        return idx < 0 ? body : body.substring(0, idx);
    }

    private static String optionalReferencesResult() {
        return "{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":[{\"id\":\"E1\",\"startSec\":10,\"endSec\":20,"
                + "\"title\":\"title\",\"analysis\":\"TACTICAL_TEXT\","
                + "\"playerKeys\":[\"UNKNOWN\"]}],"
                + "\"trainingSuggestions\":[{\"title\":\"suggestion\",\"content\":\"content\",\"episodeId\":\"E99\"}],"
                + "\"reviewFocus\":[{\"playerKey\":\"UNKNOWN\",\"episodeId\":\"E1\",\"reason\":\"reason\"}],"
                + "\"highContributors\":[{\"playerKey\":\"UNKNOWN\",\"episodeId\":\"E1\",\"reason\":\"reason\"}]}";
    }

    private static SingleTeamBattleAnalysisContext duplicateMemberContext() {
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1,
                List.of(
                        new TeamMemberFeatureSet(List.of(), 1001L, "PlayerA", 0L, "", 1,
                                DecodeConfidence.UNKNOWN, 1000, 500, 0, 0, 1, true, null,
                                List.of(), List.of(), List.of(), List.of()),
                        new TeamMemberFeatureSet(List.of(), 1001L, "PlayerB", 0L, "", 1,
                                DecodeConfidence.UNKNOWN, 800, 300, 0, 0, 0, false, 180.0,
                                List.of(), List.of(), List.of(), List.of())),
                new TeamAggregateResult(2, 1800, 800, 0, 0, 1, 1, 1,
                        180.0, 180.0, 180.0, true),
                TeamObservedAggregate.empty(),
                List.of(), List.of(), List.of(), List.of(),
                TeamFeatureCoverage.empty(),
                List.of(), true);
        return new SingleTeamBattleAnalysisContext(
                "dup-test", null, "dup-test.wotbreplay",
                BattleCategory.TRAINING, new Battle(), 1,
                features, null, List.of(), null);
    }

    // ========== Test helpers ==========

    /** battle + reconstruction 测试夹具：AI 入口直接接收领域事实。 */
    private record TeamFixture(Battle battle, ReplayReconstruction reconstruction) {
    }

    private static AiReviewDonePayload analyzeTeam(
            final TeamReplayAnalysisService service, final TeamFixture fixture,
            final AllowedLanguage language) {
        return service.analyzeTeam(fixture.battle(), fixture.reconstruction(), language,
                AiReviewStreamListener.NOOP);
    }

    private static String unitLimitationsOf(final String section) {
        if (section == null) return "";
        final int start = section.indexOf("unitLimitations=[");
        if (start < 0) return "";
        final int end = section.indexOf(']', start);
        return end < 0 ? section.substring(start) : section.substring(start, end + 1);
    }

    private static TeamFixture teamResult(
            final String arenaId,
            final String recorderNickname, final long recorderAccountId,
            final int recorderTeam) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = recorderNickname;
        final PlayerResult ally = player(
                recorderTeam == 1 ? recorderAccountId : 1001L,
                recorderTeam == 1 ? recorderNickname : "Ally", 1, 1_500);
        final PlayerResult enemy = player(
                recorderTeam == 2 ? recorderAccountId : 2001L,
                recorderTeam == 2 ? recorderNickname : "Enemy", 2, 900);
        battle.players = List.of(ally, enemy);
        return new TeamFixture(battle, null);
    }

    /**
     * {@link #teamResult} 的有效重建变体：通过 Team canonical Timeline hard gate
     * —— analyzeTeam 在 LLM 调用前要求 timeline 可构建。
     */
    private static TeamFixture teamResultWithRecon(
            final String arenaId,
            final String recorderNickname, final long recorderAccountId,
            final int recorderTeam) {
        final TeamFixture base = teamResult(
                arenaId, recorderNickname, recorderAccountId, recorderTeam);
        return new TeamFixture(base.battle(), teamReconstruction(base.battle()));
    }

    /** 由 battle roster 派生最小有效重建（IDENTIFIED 时钟 + 逐 player 映射/位置/血量）。 */
    private static ReplayReconstruction teamReconstruction(final Battle battle) {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(8, 8, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final List<ReplayEvent> events = new ArrayList<>();
        int seq = 0;
        int eid = 1;
        for (final PlayerResult p : battle.players) {
            if (p == null || p.accountId <= 0 || p.team <= 0) {
                continue;
            }
            events.add(new ParticipantMappingEvent(seq++, new ReplayTimestamp(1000f, null), 8,
                    DecodeConfidence.EXACT, eid, p.accountId));
            final float side = p.team == 1 ? 10f : -10f;
            events.add(new PositionChangedEvent(seq++, new ReplayTimestamp(1000f, null), 10,
                    DecodeConfidence.EXACT, eid, 0, 0, side, 0f, side, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
            events.add(new HealthChangedEvent(seq++, new ReplayTimestamp(1000f, null), 7,
                    DecodeConfidence.EXACT, eid, p.survived ? 1500 : 0, null, p.survived));
            eid++;
        }
        return new ReplayReconstruction(meta, header, 300f, 1000f, List.of(),
                events, List.of(), BattleStateSnapshot.empty(), coverage, diag);
    }

    private static PlayerResult player(
            final long accountId, final String nickname,
            final int team, final int damage) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.nickname = nickname;
        p.team = team;
        p.damageDealt = damage;
        p.damageReceived = 700;
        p.damageAssisted = 250;
        p.damageBlocked = 300;
        p.kills = team == 1 ? 2 : 1;
        p.survived = team == 1;
        p.deathTimeMillis = team == 1 ? 0 : 180_000;
        p.settlementLifeTimeSec = p.deathTimeMillis / 1000.0;
        return p;
    }
}
