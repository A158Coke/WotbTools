package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
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

    private static final String AUTOPSY_JSON = "{\"players\":[{\"tank\":\"Kranvagn\",\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}],"
            + "\"mvps\":[{\"tank\":\"Kranvagn\",\"reason\":\"r\",\"evidence\":[\"e\"],\"confidence\":\"EXACT\"}],"
            + "\"biggestLiabilities\":[{\"tank\":\"T110E5\",\"reason\":\"r2\",\"evidence\":[\"e2\"],\"confidence\":\"PARTIAL\"}],"
            + "\"limitations\":[\"l\"]}";

    private static AiReplayAnalysisConfig config() {
        return new AiReplayAnalysisConfig(
                ESTIMATOR, "test-model", 100_000, 131_072, 8192, 1000, false, null, 315);
    }

    private static Battle battle(final Integer winnerTeam) {
        final Battle b = new Battle();
        b.mapName = "erlenberg";
        b.durationS = 300.0;
        b.winnerTeam = winnerTeam;
        b.players = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 1000L + i;
            p.team = 1;
            p.tankId = 4481;
            p.tankName = "Kranvagn";
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
                return new AiChatResponse(reply, "", "", 0, 0, 0, 0, 0, 0, "stop");
            }

            @Override
            public boolean isConfigured() {
                return true;
            }
        };
    }

    @Test
    void successParsesVerdicts() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway(AUTOPSY_JSON), config());
        final TeamAutopsyResult result = service.analyze(
                battle(2), null, null, 1001L, 1, AllowedLanguage.ZH);
        assertNotNull(result);
        assertEquals(1, result.mvps().size());
        assertEquals(1, result.biggestLiabilities().size());
    }

    @Test
    void upstreamFailureReturnsNull() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway("not json"), config());
        assertNull(service.analyze(battle(2), null, null, 1001L, 1, AllowedLanguage.ZH));
    }

    @Test
    void drawReturnsNull() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway(AUTOPSY_JSON), config());
        assertNull(service.analyze(battle(null), null, null, 1001L, 1, AllowedLanguage.ZH));
    }

    @Test
    void nonZhReturnsNull() {
        final TeamAutopsyService service = new TeamAutopsyService(gateway(AUTOPSY_JSON), config());
        assertNull(service.analyze(battle(2), null, null, 1001L, 1, AllowedLanguage.EN));
    }
}
