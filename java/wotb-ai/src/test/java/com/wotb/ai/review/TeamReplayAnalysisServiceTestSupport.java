package com.wotb.ai.review;

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
import com.wotb.ai.gateway.AiChatGateway;
import com.wotb.ai.gateway.AiChatRequest;
import com.wotb.ai.gateway.AiChatResponse;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertFalse;

/** Shared gateway, logger, and replay fixtures for the team analysis contract suites. */
class TeamReplayAnalysisServiceTestSupport {

    protected static final String PRIOR_JSON = """
            {
              "teamA": {"composition": {"mobility": "HIGH"}, "strengths": ["重坦正面推进"], "weaknesses": ["w1"], "preferredPlans": ["左路集结"]},
              "teamB": {"composition": {"mobility": "MEDIUM"}, "strengths": ["中坦机动拉扯"], "weaknesses": ["w2"], "preferredPlans": ["中路控制"]},
              "keyMatchups": [{"area": "GRID_REGION_5", "advantage": "TEAM_A", "reason": "r"}],
              "strategicWinConditions": [{"team": "TEAM_A", "condition": "c"}],
              "hypotheses": [{"id": "H1", "claim": "开局左路集结", "reason": "rs"}]
            }""";

    protected static String structuredResult() {
        return "{\"summary\":{\"verdict\":\"team review\",\"primaryDiagnosis\":\"诊断\"},"
                + "\"episodes\":[],\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[]}";
    }

    protected static String structuredResultWithEpisode() {
        return "{\"summary\":{\"verdict\":\"team review\",\"primaryDiagnosis\":\"诊断\"},"
                + "\"episodes\":[{\"id\":\"E1\",\"startSec\":10,\"endSec\":20,"
                + "\"title\":\"关键回合\",\"analysis\":\"TACTICAL_TEXT\",\"playerKeys\":[]}],"
                + "\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[]}";
    }

    protected static String structuredResultWithEpisodes(final int count) {
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
    protected static final class TeamGateway implements AiChatGateway {
        protected final List<AiChatRequest> requests = new CopyOnWriteArrayList<>();
        protected final List<String> teamCompletionSequence = new CopyOnWriteArrayList<>();
        protected final List<AiChatResponse> teamResponseSequence = new CopyOnWriteArrayList<>();
        protected volatile String nextCompletionText = structuredResult();
        protected volatile String preBattleCompletionText;
        protected volatile RuntimeException nextError;
        protected volatile boolean configured = true;

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

    protected static AiReplayAnalysisConfig config() {
        return new AiReplayAnalysisConfig(new ConservativeDeepSeekTokenEstimator(), "test-model",
                200000, 131072, 8192, 1000, true, "high", 315, 4096);
    }

    protected TeamGateway gateway;
    protected Logger teamReviewLogger;
    protected ListAppender<ILoggingEvent> teamReviewAppender;

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

    protected List<String> teamReviewEvents(final String eventName) {
        return teamReviewAppender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .filter(message -> message != null && message.contains("event=" + eventName))
                .toList();
    }

    protected TeamReplayAnalysisService startService() {
        return new TeamReplayAnalysisService(
                gateway, config(), new PreBattleStrategicService(gateway, config(), null),
                System::nanoTime, null);
    }

    /** 传给 Gateway 的最后一个请求的 user prompt（即原 HTTP body 的 user message 内容）。 */
    protected String lastBody() {
        return gateway.requests.getLast().userPrompt();
    }

    protected List<AiChatRequest> teamRequests() {
        return gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .toList();
    }

    protected List<AiChatRequest> allTeamReviewRequests() {
        return gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode())
                        || "SINGLE_TEAM_BATTLE_RECOVERY".equals(r.analysisMode()))
                .toList();
    }

    protected String teamLastBody() {
        return teamRequests().getLast().userPrompt();
    }

    // ========== Raw team forbidden labels helper ==========

    protected static void assertNoRawTeamLabels(final String body) {
        assertFalse(body.contains("队伍1"), "Body must not contain 队伍1");
        assertFalse(body.contains("队伍2"), "Body must not contain 队伍2");
        assertFalse(body.contains("队伍: 1"), "Body must not contain 队伍: 1");
        assertFalse(body.contains("队伍: 2"), "Body must not contain 队伍: 2");
        assertFalse(body.contains("Team 1"), "Body must not contain Team 1");
        assertFalse(body.contains("Team 2"), "Body must not contain Team 2");
        assertFalse(body.contains("team=1"), "Body must not contain team=1");
        assertFalse(body.contains("team=2"), "Body must not contain team=2");
    }


    /**
     * 取 perspective 主体证据（对方阵容段之前的部分）。
     */
    protected static String perspectiveBodySection(final String body) {
        final int idx = body.indexOf("OPPOSING_TEAM_LINEUP_AUTHORITATIVE");
        return idx < 0 ? body : body.substring(0, idx);
    }

    protected static String optionalReferencesResult() {
        return "{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":[{\"id\":\"E1\",\"startSec\":10,\"endSec\":20,"
                + "\"title\":\"title\",\"analysis\":\"TACTICAL_TEXT\","
                + "\"playerKeys\":[\"UNKNOWN\"]}],"
                + "\"trainingSuggestions\":[{\"title\":\"suggestion\",\"content\":\"content\",\"episodeId\":\"E99\"}],"
                + "\"reviewFocus\":[{\"playerKey\":\"UNKNOWN\",\"episodeId\":\"E1\",\"reason\":\"reason\"}],"
                + "\"highContributors\":[{\"playerKey\":\"UNKNOWN\",\"episodeId\":\"E1\",\"reason\":\"reason\"}]}";
    }

    protected static SingleTeamBattleAnalysisContext duplicateMemberContext() {
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
    protected record TeamFixture(Battle battle, ReplayReconstruction reconstruction) {
    }

    protected static AiReviewDonePayload analyzeTeam(
            final TeamReplayAnalysisService service, final TeamFixture fixture,
            final AllowedLanguage language) {
        return service.analyzeTeam(fixture.battle(), fixture.reconstruction(), language,
                AiReviewStreamListener.NOOP);
    }

    protected static String unitLimitationsOf(final String section) {
        if (section == null) return "";
        final int start = section.indexOf("unitLimitations=[");
        if (start < 0) return "";
        final int end = section.indexOf(']', start);
        return end < 0 ? section.substring(start) : section.substring(start, end + 1);
    }

    protected static TeamFixture teamResult(
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
    protected static TeamFixture teamResultWithRecon(
            final String arenaId,
            final String recorderNickname, final long recorderAccountId,
            final int recorderTeam) {
        final TeamFixture base = teamResult(
                arenaId, recorderNickname, recorderAccountId, recorderTeam);
        return new TeamFixture(base.battle(), teamReconstruction(base.battle()));
    }

    /** 由 battle roster 派生最小有效重建（IDENTIFIED 时钟 + 逐 player 映射/位置/血量）。 */
    protected static ReplayReconstruction teamReconstruction(final Battle battle) {
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

    protected static PlayerResult player(
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
