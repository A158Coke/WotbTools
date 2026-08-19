package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.BattleIdentity;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 直接对生产端生成的证据文本断言，不经过 HTTP。
 * <p>{@code AiReplayAnalysisServiceTest} 依赖本机 loopback 才能起 mock server，
 * 在部分开发机上无法执行；本类覆盖同一批契约（人称、阵容归属、事件类型中文化），
 * 让这些回归在本地也能被抓住。</p>
 */
class PlayerEvidenceContractTest {

    private static final long YOU = 1001L;
    private static final long MATE = 1002L;
    private static final long FOE = 2001L;

    // ---- 完整特征集路径 ----

    @Test
    void fullFeaturePathAddressesThePlayerInSecondPerson() {
        final String evidence = fullFeatureEvidence(1);

        assertTrue(evidence.contains("你的 entity 已映射, 特征集可用"), evidence);
        assertTrue(evidence.contains("你: 账号 1001 | 车辆:"), evidence);
        assertFalse(evidence.contains("侧=队友"), evidence);
        assertFalse(evidence.contains("侧=友方"), evidence);
        assertFalse(evidence.contains("侧=友军"), evidence);
        assertFalse(evidence.contains("录像者 entity"), evidence);
    }

    @Test
    void recorderInTeam2IsStillAddressedAsYou() {
        final String evidence = fullFeatureEvidence(2);

        assertTrue(evidence.contains("你: 账号 1001 | 车辆:"), evidence);
        assertFalse(evidence.contains("侧=队友"), evidence);
        assertFalse(evidence.contains("侧=友方"), evidence);
        assertFalse(evidence.contains("侧=友军"), evidence);
        assertFalse(evidence.contains("录像者 entity"), evidence);
    }

    @Test
    void invalidRecorderTeamStillAddressesThePlayerWithoutSideField() {
        for (final int invalidTeam : new int[]{-1, 0, 3, Integer.MAX_VALUE}) {
            final String evidence = fullFeatureEvidence(invalidTeam);
            assertTrue(evidence.contains("你: 账号 1001 | 车辆:"),
                    "invalid team " + invalidTeam + " still addresses the player as 你, got: " + evidence);
            assertFalse(evidence.contains("侧="),
                    "the player line must carry no side field, got: " + evidence);
        }
    }

    @Test
    void thePlayerIsNeverListedAmongTeammates() {
        final String evidence = fullFeatureEvidence(1);

        assertTrue(evidence.contains("YOU_AUTHORITATIVE"), evidence);
        assertTrue(evidence.contains("TEAMMATE_LINEUP_AUTHORITATIVE"), evidence);
        // 队友段（到敌方段之前）不得出现玩家本人
        final String teammateSection = evidence.substring(
                evidence.indexOf("TEAMMATE_LINEUP_AUTHORITATIVE"),
                evidence.indexOf("ENEMY_LINEUP_AUTHORITATIVE"));
        assertFalse(teammateSection.contains("\"You\""),
                "The player must not be repeated as a teammate, got: " + teammateSection);
        assertTrue(teammateSection.contains("队友 \"Mate\""), teammateSection);
    }

    @Test
    void keyEventTypesAreRenderedInChinese() {
        final String evidence = fullFeatureEvidence(1, List.of(
                new KeyBattleEvent(10f, "FIRST_CONTACT", "初次接触",
                        DecodeConfidence.EXACT, "TEST", List.of()),
                new KeyBattleEvent(20f, "REGION_CHANGE", "区域变换",
                        DecodeConfidence.EXACT, "TEST", List.of()),
                new KeyBattleEvent(30f, "PLAYER_DESTROYED", "被击毁",
                        DecodeConfidence.EXACT, "TEST", List.of())));

        assertTrue(evidence.contains("KEY_EVENTS_BACKEND_COMPUTED"), evidence);
        assertTrue(evidence.contains("首次接敌"), evidence);
        assertTrue(evidence.contains("区域变换"), evidence);
        assertTrue(evidence.contains("玩家被击毁"), evidence);
        assertFalse(evidence.contains("FIRST_CONTACT"), evidence);
        assertFalse(evidence.contains("REGION_CHANGE"), evidence);
        assertFalse(evidence.contains("PLAYER_DESTROYED"), evidence);
    }

    // ---- 降级路径（无特征集） ----

    @Test
    void fallbackPathKeepsThePlayerOutOfTheTeammateRoster() {
        final String evidence = PlayerReplayPromptBuilder.buildSummary(battle(1), null, List.of());

        assertTrue(evidence.contains("你: \"You\""), evidence);
        assertTrue(evidence.contains("=== 你 ==="), evidence);
        assertTrue(evidence.contains("=== 队友 ==="), evidence);
        assertTrue(evidence.contains("队友 \"Mate\""), evidence);
        assertTrue(evidence.contains("敌方 \"Foe\""), evidence);

        final String teammateSection = evidence.substring(
                evidence.indexOf("=== 队友 ==="), evidence.indexOf("=== 敌方 ==="));
        assertFalse(teammateSection.contains("You"),
                "The player must not be repeated as a teammate, got: " + teammateSection);
        assertFalse(evidence.contains("| 侧=友方"), evidence);
        assertFalse(evidence.contains("录像者"), evidence);
    }

    @Test
    void fallbackPathInTeam2AlsoSeparatesThePlayer() {
        final String evidence = PlayerReplayPromptBuilder.buildSummary(battle(2), null, List.of());

        assertTrue(evidence.contains("=== 你 ==="), evidence);
        assertTrue(evidence.contains("你: \"You\""), evidence);
        final String teammateSection = evidence.contains("=== 队友 ===")
                ? evidence.substring(evidence.indexOf("=== 队友 ==="), evidence.indexOf("=== 敌方 ==="))
                : "";
        assertFalse(teammateSection.contains("You"), teammateSection);
    }

    // ---- 战斗时间统一为 X分XX秒 ----

    @Test
    void fullFeaturePromptCarriesNoRawSecondClocks() {
        assertNoRawSecondClocks(fullFeatureEvidence(1, List.of(
                new KeyBattleEvent(75f, "VEHICLE_DESTROYED", "被击毁",
                        DecodeConfidence.EXACT, "TEST", List.of()))));
    }

    @Test
    void fallbackPromptCarriesNoRawSecondClocks() {
        final Battle battle = battle(1);
        battle.players.get(2).survived = false;
        battle.players.get(2).deathTimeMillis = 123_000L;
        assertNoRawSecondClocks(PlayerReplayPromptBuilder.buildSummary(battle, null, List.of(
                new KeyBattleEvent(123f, "VEHICLE_DESTROYED", "被击毁",
                        DecodeConfidence.EXACT, "TEST", List.of()))));
    }

    @Test
    void deathTimeUsesMinuteSecondFormat() {
        final Battle battle = battle(1);
        battle.players.get(2).survived = false;
        battle.players.get(2).deathTimeMillis = 123_000L;
        final String evidence = PlayerReplayPromptBuilder.buildSummary(battle, null, List.of());

        assertTrue(evidence.contains("阵亡@2分03秒"), evidence);
        assertFalse(evidence.contains("阵亡@123.0s"), evidence);
    }

    /**
     * Prompt 里不得出现裸秒数：{@code 123.0s}、{@code [10.0-20.0s]}、{@code 阵亡@123.0s}。
     * 距离与速度的 m / m/s 不属于战斗时刻，故只匹配以 s 结尾的秒数写法。
     */
    private static void assertNoRawSecondClocks(final String evidence) {
        assertFalse(evidence.matches("(?s).*\\d+\\.\\ds\\b.*"),
                "prompt must not contain raw second clocks like 123.0s, got: " + evidence);
        assertFalse(evidence.contains("阵亡@") && evidence.matches("(?s).*阵亡@\\d+\\.\\d.*"),
                "阵亡 time must use X分XX秒, got: " + evidence);
        assertFalse(evidence.matches("(?s).*\\[\\d+\\.\\d-\\d+\\.\\ds?\\].*"),
                "time ranges must use [X分XX秒-X分XX秒], got: " + evidence);
    }

    // ---- fixtures ----

    private static String fullFeatureEvidence(final int recorderTeam) {
        return fullFeatureEvidence(recorderTeam, List.of());
    }

    private static String fullFeatureEvidence(final int recorderTeam,
                                              final List<KeyBattleEvent> keyEvents) {
        final Battle battle = battle(recorderTeam);
        final var ctx = new SinglePlayerBattleAnalysisContext(
                new BattleIdentity("arena", "11.0", "map", 0L),
                battle,
                new PlayerBattleFeatureSet(List.of(), List.of(), List.of(), keyEvents, List.of(), true),
                new RecorderEntityMapping(YOU, 1, 5, "You", recorderTeam, 1, DecodeConfidence.EXACT),
                null,
                List.of());
        return PlayerReplayPromptBuilder.buildPlayerContextSummary(ctx);
    }

    /**
     * 名册：你（recorderTeam）+ 同队 Mate + 对方 Foe。
     */
    private static Battle battle(final int recorderTeam) {
        final int enemyTeam = recorderTeam == 1 ? 2 : 1;
        final Battle battle = new Battle();
        battle.arenaId = "arena";
        battle.mapName = "map";
        battle.durationS = 300.0;
        battle.winnerTeam = recorderTeam;
        battle.recorder = "You";
        battle.players = List.of(
                player(YOU, "You", recorderTeam),
                player(MATE, "Mate", recorderTeam),
                player(FOE, "Foe", enemyTeam));
        return battle;
    }

    private static PlayerResult player(final long accountId, final String nickname, final int team) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.nickname = nickname;
        p.team = team;
        p.tankId = 513L;   // IS
        p.damageDealt = 1_000;
        p.survived = true;
        return p;
    }
}
