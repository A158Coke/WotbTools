package com.wotb.ai.review;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.ai.gateway.AiChatGateway;
import com.wotb.ai.gateway.AiChatRequest;
import com.wotb.ai.gateway.AiChatResponse;

import org.junit.jupiter.api.BeforeEach;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

abstract class PlayerReplayAnalysisServiceTestSupport {

    protected static final class RecordingGateway implements AiChatGateway {
        protected final List<AiChatRequest> requests = new CopyOnWriteArrayList<>();
        protected volatile String completionText = "ok";
        protected volatile boolean configured = true;

        @Override
        public boolean isConfigured() {
            return configured;
        }

        @Override
        public AiChatResponse chat(final AiChatRequest request) {
            requests.add(request);
            return new AiChatResponse(completionText, "DeepSeek", "test-model",
                    0, 0, 0, 0, 0, 0, "stop");
        }
    }

    protected RecordingGateway gateway;

    @BeforeEach
    void setUp() {
        gateway = new RecordingGateway();
    }

    protected PlayerReplayAnalysisService service() {
        return new PlayerReplayAnalysisService(gateway, new AiReplayAnalysisConfig(
                new ConservativeDeepSeekTokenEstimator(), "test-model",
                200000, 131072, 8192, 1000, true, "high", 315, 4096));
    }

    protected String lastBody() {
        return gateway.requests.getLast().userPrompt();
    }


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

    protected static List<Integer> playerTeams(final Battle battle) {
        return battle.players.stream()
                .map(player -> player.team)
                .toList();
    }

    protected static void assertPlayerResultTeams(
            final List<Integer> expectedTeams,
            final Battle battle
    ) {
        assertEquals(
                expectedTeams,
                playerTeams(battle),
                "PlayerResult.team must not be modified"
        );
    }

    protected static SinglePlayerBattleAnalysisContext buildPlayerContext(final Battle battle) {
        final PlayerResult rec = battle.recorderResult();
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(), List.of(), List.of(), List.of(), List.of(), true);
        final RecorderEntityMapping recorderMapping = new RecorderEntityMapping(
                rec != null ? rec.accountId : 0L,
                501,
                42,
                "RecorderPlayer",
                rec != null && PlayerSideResolver.isValidRawTeam(rec.team) ? rec.team : null,
                123,
                DecodeConfidence.EXACT
        );
        final ReplayCoverage coverage = new ReplayCoverage(100, 100, 0, 0, 0, 1.0, Map.of());
        return new SinglePlayerBattleAnalysisContext(
                null, battle, features, recorderMapping, coverage, List.of("TEST_LIMITATION"));
    }

    protected static Battle makePlayerBattle(final int recorderTeam, final int winnerTeam) {
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

    protected static SinglePlayerBattleAnalysisContext buildContextWithFeatures(
            final Battle battle, final PlayerBattleFeatureSet features) {
        final PlayerResult rec = battle.recorderResult();
        final RecorderEntityMapping recorderMapping = new RecorderEntityMapping(
                rec != null ? rec.accountId : 0L, 501, 42, "RecorderPlayer",
                rec != null && PlayerSideResolver.isValidRawTeam(rec.team) ? rec.team : null,
                123, DecodeConfidence.EXACT);
        final ReplayCoverage coverage = new ReplayCoverage(100, 100, 0, 0, 0, 1.0, Map.of());
        return new SinglePlayerBattleAnalysisContext(
                null, battle, features, recorderMapping, coverage, List.of("TEST_LIMITATION"));
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

    protected static Battle randomBattleWithoutReconstruction() {
        final Battle battle = new Battle();
        battle.arenaId = "random-arena";
        battle.mapName = "random_map";
        battle.arenaBonusType = 1;
        final PlayerResult recorder = player(1001L, "Player", 1, 1_000);
        battle.players = List.of(recorder);
        battle.recorder = recorder.nickname;
        return battle;
    }
}
