package com.wotb.web.replay.ai;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.feature.TeamAnalysisUnitReport;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
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
        assertTrue(requestBody.get().contains("perspectiveTeam=1"));
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
        assertEquals(List.of(1, 2), result.units().stream()
                .map(unit -> unit.perspectiveTeam())
                .sorted()
                .toList());
        assertTrue(requestBody.get().contains("MULTI_TEAM_CONTEXT"));
        assertTrue(requestBody.get().contains("perspectiveTeam=1"));
        assertTrue(requestBody.get().contains("perspectiveTeam=2"));
        assertTrue(requestBody.get().contains("PERSPECTIVE_TIMELINES_ISOLATED"));
        assertTrue(requestBody.get().contains("rosterConsistent=false"));
        assertTrue(result.units().stream()
                .map(unit -> (TeamAnalysisUnitReport) unit.report())
                .allMatch(report -> report.limitations().contains(
                        "PERSPECTIVE_TIMELINES_ISOLATED")
                        && report.limitations().contains(
                        "ROSTER_CONSISTENCY_UNCONFIRMED")));
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
    @CsvSource({
            "400, AI_INVALID_REQUEST",
            "401, AI_AUTHENTICATION_ERROR",
            "429, AI_RATE_LIMITED",
            "503, AI_UPSTREAM_UNAVAILABLE"
    })
    void providerHttpFailuresUseStableErrorCodes(
            final int status,
            final String expectedCode
    ) throws IOException {
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
    void providerTimeoutUsesStableCode() throws IOException {
        responseDelayMillis = 1_500;
        final var service = startService(1);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "timeout.wotbreplay", "timeout-arena", "Ally", 1001L, 1)))
                        .getFirst());

        final var error = assertThrows(
                AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));

        assertEquals("AI_TIMEOUT", error.code());
        assertNotNull(error.correlationId());
    }

    @Test
    void blankCompletionUsesStableCode() throws IOException {
        responseBody = "{\"choices\":[{\"message\":{\"content\":\"   \"}}]}";
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "blank.wotbreplay", "blank-arena", "Ally", 1001L, 1)))
                        .getFirst());

        final var error = assertThrows(
                AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));

        assertEquals("AI_EMPTY_RESPONSE", error.code());
    }

    @Test
    void invalidCompletionEnvelopeUsesStableCode() throws IOException {
        responseBody = "{\"choices\":[]}";
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "invalid.wotbreplay", "invalid-arena", "Ally", 1001L, 1)))
                        .getFirst());

        final var error = assertThrows(
                AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));

        assertEquals("AI_RESPONSE_INVALID", error.code());
    }

    @Test
    void malformedJsonCompletionUsesStableCode() throws IOException {
        responseBody = "{\"choices\":[";
        final var service = startService(2);
        final var context = service.buildSingleTeamContext(
                teamGroups(List.of(teamResult(
                        "malformed.wotbreplay", "malformed-arena",
                        "Ally", 1001L, 1)))
                        .getFirst());

        final var error = assertThrows(
                AiUpstreamException.class,
                () -> service.analyzeSingleTeamContext(context));

        assertEquals("AI_RESPONSE_INVALID", error.code());
    }

    @Test
    void rosterCoverageUsesSeventyFivePercentAsInclusiveBoundary() {
        final List<Long> seventyFive = IntStream.rangeClosed(1, 75)
                .mapToObj(value -> (long) value)
                .toList();
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
            final List<ReplayProcessingResult> results
    ) {
        return new BatchAnalyzer().analyze(results).groups();
    }

    private static ReplayProcessingResult teamResult(
            final String fileName,
            final String arenaId,
            final String recorderNickname,
            final long recorderAccountId,
            final int recorderTeam
    ) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = recorderNickname;

        final PlayerResult ally = player(
                recorderTeam == 1 ? recorderAccountId : 1001L,
                recorderTeam == 1 ? recorderNickname : "Ally",
                1,
                1_500);
        final PlayerResult enemy = player(
                recorderTeam == 2 ? recorderAccountId : 2001L,
                recorderTeam == 2 ? recorderNickname : "Enemy",
                2,
                900);
        battle.players = List.of(ally, enemy);

        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                fileName,
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "hash-" + fileName,
                        arenaId,
                        "11.0",
                        "team_map",
                        recorderAccountId,
                        null),
                battle,
                null,
                null,
                capabilities,
                null,
                null);
    }

    private static PlayerResult player(
            final long accountId,
            final String nickname,
            final int team,
            final int damage
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        player.damageDealt = damage;
        player.damageReceived = 700;
        player.damageAssisted = 250;
        player.damageBlocked = 300;
        player.kills = team == 1 ? 2 : 1;
        player.survived = team == 1;
        player.deathTimeMillis = team == 1 ? 0 : 180_000;
        return player;
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
                "random.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "random-hash", "random-arena", null, "random_map", 1001L, null),
                battle,
                (ReplayReconstruction) null,
                null,
                capabilities,
                null,
                null);
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
                "large-team.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "large-team-hash",
                        battle.arenaId,
                        "11.0",
                        battle.mapName,
                        battle.players.getFirst().accountId,
                        null),
                battle,
                null,
                null,
                capabilities,
                null,
                null);
    }

    private static TeamBattleAnalysisSummary rosterSummary(
            final String id,
            final int expectedMembers,
            final List<Long> roster
    ) {
        final TeamAggregateResult aggregate = new TeamAggregateResult(
                expectedMembers, 0, 0, 0, 0, 0, 0, 0,
                null, null, null, null);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, List.of(), aggregate, TeamObservedAggregate.empty(),
                List.of(), List.of(), List.of(), List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
        return new TeamBattleAnalysisSummary(
                id, null, id + ".wotbreplay", "map",
                null, null, 1, roster, features);
    }
}
