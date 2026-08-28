package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.BatchAnalyzer;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;
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
        assertEquals(TeamReplayAnalysisService.SINGLE_TEAM_PROMPT,
                TeamReplayAnalysisService.localizeTeamSystemPrompt(
                        TeamReplayAnalysisService.SINGLE_TEAM_PROMPT, AllowedLanguage.ZH));
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
        assertTrue(en.contains("Kranvagn 与 EMIL 1951"),
                "tank proper-noun hardening must be preserved in EN prompts");
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
        assertTrue(ru.contains("Kranvagn 与 EMIL 1951"),
                "tank proper-noun hardening must be preserved in RU prompts");
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
        assertTrue(en.contains("Kranvagn 与 EMIL 1951"),
                "tank proper-noun hardening must be preserved in EN team prompts");
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
        assertTrue(ru.contains("Kranvagn 与 EMIL 1951"),
                "tank proper-noun hardening must be preserved in RU team prompts");
        assertFalse(containsAny(ru, CHINESE_OUTPUT_MANDATES),
                "RU team prompt must not contain conflicting Chinese output mandates");
        assertFalse(containsAny(ru, LOCALIZED_OUTPUT_MANDATES),
                "RU team prompt must not contain forced Chinese or ordinal-time wording");
    }

    @Test
    void playerFallbackUsesLocalizedSystemPrompts() {
        final Battle battle = battle();
        assertTrue(PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null, AllowedLanguage.EN)
                .systemPrompt().contains("Write a concise, professional"));
        assertTrue(PlayerReplayPromptBuilder.prepareFallback(
                battle, (ReplayReconstruction) null, AllowedLanguage.RU)
                .systemPrompt().contains("на русском языке"));
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
                Arguments.of(PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT));
    }

    private static Stream<Arguments> teamBases() {
        return Stream.of(
                Arguments.of(TeamReplayAnalysisService.SINGLE_TEAM_PROMPT));
    }

    private static boolean containsAny(final String text, final List<String> needles) {
        return needles.stream().anyMatch(text::contains);
    }

    private static AiChatGateway capturingGateway(final AtomicReference<AiChatRequest> captured) {
        return new AiChatGateway() {
            @Override
            public AiChatResponse chat(final AiChatRequest request) {
                captured.set(request);
                // Natural Coach 轮：Call #2 必须返回合法 JSON envelope
                return new AiChatResponse("{\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},\"reviewMarkdown\":\"ok\",\"claims\":[]}", "DeepSeek", "test-model",
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
                new com.wotb.core.replay.processing.ReplayIdentity(
                        "h", "stub", "11.0", "team_map", 1001L, null),
                battle, teamRecon(), null, capabilities, null, null);
        return new BatchAnalyzer().analyze(List.of(result)).groups().getFirst();
    }

    /** 有效团队 reconstruction（IDENTIFIED battle-relative 时钟 + 双方实体位置/血量）：通过 Team hard gate。 */
    private static ReplayReconstruction teamRecon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(true, 4, 4, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true, 1000f, true);
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(0, new ReplayTimestamp(1000f, null), 8,
                DecodeConfidence.EXACT, 1, 1001L));
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(1000f, null), 8,
                DecodeConfidence.EXACT, 2, 2001L));
        events.add(new PositionChangedEvent(2, new ReplayTimestamp(1000f, null), 10,
                DecodeConfidence.EXACT, 1, 0, 0, 10f, 0f, 10f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(3, new ReplayTimestamp(1000f, null), 10,
                DecodeConfidence.EXACT, 2, 0, 0, -10f, 0f, -10f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new HealthChangedEvent(4, new ReplayTimestamp(1000f, null), 7,
                DecodeConfidence.EXACT, 1, 2000, null, true));
        events.add(new HealthChangedEvent(5, new ReplayTimestamp(1000f, null), 7,
                DecodeConfidence.EXACT, 2, 1500, null, true));
        return new ReplayReconstruction(meta, header, 300f, 1000f, List.of(),
                events, List.of(), BattleStateSnapshot.empty(), coverage, diag);
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
        p.deathTimeSource = p.deathTimeMillis > 0
                ? DeathTimeSource.SETTLEMENT_SECOND : DeathTimeSource.UNKNOWN;
        return p;
    }
}