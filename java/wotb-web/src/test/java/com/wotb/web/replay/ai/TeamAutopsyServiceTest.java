package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class TeamAutopsyServiceTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();

    private static final String AUTOPSY_JSON =
            "{\"players\":[{\"playerKey\":\"P1\",\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"},"
                    + "{\"playerKey\":\"P2\",\"contribution\":\"LOW\",\"confidence\":\"PARTIAL\"}],"
                    + "\"mvps\":[{\"playerKey\":\"P1\",\"reason\":\"r\",\"evidence\":[\"e\"],"
                    + "\"confidence\":\"EXACT\"}],"
                    + "\"biggestLiabilities\":[{\"playerKey\":\"P2\",\"reason\":\"r2\","
                    + "\"evidence\":[\"e2\"],\"confidence\":\"PARTIAL\"}],"
                    + "\"limitations\":[\"l\"]}";

    private static AiReplayAnalysisConfig config() {
        return new AiReplayAnalysisConfig(
                ESTIMATOR, "test-model", 100_000, 131_072, 8192, 1000, false, null, 315);
    }

    /** 7 名本方玩家使用同名坦克，验证 playerKey 可区分。 */
    private static Battle battle() {
        final Battle b = new Battle();
        b.mapName = "erlenberg";
        b.durationS = 300.0;
        b.players = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 1000L + i;
            p.team = 1;
            p.tankId = 4481;
            p.tankName = "Kranvagn";
            p.nickname = "nick" + i;
            p.survived = true;
            p.damageDealt = 1000 + i;
            b.players.add(p);
        }
        return b;
    }

    private static AiChatGateway gateway(final String reply) {
        return new AiChatGateway() {
            @Override
            public AiChatResponse chat(final AiChatRequest request) {
                if ("not json".equals(reply)) {
                    throw new AiUpstreamException("AI_TIMEOUT", null, "autopsy-test");
                }
                if ("cancelled".equals(reply)) {
                    throw new AiUpstreamException("AI_CANCELLED", null, "autopsy-test");
                }
                return new AiChatResponse(reply, "", "", 0, 0, 0, 0, 0, 0, "stop");
            }

            @Override
            public boolean isConfigured() {
                return true;
            }
        };
    }

    @Test
    void successReturnsOutcomeWithRosterAndDistinctPlayerKeys() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway(AUTOPSY_JSON), config());
        final TeamAutopsyOutcome outcome = service.analyze(
                battle(), null, null, 1001L, 1, AllowedLanguage.ZH,
                Winner.ENEMY_WIN, 30);
        assertNotNull(outcome);
        assertEquals(1, outcome.result().mvps().size());
        assertEquals(1, outcome.result().biggestLiabilities().size());
        assertEquals(7, outcome.roster().size());
        assertEquals(7, outcome.roster().stream()
                .map(s -> s.playerKey()).distinct().count());
        assertEquals(7, outcome.roster().stream()
                .map(s -> s.accountId()).distinct().count(),
                "same tank names must remain distinguishable via playerKey/accountId");
    }

    @Test
    void upstreamFailureReturnsNull() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway("not json"), config());
        assertNull(service.analyze(battle(), null, null, 1001L, 1, AllowedLanguage.ZH,
                Winner.ENEMY_WIN, 30));
    }

    @Test
    void cancellationIsRethrownNotSwallowed() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway("cancelled"), config());
        final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                () -> service.analyze(battle(), null, null, 1001L, 1, AllowedLanguage.ZH,
                        Winner.ENEMY_WIN, 30));
        assertEquals("AI_CANCELLED", e.code());
    }

    @Test
    void drawNonZhInvalidTeamAndZeroBudgetReturnNull() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway(AUTOPSY_JSON), config());
        assertNull(service.analyze(battle(), null, null, 1001L, 1, AllowedLanguage.ZH,
                Winner.DRAW_OR_UNKNOWN, 30));
        assertNull(service.analyze(battle(), null, null, 1001L, 1, AllowedLanguage.EN,
                Winner.ENEMY_WIN, 30));
        assertNull(service.analyze(battle(), null, null, 1001L, 3, AllowedLanguage.ZH,
                Winner.ENEMY_WIN, 30));
        assertNull(service.analyze(battle(), null, null, 1001L, 1, AllowedLanguage.ZH,
                Winner.ENEMY_WIN, 0));
    }

    @Test
    void requestCarriesCappedCallTimeout() {
        final AiChatRequest[] captured = new AiChatRequest[1];
        final AiChatGateway capturing = new AiChatGateway() {
            @Override
            public AiChatResponse chat(final AiChatRequest request) {
                captured[0] = request;
                return new AiChatResponse(AUTOPSY_JSON, "", "", 0, 0, 0, 0, 0, 0, "stop");
            }

            @Override
            public boolean isConfigured() {
                return true;
            }
        };
        final TeamAutopsyService service = new TeamAutopsyService(capturing, config());
        assertNotNull(service.analyze(battle(), null, null, 1001L, 1, AllowedLanguage.ZH,
                Winner.ENEMY_WIN, 30));
        assertNotNull(captured[0]);
        assertEquals("TEAM_AUTOPSY", captured[0].analysisMode());
        assertTrue(captured[0].callTimeoutSec() <= 30);
    }
}
