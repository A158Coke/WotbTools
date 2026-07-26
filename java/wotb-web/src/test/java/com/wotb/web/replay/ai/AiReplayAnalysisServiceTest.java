package com.wotb.web.replay.ai;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAnalysisUnitReport;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class AiReplayAnalysisServiceTest {

    private static final String SUCCESS_RESPONSE =
            "{\"choices\":[{\"message\":{\"content\":\"team review\"}}]}";

    private HttpServer server;
    private final AtomicReference<String> requestBody = new AtomicReference<>("");
    private final AtomicReference<String> authorization = new AtomicReference<>("");
    private int responseStatus = 200;
    private String responseBody = SUCCESS_RESPONSE;
    private long responseDelayMillis;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
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

    // ========== PlayerResult.team snapshot helpers ==========

    private static List<Integer> playerTeams(final Battle battle) {
        return battle.players.stream()
                .map(player -> player.team)
                .toList();
    }

    private static void assertPlayerResultTeams(
            final List<Integer> expectedTeams,
            final Battle battle
    ) {
        assertEquals(
                expectedTeams,
                playerTeams(battle),
                "PlayerResult.team must not be modified"
        );
    }

    // ========== Basic tests ==========

    @Test
    void notConfiguredThrowsSpecificException() {
        final var service = new AiReplayAnalysisService("", "", "", 5);
        assertThrows(AiNotConfiguredException.class,
                () -> service.analyze(new Battle(), null));
    }

    @Test
    void configuredWhenApiKeyIsPresent() throws IOException {
        final var service = startService(2);
        assertTrue(service.isConfigured());
    }

    @Test
    void singleTeamRequestUsesConfiguredModelAndCompressedTeamContext() throws IOException {
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "training.wotbreplay", "arena-one", "Ally", 1001L, 1)))
                        .getFirst());
        final var result = service.analyzeSingleTeamContext(context);
        assertEquals("team review", result.analysis());
        assertEquals("test-model", result.model());
        assertEquals("Bearer test-key", authorization.get());
        assertTrue(requestBody.get().contains("\"model\":\"test-model\""));
        assertTrue(requestBody.get().contains("teamLabel="));
        assertTrue(requestBody.get().contains("AUTHORITATIVE_TEAM_RESULT"));
        assertTrue(requestBody.get().contains("OBSERVED_EVENT_SUBSET_NOT_AUTHORITATIVE"));
        assertTrue(requestBody.get().contains("RECORDER_ENTITY_UNMAPPED"));
        assertTrue(requestBody.get().contains("不可信数据"));
        assertFalse(requestBody.get().contains("ParticipantMappingEvent"));
        assertFalse(requestBody.get().contains("PositionEvent{"));
    }

    @Test
    void multiTeamRequestKeepsOpposingPerspectivesIndependent() throws IOException {
        final var service = startService(2);
        final List<ReplayPerspectiveGroup> groups = teamGroups(List.of(
                teamResult("ally.wotbreplay", "shared-arena", "Ally", 1001L, 1),
                teamResult("enemy.wotbreplay", "shared-arena", "Enemy", 2001L, 2)));
        final var result = service.analyzeTeamGroups(groups);
        assertEquals("team review", result.analysis().analysis());
        assertEquals(2, result.units().size());
        assertTrue(requestBody.get().contains("MULTI_TEAM_CONTEXT"));
        assertTrue(requestBody.get().contains("teamLabel="));
        // Two perspectives should have distinct team labels
        assertTrue(requestBody.get().contains("PERSPECTIVE 1"));
        assertTrue(requestBody.get().contains("PERSPECTIVE 2"));
    }

    @Test
    void promptTruncationIsReportedInAnalysisUnit() throws IOException {
        final var service = startService(2);
        final var result = service.analyzeTeamGroups(
                teamGroups(List.of(manyMemberTeamResult())));
        final TeamAnalysisUnitReport report =
                (TeamAnalysisUnitReport) result.units().getFirst().report();
        assertTrue(report.limitations().contains("AI_INPUT_TRUNCATED"));
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 429, 503})
    void providerHttpFailuresUseStableErrorCodes(final int status) throws IOException {
        final String expectedCode = switch (status) {
            case 400 -> "AI_INVALID_REQUEST";
            case 401 -> "AI_AUTHENTICATION_ERROR";
            case 429 -> "AI_RATE_LIMITED";
            case 503 -> "AI_UPSTREAM_UNAVAILABLE";
            default -> throw new IllegalArgumentException("Unexpected status: " + status);
        };
        responseStatus = status;
        responseBody = "{\"error\":\"provider detail token=secret-value\"}";
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "failure.wotbreplay", "failure-arena", "Ally", 1001L, 1)))
                        .getFirst());
        final var error = assertThrows(
                AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));
        assertEquals(expectedCode, error.code());
        assertEquals(status, error.providerStatus());
        assertNotNull(error.correlationId());
        assertTrue(StringUtils.hasText(error.correlationId()));
        assertEquals(expectedCode, error.getMessage());
    }

    @Test
    void providerContextLengthFailureUsesSpecificCode() throws IOException {
        responseStatus = 400;
        responseBody = "{\"error\":\"maximum context length exceeded\"}";
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "large.wotbreplay", "large-arena", "Ally", 1001L, 1)))
                        .getFirst());
        final var error = assertThrows(
                AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));
        assertEquals("AI_CONTEXT_TOO_LARGE", error.code());
    }

    @Test
    void emptyCompletionThrowsStableCode() throws IOException {
        responseBody = "{\"choices\":[{\"message\":{\"content\":\"\"}}]}";
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "empty.wotbreplay", "empty-arena", "Ally", 1001L, 1)))
                        .getFirst());
        final var error = assertThrows(AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));
        // Jackson may parse null content as AI_RESPONSE_INVALID depending on version
        assertTrue(error.code().equals("AI_EMPTY_RESPONSE")
                        || error.code().equals("AI_RESPONSE_INVALID"),
                "Should produce a stable error code, got: " + error.code());
    }

    @Test
    void malformedJsonCompletionUsesStableCode() throws IOException {
        responseBody = "{\"choices\":[{";
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "malformed.wotbreplay", "malformed-arena", "Ally", 1001L, 1)))
                        .getFirst());
        final var error = assertThrows(AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));
        assertEquals("AI_RESPONSE_INVALID", error.code());
    }

    @Test
    void rosterCoverageUsesSeventyFivePercentAsInclusiveBoundary() {
        final List<Long> seventyFive = IntStream.rangeClosed(1, 75)
                .mapToObj(value -> (long) value).toList();
        final List<Long> seventyFour = seventyFive.subList(0, 74);
        assertTrue(AiReplayAnalysisService.hasConsistentRoster(List.of(
                rosterSummary("a", 100, seventyFive),
                rosterSummary("b", 100, seventyFive))));
        assertFalse(AiReplayAnalysisService.hasConsistentRoster(List.of(
                rosterSummary("a", 100, seventyFour),
                rosterSummary("b", 100, seventyFour))));
    }

    @Test
    void rosterJaccardUsesPointSixAsInclusiveBoundary() {
        assertTrue(AiReplayAnalysisService.hasConsistentRoster(List.of(
                rosterSummary("a", 5, List.of(1L, 2L, 3L, 4L)),
                rosterSummary("b", 5, List.of(1L, 2L, 3L, 5L)))));
        assertFalse(AiReplayAnalysisService.hasConsistentRoster(List.of(
                rosterSummary("a", 5, List.of(1L, 2L, 3L, 4L)),
                rosterSummary("b", 5, List.of(1L, 2L, 5L, 6L)))));
    }

    @Test
    void playerSummaryFallbackStillCallsProviderOnce() {
        final var service = spy(new AiReplayAnalysisService(
                "test-key", "https://fake.invalid", "test-model", 5));
        doReturn(new AiReplayAnalysisService.AnalyzeResult(
                "summary analysis", "test-model", List.of()))
                .when(service).analyze(any(), any());
        service.analyzePlayerOrFallback(randomResultWithoutReconstruction());
        verify(service, times(1)).analyze(any(), any());
        verify(service, never()).analyzePlayerContext(any());
    }

    // ========== Full feature path (analyzePlayerContext) ==========

    @Test
    void fullFeaturePath_recorderTeam1_resolvedEntityLine() throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(1, 1);
        final List<Integer> originalTeams = playerTeams(battle);
        final var ctx = buildPlayerContext(battle);
        assertTrue(ctx.recorder().resolved(), "Recorder mapping must be resolved");

        service.analyzePlayerContext(ctx);

        assertPlayerResultTeams(originalTeams, battle);
        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("录像者 entity 已映射, 特征集可用"),
                "Should enter resolved recorder branch");
        assertTrue(body.contains("录像者 entity: 账号 1001 | 侧=友方 | 车辆 ID: 123"),
                "Entity line must show friendly side, not raw team");
        assertTrue(body.contains("=== 友方 ==="), "Should have friendly roster");
        assertTrue(body.contains("- 友方 RecorderPlayer"), "RecorderPlayer should be friendly");
        assertTrue(body.contains("=== 敌方 ==="), "Should have enemy roster");
        assertTrue(body.contains("- 敌方 OtherPlayer"), "OtherPlayer should be enemy");
    }

    @Test
    void fullFeaturePath_recorderTeam2_stillFriendly() throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(2, 2);
        final List<Integer> originalTeams = playerTeams(battle);
        final var ctx = buildPlayerContext(battle);
        assertTrue(ctx.recorder().resolved(), "Recorder mapping must be resolved");

        service.analyzePlayerContext(ctx);

        assertPlayerResultTeams(originalTeams, battle);
        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("录像者 entity: 账号 1001 | 侧=友方 | 车辆 ID: 123"),
                "Recorder in team 2 must still show friendly side");
        assertTrue(body.contains("- 友方 RecorderPlayer"), "RecorderPlayer should be friendly");
        assertTrue(body.contains("- 敌方 OtherPlayer"), "OtherPlayer(raw team 1) should be enemy");
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 0, 3, Integer.MAX_VALUE})
    void fullFeaturePath_invalidRecorderTeam_unknownSide(final int invalidTeam) throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(1, 1);
        battle.players.getFirst().team = invalidTeam;
        battle.recorder = battle.players.getFirst().nickname;
        final List<Integer> originalTeams = playerTeams(battle);
        final var ctx = buildPlayerContext(battle);
        assertTrue(ctx.recorder().resolved(), "Recorder mapping must still be resolved");

        service.analyzePlayerContext(ctx);

        assertPlayerResultTeams(originalTeams, battle);
        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("录像者 entity: 账号 1001 | 侧=未知 | 车辆 ID: 123"),
                "Invalid team " + invalidTeam + " must show unknown side");
        assertTrue(body.contains("结果: 平局或未知"),
                "Invalid team " + invalidTeam + " must produce draw/unknown winner");
        assertTrue(body.contains("=== 未知 ==="), "All players should be in unknown roster");
    }

    // ========== Fallback path ==========

    @Test
    void fallback_recorderTeam1_hasExactRoster() throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(1, 1);
        final List<Integer> originalTeams = playerTeams(battle);

        service.analyze(battle, null);

        assertPlayerResultTeams(originalTeams, battle);
        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("录像者: RecorderPlayer"), "Should contain recorder line");
        assertTrue(body.contains("| 侧=友方"), "Recorder should show friendly side");
        assertTrue(body.contains("=== 友方 ==="), "Should have friendly roster");
        assertTrue(body.contains("- 友方 RecorderPlayer"), "RecorderPlayer should be friendly");
        assertTrue(body.contains("=== 敌方 ==="), "Should have enemy roster");
        assertTrue(body.contains("- 敌方 OtherPlayer"), "OtherPlayer should be enemy");
    }

    @Test
    void fallback_recorderTeam2_stillFriendly() throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(2, 2);
        final List<Integer> originalTeams = playerTeams(battle);

        service.analyze(battle, null);

        assertPlayerResultTeams(originalTeams, battle);
        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("| 侧=友方"), "Recorder in team 2 should still show friendly side");
        assertTrue(body.contains("- 友方 RecorderPlayer"), "RecorderPlayer should be friendly");
        assertTrue(body.contains("- 敌方 OtherPlayer"), "OtherPlayer(raw team 1) should be enemy");
    }

    // ========== Multi-player tests ==========

    @Test
    void multiPlayer_threeBattles_exactStats() throws IOException {
        final var service = startService(2);
        final Battle battleA = makePlayerBattle(1, 1);
        battleA.winnerTeam = 1;
        final Battle battleB = makePlayerBattle(2, 1);
        battleB.winnerTeam = 1;
        final Battle battleC = makePlayerBattle(2, 1);
        battleC.winnerTeam = null;

        service.analyzeMulti(List.of(battleA, battleB, battleC));

        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("友方获胜"), "Battle A should be friendly win");
        assertTrue(body.contains("敌方获胜"), "Battle B should be enemy win");
        assertTrue(body.contains("平局或未知"), "Battle C should be draw/unknown");
        assertTrue(body.contains("可统计场数: 3"), "Should have 3 stat-able battles");
        assertTrue(body.contains("已知胜负场数: 2"), "Should have 2 decided battles");
        assertTrue(body.contains("友方获胜场数: 1"), "Should have 1 friendly win");
        assertTrue(body.contains("敌方获胜场数: 1"), "Should have 1 enemy win");
        assertTrue(body.contains("平局或未知场数: 1"), "Should have 1 draw/unknown");
        assertTrue(body.contains("胜率: 50%"), "Win rate should be 1/2 = 50%");
    }

    @Test
    void multiPlayer_allDraw_winRateUncomputable() throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(1, 1);
        battle.winnerTeam = null;

        service.analyzeMulti(List.of(battle));

        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("平局或未知"), "Should output draw/unknown");
        assertTrue(body.contains("已知胜负场数: 0"), "Should have 0 decided");
        assertTrue(body.contains("胜率: 无法计算"), "Win rate uncomputable");
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 0, 3, Integer.MAX_VALUE})
    void multiPlayer_invalidWinnerTeam_drawOrUnknown(final int invalidWinner) throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(1, 1);
        battle.winnerTeam = invalidWinner;

        service.analyzeMulti(List.of(battle));

        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("| 平局或未知 |"),
                "Invalid winner=" + invalidWinner + " must produce draw/unknown per-battle");
        assertTrue(body.contains("已知胜负场数: 0"), "Invalid winner must not be decided");
        assertTrue(body.contains("平局或未知场数: 1"), "Invalid winner must be draw");
        assertTrue(body.contains("胜率: 无法计算"), "Invalid winner makes win rate uncomputable");
    }

    @Test
    void multiPlayer_invalidRecorderTeam_unknownSide() throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(1, 1);
        battle.players.getFirst().team = -1;
        battle.recorder = battle.players.getFirst().nickname;

        service.analyzeMulti(List.of(battle));

        final String body = requestBody.get();
        assertNoRawTeamLabels(body);
        assertTrue(body.contains("侧=未知"), "Invalid recorder must show unknown side");
        assertTrue(body.contains("平局或未知"), "Invalid recorder must produce draw/unknown result");
    }

    @Test
    void multiPlayer_playerResultTeamUnchanged() throws IOException {
        final var service = startService(2);
        final Battle battle = makePlayerBattle(1, 1);
        final List<Integer> originalTeams = playerTeams(battle);

        service.analyzeMulti(List.of(battle));

        assertPlayerResultTeams(originalTeams, battle);
    }

    // ========== Test helpers ==========

    private static SinglePlayerBattleAnalysisContext buildPlayerContext(final Battle battle) {
        final PlayerResult rec = battle.recorderResult();
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(), List.of(), List.of(), List.of(), List.of(), true);
        // Recorder mapping must have entityId != null and EXACT confidence to be resolved()
        final RecorderEntityMapping recorderMapping = new RecorderEntityMapping(
                rec != null ? rec.accountId : 0L,
                501,                 // vehicleId
                42,                  // entityId (non-null → resolved)
                "RecorderPlayer",    // nickname
                rec != null && PlayerSideResolver.isValidRawTeam(rec.team) ? rec.team : null,
                123,                 // tankId
                DecodeConfidence.EXACT
        );
        final ReplayCoverage coverage = new ReplayCoverage(
                true, 100, 100, 0, 0, 0, 1.0, Map.of());
        return new SinglePlayerBattleAnalysisContext(
                null, battle, features, recorderMapping, coverage, List.of("TEST_LIMITATION"));
    }

    private static Battle makePlayerBattle(final int recorderTeam, final int winnerTeam) {
        final Battle battle = new Battle();
        battle.arenaId = "test-arena";
        battle.mapName = "test_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.winnerTeam = winnerTeam;
        final PlayerResult rec = player(1001L, "RecorderPlayer", recorderTeam, 2000);
        rec.tankId = 123;
        final PlayerResult other = player(2001L, "OtherPlayer",
                recorderTeam == 1 ? 2 : 1, 1500);
        battle.players = List.of(rec, other);
        battle.recorder = rec.nickname;
        return battle;
    }

    private AiReplayAnalysisService startService(final int timeoutSec) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", this::handleRequest);
        server.start();
        final String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        return new AiReplayAnalysisService(
                "test-key", baseUrl, "test-model", timeoutSec);
    }

    private void handleRequest(final HttpExchange exchange) throws IOException {
        requestBody.set(new String(
                exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
        if (responseDelayMillis > 0) {
            try {
                Thread.sleep(responseDelayMillis);
            } catch (final InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        final byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        try {
            exchange.sendResponseHeaders(responseStatus, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }

    private static List<ReplayPerspectiveGroup> teamGroups(
            final List<ReplayProcessingResult> results) {
        return new BatchAnalyzer().analyze(results).groups();
    }

    private static ReplayProcessingResult teamResult(
            final String fileName, final String arenaId,
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
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                fileName, ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("hash-" + fileName, arenaId, "11.0", "team_map",
                        recorderAccountId, null),
                battle, null, null, capabilities, null, null);
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
        return p;
    }

    private static ReplayProcessingResult randomResultWithoutReconstruction() {
        final Battle battle = new Battle();
        battle.arenaId = "random-arena";
        battle.mapName = "random_map";
        battle.arenaBonusType = 1;
        final PlayerResult recorder = player(1001L, "Player", 1, 1_000);
        battle.players = List.of(recorder);
        battle.recorder = recorder.nickname;
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        return new ReplayProcessingResult(
                "random.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("random-hash", "random-arena", null, "random_map",
                        1001L, null),
                battle, (ReplayReconstruction) null, null, capabilities, null, null);
    }

    private static ReplayProcessingResult manyMemberTeamResult() {
        final Battle battle = new Battle();
        battle.arenaId = "large-team-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.players = IntStream.range(0, TeamAiPromptBuilder.MAX_MEMBERS + 2)
                .mapToObj(index -> player(
                        10_000L + index, "Member" + index, 1, 500 + index))
                .toList();
        battle.recorder = battle.players.getFirst().nickname;
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                "large-team.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("large-team-hash", battle.arenaId, "11.0",
                        battle.mapName, battle.players.getFirst().accountId, null),
                battle, null, null, capabilities, null, null);
    }

    private static TeamBattleAnalysisSummary rosterSummary(
            final String id, final int expectedMembers, final List<Long> roster) {
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                expectedMembers, 0, 0, 0, 0, 0, 0, 0,
                null, null, null, null);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, List.of(), aggregate, TeamObservedAggregate.empty(),
                List.of(), List.of(), List.of(), List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
        return new TeamBattleAnalysisSummary(
                id, null, id + ".wotbreplay", "map",
                null, null, 1, roster, features, "test-team");
    }

    // === Authorization redaction tests ===

    @Test void redactionBearer() {
        final String r = AiReplayAnalysisService.safeProviderSummary("Authorization: Bearer my-secret");
        assertFalse(r.contains("my-secret"));
    }

    @Test void redactionBasic() {
        final String r = AiReplayAnalysisService.safeProviderSummary("Authorization: Basic base64sec");
        assertFalse(r.contains("base64sec"));
    }

    @Test void redactionCustomScheme() {
        final String r = AiReplayAnalysisService.safeProviderSummary("Authorization: Custom token123");
        assertFalse(r.contains("token123"));
    }

    @Test void redactionDigest() {
        final String r = AiReplayAnalysisService.safeProviderSummary("Authorization: Digest response=abc");
        assertFalse(r.contains("abc"));
    }

    @Test void redactionJsonObject() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"api-key\":\"secret-123\"}");
        assertFalse(r.contains("secret-123"));
    }

    @Test void redactionJsonArray() {
        final String r = AiReplayAnalysisService.safeProviderSummary("[{\"token\":\"t1\"},{\"token\":\"t2\"}]");
        assertFalse(r.contains("t1"));
    }

    @Test void redactionJsonNested() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"a\":{\"b\":{\"password\":\"p@ss\"}}}");
        assertFalse(r.contains("p@ss"));
    }

    @Test void redactionMalformedJson() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{bad token=secret-value}");
        assertFalse(r.contains("secret-value"));
    }

    @Test void redactionMultipleSecrets() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"api_key\":\"k1\",\"token\":\"k2\",\"password\":\"k3\"}");
        assertFalse(r.contains("k1"));
    }

    @Test void redactionCaseInsensitive() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"API-KEY\":\"secret\"}");
        assertFalse(r.contains("secret"));
    }

    @Test void redactionAccessToken() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"access_token\":\"my-token\"}");
        assertFalse(r.contains("my-token"));
    }

    @Test void redactionXApiKey() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"x-api-key\":\"sk-live-123\"}");
        assertFalse(r.contains("sk-live-123"));
    }

    @Test void redactionAwsKey() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"aws_access_key_id\":\"AKIA123\",\"aws_secret_access_key\":\"secret123\"}");
        assertFalse(r.contains("AKIA123"));
        assertFalse(r.contains("secret123"));
    }

    @Test void redactionAwsSignature() {
        final String r = AiReplayAnalysisService.safeProviderSummary("Credential=AKID/20230101,Signature=abc123");
        assertFalse(r.contains("AKID"));
        assertFalse(r.contains("abc123"));
    }

    @Test void redactionMixedCaseKey() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"X-Api-Key\":\"sensitive\",\"Authorization\":\"Bearer tok\"}");
        assertFalse(r.contains("sensitive"));
        assertFalse(r.contains("tok"));
    }

    @Test void redactionJsonStringValueContainingSecrets() {
        final String r = AiReplayAnalysisService.safeProviderSummary("{\"message\":\"Authorization: Bearer secret-value-here\"}");
        assertFalse(r.contains("secret-value-here"));
    }
}
