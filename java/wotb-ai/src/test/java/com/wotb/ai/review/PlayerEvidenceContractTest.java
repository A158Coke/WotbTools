package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.processing.BattleIdentity;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlayerEvidenceContractTest {

    private static final long YOU = 1001L;
    private static final long MATE = 1002L;
    private static final long FOE = 2001L;


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
battle.players.get(2).settlementLifeTimeSec = 123;
        assertNoRawSecondClocks(PlayerReplayPromptBuilder.buildSummary(battle, null, List.of(
                new KeyBattleEvent(123f, "VEHICLE_DESTROYED", "被击毁",
                        DecodeConfidence.EXACT, "TEST", List.of()))));
    }

    @Test
    void deathTimeUsesMinuteSecondFormat() {
        final Battle battle = battle(1);
        battle.players.get(2).survived = false;
        battle.players.get(2).deathTimeMillis = 123_000L;
battle.players.get(2).settlementLifeTimeSec = 123;
        final String evidence = PlayerReplayPromptBuilder.buildSummary(battle, null, List.of());

        assertTrue(evidence.contains("阵亡@2分03秒"), evidence);
        assertFalse(evidence.contains("阵亡@123.0s"), evidence);
    }

    private static void assertNoRawSecondClocks(final String evidence) {
        assertFalse(evidence.matches("(?s).*\\d+\\.\\ds\\b.*"),
                "prompt must not contain raw second clocks like 123.0s, got: " + evidence);
        assertFalse(evidence.contains("阵亡@") && evidence.matches("(?s).*阵亡@\\d+\\.\\d.*"),
                "阵亡 time must use X分XX秒, got: " + evidence);
        assertFalse(evidence.matches("(?s).*\\[\\d+\\.\\d-\\d+\\.\\ds?\\].*"),
                "time ranges must use [X分XX秒-X分XX秒], got: " + evidence);
    }


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
        p.tankId = 513L;
        p.damageDealt = 1_000;
        p.survived = true;
        return p;
    }
}
