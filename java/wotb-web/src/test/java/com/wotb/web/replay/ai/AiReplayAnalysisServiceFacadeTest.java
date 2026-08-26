package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.ReplayAnalysisScope;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 校验兼容 facade {@link AiReplayAnalysisService} 纯委托行为：
 * 各公共方法转给 Player/Team Service，自身不构建 Prompt、不发 HTTP、不复制 records。
 * 不对私有实现细节 mock。
 */
class AiReplayAnalysisServiceFacadeTest {

    private CountingGateway gateway;

    @BeforeEach
    void setUp() {
        gateway = new CountingGateway();
    }

    private AiReplayAnalysisService facade() {
        return new AiReplayAnalysisService(gateway, "test-model", 200000,
                new ConservativeDeepSeekTokenEstimator());
    }

    @Test
    void isConfiguredDelegatesToPlayerService() {
        gateway.configured = true;
        assertTrue(facade().isConfigured());
        gateway.configured = false;
        assertEquals(false, facade().isConfigured());
    }

    @Test
    void analyzeDelegatesToPlayerService() {
        gateway.configured = true;
        final Battle battle = new Battle();
        battle.arenaId = "a";
        battle.mapName = "test_map";
        battle.arenaBonusType = 1;
        battle.durationS = 10.0;
        battle.winnerTeam = 1;
        final var rec = new com.wotb.core.model.PlayerResult();
        rec.accountId = 1L;
        rec.nickname = "P";
        rec.team = 1;
        rec.damageDealt = 100;
        battle.players = List.of(rec);
        battle.recorder = rec.nickname;
        final AnalyzeResult r = facade().analyze(battle, null);
        assertEquals(1, gateway.calls.get());
        assertEquals("ok", r.analysis());
    }

    @Test
    void analyzeSingleTeamContextAndBuildSingleTeamContextDelegateToTeamService() {
        gateway.configured = true;
        final ReplayProcessingResult result = teamResultStub();
        final var group = new com.wotb.core.replay.processing.BatchAnalyzer()
                .analyze(List.of(result)).groups().getFirst();
        final var ctx = facade().buildSingleTeamContext(group);
        assertNotNull(ctx.analysisUnitId());
        final AnalyzeResult r = facade().analyzeSingleTeamContext(ctx);
        // 团队流程 = Call #1（PRE_BATTLE）+ 团队复盘（SINGLE_TEAM_BATTLE）
        assertEquals(2, gateway.calls.get());
        assertEquals("ok", r.analysis());
    }

    @Test
    void findRecorderStaticDelegates() {
        final ReplayProcessingResult result = teamResultStub();
        assertNotNull(AiReplayAnalysisService.findRecorder(result));
    }

    private static ReplayProcessingResult teamResultStub() {
        final Battle battle = new Battle();
        battle.arenaId = "stub";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = null;
        battle.recorder = "Ally";
        final var ally = player(1001L, "Ally", 1, 1500);
        final var enemy = player(2001L, "Enemy", 2, 900);
        battle.players = List.of(ally, enemy);
        final var capabilities = new com.wotb.core.replay.processing.ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                "stub.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new com.wotb.core.replay.processing.ReplayIdentity(
                        "h", "stub", "11.0", "team_map", 1001L, null),
                battle, (ReplayReconstruction) null, null, capabilities, null, null);
    }

    private static com.wotb.core.model.PlayerResult player(
            final long id, final String name, final int team, final int dmg) {
        final var p = new com.wotb.core.model.PlayerResult();
        p.accountId = id;
        p.nickname = name;
        p.team = team;
        p.damageDealt = dmg;
        p.survived = team == 1;
        p.deathTimeMillis = team == 1 ? 0 : 180_000;
        return p;
    }

    private static final class CountingGateway implements AiChatGateway {
        final AtomicInteger calls = new AtomicInteger();
        volatile boolean configured = true;

        @Override
        public boolean isConfigured() {
            return configured;
        }

        @Override
        public AiChatResponse chat(final AiChatRequest request) {
            calls.incrementAndGet();
            // Natural Coach 轮：Team Call #2 必须返回合法 JSON envelope；player 路径不解析 envelope
            if ("SINGLE_TEAM_BATTLE".equals(request.analysisMode())) {
                return new AiChatResponse(
                        "{\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                                + "\"reviewMarkdown\":\"ok\",\"claims\":[]}",
                        "DeepSeek", "test-model", 0, 0, 0, 0, 0, 0, "stop");
            }
            return new AiChatResponse("ok", "DeepSeek", "test-model",
                    0, 0, 0, 0, 0, 0, "stop");
        }
    }
}
