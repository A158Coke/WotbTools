package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * 语言指令结构契约：EN/RU 最终 system prompt 不得包含互斥的中文输出强制句（简体中文、
 * XX分XX秒、车种中文写法），必须包含目标语言输出要求与本地化时间格式；ZH 字节级不变。
 */
class AllowedLanguagePromptTest {

    private static final List<String> CHINESE_OUTPUT_MANDATES = List.of(
            "请用简体中文输出",
            "最终正文必须使用自然、通顺的简体中文",
            "XX分XX秒",
            "重坦 / 中坦 / 轻坦 / 坦克歼击车");

    private static final List<String> LOCALIZED_OUTPUT_MANDATES = List.of(
            "只能写「未知」",
            "无法从当前回放数据确定",
            "3-й минуте",
            "12-й секунде");

    @Test
    void zhSystemPromptsRemainByteIdentical() {
        assertEquals(PlayerReplayPromptBuilder.SYSTEM_PROMPT,
                PlayerReplayPromptBuilder.localizePlayerSystemPrompt(
                        PlayerReplayPromptBuilder.SYSTEM_PROMPT, AllowedLanguage.ZH));
        assertEquals(PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT,
                PlayerReplayPromptBuilder.localizePlayerSystemPrompt(
                        PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT, AllowedLanguage.ZH));
        assertEquals(PlayerReplayPromptBuilder.MULTI_SYSTEM_PROMPT,
                PlayerReplayPromptBuilder.localizePlayerSystemPrompt(
                        PlayerReplayPromptBuilder.MULTI_SYSTEM_PROMPT, AllowedLanguage.ZH));
        assertEquals(TeamReplayAnalysisService.SINGLE_TEAM_PROMPT,
                TeamReplayAnalysisService.localizeTeamSystemPrompt(
                        TeamReplayAnalysisService.SINGLE_TEAM_PROMPT, AllowedLanguage.ZH));
        assertEquals(TeamReplayAnalysisService.MULTI_TEAM_PROMPT,
                TeamReplayAnalysisService.localizeTeamSystemPrompt(
                        TeamReplayAnalysisService.MULTI_TEAM_PROMPT, AllowedLanguage.ZH));
    }

    @ParameterizedTest
    @MethodSource("playerBases")
    void enPlayerPromptsHaveNoConflictingChineseRules(final String zhPrompt) {
        final String en = PlayerReplayPromptBuilder.localizePlayerSystemPrompt(zhPrompt, AllowedLanguage.EN);
        assertTrue(en.contains("natural, fluent English"));
        assertTrue(en.contains("1m 15s"));
        assertTrue(en.contains("3m 0s"));
        assertTrue(en.contains("3m 12s"));
        assertTrue(en.contains("tank proper names")
                || en.contains("坦克名称"), "business constraints must be preserved");
        assertFalse(containsAny(en, CHINESE_OUTPUT_MANDATES),
                "EN prompt must not contain conflicting Chinese output mandates");
        assertFalse(containsAny(en, LOCALIZED_OUTPUT_MANDATES),
                "EN prompt must not contain forced Chinese or ordinal-time wording");
    }

    @ParameterizedTest
    @MethodSource("playerBases")
    void ruPlayerPromptsHaveNoConflictingChineseRules(final String zhPrompt) {
        final String ru = PlayerReplayPromptBuilder.localizePlayerSystemPrompt(zhPrompt, AllowedLanguage.RU);
        assertTrue(ru.contains("естественном русском языке"));
        assertTrue(ru.contains("1 мин 15 с"));
        assertTrue(ru.contains("3 мин 0 с"));
        assertTrue(ru.contains("3 мин 12 с"));
        assertTrue(ru.contains("坦克名称"), "business constraints must be preserved");
        assertFalse(containsAny(ru, CHINESE_OUTPUT_MANDATES),
                "RU prompt must not contain conflicting Chinese output mandates");
        assertFalse(containsAny(ru, LOCALIZED_OUTPUT_MANDATES),
                "RU prompt must not contain forced Chinese or ordinal-time wording");
    }

    @ParameterizedTest
    @MethodSource("teamBases")
    void enTeamPromptsHaveNoConflictingChineseRules(final String zhPrompt) {
        final String en = TeamReplayAnalysisService.localizeTeamSystemPrompt(zhPrompt, AllowedLanguage.EN);
        assertTrue(en.contains("natural, fluent English"));
        assertTrue(en.contains("1m 15s"));
        assertTrue(en.contains("3m 0s"));
        assertTrue(en.contains("3m 12s"));
        assertTrue(en.contains("Never address the whole team as \"you\""));
        assertFalse(containsAny(en, CHINESE_OUTPUT_MANDATES),
                "EN team prompt must not contain conflicting Chinese output mandates");
        assertFalse(containsAny(en, LOCALIZED_OUTPUT_MANDATES),
                "EN team prompt must not contain forced Chinese or ordinal-time wording");
    }

    @ParameterizedTest
    @MethodSource("teamBases")
    void ruTeamPromptsHaveNoConflictingChineseRules(final String zhPrompt) {
        final String ru = TeamReplayAnalysisService.localizeTeamSystemPrompt(zhPrompt, AllowedLanguage.RU);
        assertTrue(ru.contains("естественном русском языке"));
        assertTrue(ru.contains("1 мин 15 с"));
        assertTrue(ru.contains("3 мин 0 с"));
        assertTrue(ru.contains("3 мин 12 с"));
        assertTrue(ru.contains("Не обращайтесь ко всей команде"));
        assertFalse(containsAny(ru, CHINESE_OUTPUT_MANDATES),
                "RU team prompt must not contain conflicting Chinese output mandates");
        assertFalse(containsAny(ru, LOCALIZED_OUTPUT_MANDATES),
                "RU team prompt must not contain forced Chinese or ordinal-time wording");
    }

    @Test
    void playerFallbackAndMultiUseLocalizedSystemPrompts() {
        final Battle battle = battle();
        assertTrue(PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null, AllowedLanguage.EN)
                .systemPrompt().contains("Write a concise, professional"));
        assertTrue(PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null, AllowedLanguage.RU)
                .systemPrompt().contains("на русском языке"));
        assertTrue(PlayerReplayPromptBuilder.prepareMulti(
                List.of(battle), AllowedLanguage.EN).systemPrompt().contains("1m 15s"));
        assertEquals(PlayerReplayPromptBuilder.prepareFallback(
                        battle, (ReplayReconstruction) null).systemPrompt(),
                PlayerReplayPromptBuilder.prepareFallback(
                        battle, (ReplayReconstruction) null, AllowedLanguage.ZH).systemPrompt());
    }

    @Test
    void teamSingleContextAndGroupsUseLocalizedSystemPrompts() {
        final AtomicReference<AiChatRequest> captured = new AtomicReference<>();
        final AiChatGateway gateway = capturingGateway(captured);
        final AiReplayAnalysisService facade = new AiReplayAnalysisService(
                gateway, "test-model", 200000, new ConservativeDeepSeekTokenEstimator());
        final ReplayPerspectiveGroup group = teamGroup();
        final var context = facade.buildSingleTeamContext(group);

        facade.analyzeSingleTeamContext(context, AllowedLanguage.EN);
        assertTrue(captured.get().systemPrompt().contains("natural, fluent English"));
        assertFalse(containsAny(captured.get().systemPrompt(), CHINESE_OUTPUT_MANDATES));
        assertFalse(containsAny(captured.get().systemPrompt(), LOCALIZED_OUTPUT_MANDATES));

        facade.analyzeSingleTeamContext(context, AllowedLanguage.RU);
        assertTrue(captured.get().systemPrompt().contains("естественном русском языке"));
        assertFalse(containsAny(captured.get().systemPrompt(), CHINESE_OUTPUT_MANDATES));
        assertFalse(containsAny(captured.get().systemPrompt(), LOCALIZED_OUTPUT_MANDATES));

        facade.analyzeTeamGroups(List.of(teamGroup()), AllowedLanguage.EN);
        assertTrue(captured.get().systemPrompt().contains("natural, fluent English"));
        assertFalse(containsAny(captured.get().systemPrompt(), CHINESE_OUTPUT_MANDATES));
        assertFalse(containsAny(captured.get().systemPrompt(), LOCALIZED_OUTPUT_MANDATES));
    }

    private static Stream<Arguments> playerBases() {
        return Stream.of(
                Arguments.of(PlayerReplayPromptBuilder.SYSTEM_PROMPT),
                Arguments.of(PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT),
                Arguments.of(PlayerReplayPromptBuilder.MULTI_SYSTEM_PROMPT));
    }

    private static Stream<Arguments> teamBases() {
        return Stream.of(
                Arguments.of(TeamReplayAnalysisService.SINGLE_TEAM_PROMPT),
                Arguments.of(TeamReplayAnalysisService.MULTI_TEAM_PROMPT));
    }

    private static boolean containsAny(final String text, final List<String> needles) {
        return needles.stream().anyMatch(text::contains);
    }

    private static AiChatGateway capturingGateway(final AtomicReference<AiChatRequest> captured) {
        return new AiChatGateway() {
            @Override
            public AiChatResponse chat(final AiChatRequest request) {
                captured.set(request);
                return new AiChatResponse("ok", "DeepSeek", "test-model",
                        0, 0, 0, 0, 0, 0, "stop");
            }

            @Override
            public boolean isConfigured() {
                return true;
            }
        };
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
