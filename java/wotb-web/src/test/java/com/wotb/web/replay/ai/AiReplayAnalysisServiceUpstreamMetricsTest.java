package com.wotb.web.replay.ai;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 验证 AI upstream 指标语义：
 * <ul>
 *   <li>token budget rejection 不产生 upstream request / error / duration</li>
 *   <li>一次真实上游尝试只增加一次 request</li>
 *   <li>上游异常也正确结束 Timer（duration 被记录）</li>
 * </ul>
 */
class AiReplayAnalysisServiceUpstreamMetricsTest {

    private static final String SUCCESS_RESPONSE =
            "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}";

    private HttpServer server;
    private final List<String> requestBodies = new ArrayList<>();
    private int responseStatus = 200;
    private SimpleMeterRegistry registry;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", this::handleRequest);
        server.start();
        registry = new SimpleMeterRegistry();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private void handleRequest(final HttpExchange exchange) throws IOException {
        requestBodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        final byte[] bytes = SUCCESS_RESPONSE.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        try {
            exchange.sendResponseHeaders(responseStatus, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }

    private AiReplayAnalysisService serviceWithMetrics(final int singleReplayMaxInputTokens) throws Exception {
        final String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        final AiReplayAnalysisService service = new AiReplayAnalysisService(
                "test-key", baseUrl, "test-model", 2, singleReplayMaxInputTokens);
        final Field f = AiReplayAnalysisService.class.getDeclaredField("meterRegistry");
        f.setAccessible(true);
        f.set(service, registry);
        // 无 Spring 容器：手动触发 @PostConstruct 初始化 Timer
        service.initMetrics();
        return service;
    }

    private static Battle buildBattle() {
        final Battle battle = new Battle();
        battle.arenaId = "test-arena";
        battle.mapName = "test_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        final PlayerResult rec = player(1001L, "RecorderPlayer", 1, 2000);
        final PlayerResult other = player(2001L, "OtherPlayer", 2, 1500);
        battle.players = List.of(rec, other);
        battle.recorder = rec.nickname;
        return battle;
    }

    private static PlayerResult player(final long accountId, final String nickname, final int team, final int damage) {
        final PlayerResult r = new PlayerResult();
        r.accountId = accountId;
        r.nickname = nickname;
        r.team = team;
        r.damageDealt = damage;
        return r;
    }

    // ---- 1) token budget rejection: no upstream request / error / duration ----

    @Test
    void tokenBudgetRejectionProducesNoUpstreamMetrics() throws Exception {
        final AiReplayAnalysisService service = serviceWithMetrics(1); // tiny budget -> reject

        assertThrows(IllegalArgumentException.class, () -> service.analyzeMulti(List.of(buildBattle())));

        assertTrue(requestBodies.isEmpty(), "rejected request must not reach upstream");
        // requests counter 懒注册：meter 不存在即从未计数
        assertEquals(null, registry.find("wotb_ai_upstream_requests_total").counter(),
                "rejected request must not create upstream requests meter");
        // initMetrics() 会预注册 duration Timer（count=0）；断言未记录任何时长
        assertEquals(0L, registry.find("wotb_ai_upstream_duration_seconds").timer().count(),
                "rejected request must not record upstream duration");
        assertEquals(null, registry.find("wotb_ai_upstream_errors_total").counter(),
                "rejected request must not create upstream errors meter");
    }

    // ---- 2) one real upstream attempt increments request exactly once ----

    @Test
    void singleUpstreamAttemptIncrementsRequestOnce() throws Exception {
        final AiReplayAnalysisService service = serviceWithMetrics(200000);
        service.analyzeMulti(List.of(buildBattle()));

        assertEquals(1, requestBodies.size(), "exactly one upstream call expected");
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total").counter().count(),
                "one attempt must increment requests exactly once");
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds").timer().count(),
                "successful attempt must record duration");
    }

    // ---- 3) upstream failure still stops the timer ----

    @Test
    void upstreamFailureStopsTimer() throws Exception {
        responseStatus = 401;
        final AiReplayAnalysisService service = serviceWithMetrics(200000);

        assertThrows(AiUpstreamException.class, () -> service.analyzeMulti(List.of(buildBattle())));

        assertEquals(1, requestBodies.size(), "upstream must be attempted once");
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total").counter().count(),
                "failed attempt still counts as one request");
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds").timer().count(),
                "timer must stop on failure too");
        assertTrue(registry.find("wotb_ai_upstream_errors_total").tag("type", "AI_AUTHENTICATION_ERROR")
                        .counter().count() >= 1L,
                "failure must record an error classification");
    }
}
