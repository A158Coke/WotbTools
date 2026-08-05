package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import org.junit.jupiter.api.Test;

/**
 * 语言指令契约：player/team 的 system prompt 在 EN/RU 时追加对应语言指令与时间格式，
 * ZH 时保持与既有 prompt 完全一致（不改变现有中文输出）。
 */
class OutputLanguagePromptTest {

    @Test
    void playerFallbackAppendsLanguageDirective() {
        final Battle battle = battle();
        final String zhSystem = PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null, OutputLanguage.ZH).systemPrompt();
        assertEquals(PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null).systemPrompt(), zhSystem,
                "zh must keep the existing prompt byte-for-byte");
        assertTrue(PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null, OutputLanguage.EN)
                .systemPrompt().contains("使用英文"));
        assertTrue(PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null, OutputLanguage.RU)
                .systemPrompt().contains("使用俄语"));
    }

    @Test
    void playerMultiAppendsLanguageDirective() {
        final Battle battle = battle();
        assertTrue(PlayerReplayPromptBuilder.prepareMulti(
                List.of(battle), OutputLanguage.EN).systemPrompt().contains("1min 15s"));
        assertTrue(PlayerReplayPromptBuilder.prepareMulti(
                List.of(battle), OutputLanguage.RU).systemPrompt().contains("мин"));
        assertEquals(PlayerReplayPromptBuilder.prepareMulti(List.of(battle))
                .systemPrompt(), PlayerReplayPromptBuilder.prepareMulti(
                List.of(battle), OutputLanguage.ZH).systemPrompt());
    }

    @Test
    void teamSingleContextAppendsLanguageDirective() {
        final AtomicReference<AiChatRequest> captured = new AtomicReference<>();
        final AiChatGateway gateway = new AiChatGateway() {
            @Override
            public AiChatResponse chat(final AiChatRequest request) {
                captured.set(request);
                return new AiChatResponse("ok", "DeepSeek", "test-model",
                        0, 0, 0, 0, 0, 0, "stop", Map.of());
            }

            @Override
            public boolean isConfigured() {
                return true;
            }
        };
        final AiReplayAnalysisService facade = new AiReplayAnalysisService(
                gateway, "test-model", 200000, new ConservativeDeepSeekTokenEstimator());
        final ReplayPerspectiveGroup group = teamGroup();
        final var context = facade.buildSingleTeamContext(group);

        facade.analyzeSingleTeamContext(context, OutputLanguage.EN);
        assertTrue(captured.get().systemPrompt().contains("使用英文"));

        facade.analyzeSingleTeamContext(context, OutputLanguage.RU);
        assertTrue(captured.get().systemPrompt().contains("使用俄语"));
    }

    @Test
    void teamGroupsAppendLanguageDirective() {
        final AtomicReference<AiChatRequest> captured = new AtomicReference<>();
        final AiChatGateway gateway = new AiChatGateway() {
            @Override
            public AiChatResponse chat(final AiChatRequest request) {
                captured.set(request);
                return new AiChatResponse("ok", "DeepSeek", "test-model",
                        0, 0, 0, 0, 0, 0, "stop", Map.of());
            }

            @Override
            public boolean isConfigured() {
                return true;
            }
        };
        final AiReplayAnalysisService facade = new AiReplayAnalysisService(
                gateway, "test-model", 200000, new ConservativeDeepSeekTokenEstimator());

        facade.analyzeTeamGroups(List.of(teamGroup()), OutputLanguage.EN);
        assertTrue(captured.get().systemPrompt().contains("使用英文"));

        facade.analyzeTeamGroups(List.of(teamGroup()), OutputLanguage.RU);
        assertTrue(captured.get().systemPrompt().contains("使用俄语"));
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.arenaId = "a";
        battle.mapName = "test_map";
        battle.arenaBonusType = 1;
        battle.durationS = 10.0;
        battle.winnerTeam = 1;
        final PlayerResult player = new PlayerResult();
        player.accountId = 1L;
        player.nickname = "P";
        player.team = 1;
        player.damageDealt = 100;
        battle.players = List.of(player);
        battle.recorder = player.nickname;
        return battle;
    }

    private static ReplayPerspectiveGroup teamGroup() {
        final Battle battle = new Battle();
        battle.arenaId = "stub";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = "Ally";
        final PlayerResult ally = player(1001L, "Ally", 1, 1500);
        final PlayerResult enemy = player(2001L, "Enemy", 2, 900);
        battle.players = List.of(ally, enemy);
        final ReplayProcessingCapabilities capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        final ReplayProcessingResult result = new ReplayProcessingResult(
                "stub.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new com.wotb.core.processing.ReplayIdentity(
                        "h", "stub", "11.0", "team_map", 1001L, null),
                battle, (ReplayReconstruction) null, null, capabilities, null, null);
        return new BatchAnalyzer().analyze(List.of(result)).groups().getFirst();
    }

    private static PlayerResult player(final long id, final String name,
                                       final int team, final int dmg) {
        final PlayerResult p = new PlayerResult();
        p.accountId = id;
        p.nickname = name;
        p.team = team;
        p.damageDealt = dmg;
        p.survived = team == 1;
        p.deathTimeMillis = team == 1 ? 0 : 180_000;
        return p;
    }
}
