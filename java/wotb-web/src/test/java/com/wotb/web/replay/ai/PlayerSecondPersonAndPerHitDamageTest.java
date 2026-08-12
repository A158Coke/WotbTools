package com.wotb.web.replay.ai;
import com.wotb.web.replay.ai.TeamReplayAnalysisService;
import com.wotb.web.replay.ai.PlayerReplayPromptBuilder;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 随机战个人复盘的人称契约、Player/Team 规则隔离与逐次伤害事件。
 */
class PlayerSecondPersonAndPerHitDamageTest {

    private static final long SPHT_TANK_ID = 29985L;   // SPHT / Heavy tank / 10 / USA
    private static final long IS_TANK_ID = 513L;       // IS / Heavy tank
    private static final long YOU = 1L;
    private static final long ENEMY = 2L;
    private static final long MATE = 3L;

    private static Stream<String> playerPrompts() {
        return Stream.of(
                PlayerReplayPromptBuilder.SYSTEM_PROMPT,
                PlayerReplayPromptBuilder.SINGLE_PLAYER_PROMPT);
    }

    private static Stream<String> teamPrompts() {
        return Stream.of(
                TeamReplayAnalysisService.SINGLE_TEAM_PROMPT);
    }

    // ---- 人称规则 ----

    @Test
    void playerPromptsUseSecondPersonForThePlayer() {
        playerPrompts().forEach(p -> {
            assertTrue(p.contains("上传回放的玩家一律称为「你」"), p);
            assertTrue(p.contains("作为教练的我自称「我」"), p);
            assertTrue(p.contains("「你的队友」「队友」或「友军」"), p);
        });
    }

    @Test
    void playerPromptsForbidCallingThePlayerRecorderOrFriendly() {
        playerPrompts().forEach(p -> assertTrue(
                p.contains("禁止用以下词语指代玩家本人：用户、录像者、友方、友军、我方玩家、朋友、RECORDER、FRIENDLY"), p));
    }

    // ---- Player / Team 规则隔离 ----

    @Test
    void teamPromptsDoNotCarryPlayerPersonRules() {
        teamPrompts().forEach(p -> {
            assertFalse(p.contains("上传回放的玩家一律称为「你」"), p);
            assertFalse(p.contains("你在X分XX秒对敌方"), p);
            assertTrue(p.contains("禁止把整支队伍称为「你」"), p);
            assertTrue(p.contains("录像者只用于确定 perspective"), p);
        });
    }

    @Test
    void bothPathsShareTheCommonRules() {
        Stream.concat(playerPrompts(), teamPrompts()).forEach(p -> {
            assertTrue(p.contains("坦克名称专有名词规则"), p);
            assertTrue(p.contains("SPHT 就是完整的坦克名称，它不是 SPG"), p);
            assertTrue(p.contains("最终正文必须使用自然、通顺的简体中文"), p);
            assertTrue(p.contains("不得使用英文缩写 TD"), p);
        });
    }

    // ---- 玩家本人不进入队友阵容 ----

    @Test
    void thePlayerIsNeverListedAmongTeammates() {
        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendPlayerLine(sb, you(), true, true);
        final String yourLine = sb.toString();

        assertTrue(yourLine.startsWith("你 "), yourLine);
        assertFalse(yourLine.startsWith("友方"), yourLine);
        assertFalse(yourLine.contains("友方 "), yourLine);
    }

    @Test
    void teammatesAreLabelledTeammateNotFriendly() {
        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendPlayerLine(sb, mate(), true);
        final String line = sb.toString();

        assertTrue(line.startsWith("队友 "), line);
        assertFalse(line.contains("友方"), line);
    }

    // ---- 逐次伤害事件 ----

    @Test
    void perHitEventsUseMinuteSecondClockAndKeepDirection() {
        final StringBuilder sb = new StringBuilder();
        final boolean written = PlayerReplayPromptBuilder.appendPerHitDamageEvents(
                sb, battle(), YOU,
                recon(0f,
                        hit(192f, YOU, ENEMY, 418),
                        hit(198f, ENEMY, YOU, 376)));

        assertTrue(written);
        final String evidence = sb.toString();
        assertTrue(evidence.contains("PER_HIT_DAMAGE_EVENTS_OBSERVED"), evidence);
        // 3分12秒 = 192s，方向不得颠倒
        assertTrue(evidence.contains("3分12秒：你驾驶的IS 对 敌方玩家\"EnemyAce\"驾驶的SPHT 造成了418点伤害"), evidence);
        assertTrue(evidence.contains("3分18秒：敌方玩家\"EnemyAce\"驾驶的SPHT 对 你驾驶的IS 造成了376点伤害"), evidence);
    }

    @Test
    void perHitEventsAreSingleHitsNotAggregates() {
        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendPerHitDamageEvents(
                sb, battle(), YOU,
                recon(0f, hit(60f, YOU, ENEMY, 100), hit(70f, YOU, ENEMY, 200)));
        final String evidence = sb.toString();

        assertTrue(evidence.contains("每条都是单次伤害事件, 不是累计值"), evidence);
        assertTrue(evidence.contains("造成了100点伤害"), evidence);
        assertTrue(evidence.contains("造成了200点伤害"), evidence);
        // 不得把两次合并成 300
        assertFalse(evidence.contains("造成了300点伤害"), evidence);
    }

    @Test
    void perHitEventsExcludePreBattleAndNonPositiveDamage() {
        final StringBuilder sb = new StringBuilder();
        final boolean written = PlayerReplayPromptBuilder.appendPerHitDamageEvents(
                sb, battle(), YOU,
                recon(30f,
                        hit(10f, YOU, ENEMY, 500),   // 准备阶段
                        hit(40f, YOU, ENEMY, 0)));   // 零伤害

        assertFalse(written);
        assertEquals("", sb.toString());
    }

    @Test
    void perHitEventsIgnoreDamageNotInvolvingThePlayer() {
        final StringBuilder sb = new StringBuilder();
        final boolean written = PlayerReplayPromptBuilder.appendPerHitDamageEvents(
                sb, battle(), YOU, recon(0f, hit(50f, MATE, ENEMY, 300)));

        assertFalse(written);
    }

    @Test
    void aggregateSummaryIsExplicitlyLabelledAsAggregate() {
        final Battle battle = battle();
        final PlayerResult recorder = battle.players.get(0);
        recorder.killVictims.add(new com.wotb.core.stats.PotentialDamage.KillVictim(ENEMY, 780, 2));

        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendRecorderDamageExchange(sb, battle, recorder);
        final String evidence = sb.toString();

        assertTrue(evidence.contains("DAMAGE_EXCHANGE_AGGREGATED_OBSERVED（逐对手聚合观测子集）"), evidence);
        assertTrue(evidence.contains("整场累计的观测子集, 不是单次伤害"), evidence);
        assertTrue(evidence.contains("累计直接伤害780"), evidence);
    }

    // ---- 阵亡时间线人称 / TD / 时间格式 ----

    @Test
    void deathTimelineUsesSecondPersonAndMinuteSecondClock() {
        final Battle battle = battle();
        battle.durationS = 420.0;
        battle.players.get(0).survived = false;   // 你
        battle.players.get(0).deathTimeMillis = 192_000L;
        battle.players.get(1).survived = false;   // 敌方
        battle.players.get(1).deathTimeMillis = 200_000L;
        battle.players.get(2).survived = false;   // 队友
        battle.players.get(2).deathTimeMillis = 210_000L;

        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendDeathTimeline(sb, battle);
        final String timeline = sb.toString();

        assertTrue(timeline.contains("你"), timeline);
        assertTrue(timeline.contains("队友 \"Mate\""), timeline);
        assertTrue(timeline.contains("敌方 \"EnemyAce\""), timeline);
        // 玩家本人绝不出现为「友方」，也不出现「录像者」
        assertFalse(timeline.contains("友方"), timeline);
        assertFalse(timeline.contains("录像者"), timeline);
        // 时间统一 X分XX秒，不再出现裸秒数
        assertTrue(timeline.contains("分") && timeline.contains("秒"), timeline);
        assertFalse(timeline.matches("(?s).*\\d+\\.\\ds.*"), timeline);
    }

    @Test
    void deathTimelineUnknownTimeRendersUnknownNotZeroClock() {
        final Battle battle = battle();
        battle.durationS = 420.0;
        battle.players.get(0).survived = false;   // 你，已知
        battle.players.get(0).deathTimeMillis = 192_000L;
        battle.players.get(1).survived = false;   // 敌方，时刻未知
        battle.players.get(1).deathTimeMillis = 0L;
        battle.players.get(1).survivalTimeSec = 0.0;
        battle.players.get(2).survived = false;   // 队友，已知
        battle.players.get(2).deathTimeMillis = 210_000L;

        final StringBuilder sb = new StringBuilder();
        PlayerReplayPromptBuilder.appendDeathTimeline(sb, battle);
        final String timeline = sb.toString();

        assertTrue(timeline.contains("3分12秒"), timeline);
        assertTrue(timeline.contains("3分30秒"), timeline);
        assertTrue(timeline.contains("未知 敌方 \"EnemyAce\""),
                "unknown death time must render as 未知: " + timeline);
        assertTrue(timeline.contains("阵亡（时刻未知）"), timeline);
        assertFalse(timeline.contains("0分00秒"),
                "unknown death time must NOT render as 0分00秒: " + timeline);
        assertTrue(timeline.indexOf("3分12秒") < timeline.indexOf("未知"),
                "unknown death time must be sorted after known: " + timeline);
    }

    @Test
    void tankDestroyerIsWrittenInChinese() {
        // tankopedia 把坦克歼击车记作 TD，证据里必须展开为中文
        assertEquals("Tank destroyer", com.wotb.core.ref.ReplayDisplayNames.tankClass(8529L)); // AT 15
        assertEquals("Heavy tank", com.wotb.core.ref.ReplayDisplayNames.tankClass(SPHT_TANK_ID));
    }

    // ---- 术语 ----

    @Test
    void battleClockFormatsAsMinutesAndSeconds() {
        assertEquals("0分00秒", PlayerAnalysisTerms.battleClock(0f));
        assertEquals("1分15秒", PlayerAnalysisTerms.battleClock(75f));
        assertEquals("3分00秒", PlayerAnalysisTerms.battleClock(180f));
        assertEquals("3分12秒", PlayerAnalysisTerms.battleClock(192f));
        assertEquals("0分00秒", PlayerAnalysisTerms.battleClock(-5f));
    }

    @Test
    void teamMachineLabelsNeverReachThePrompt() {
        assertEquals("队员阵亡", PlayerAnalysisTerms.keyEventLabel("TEAM_MEMBER_DESTROYED"));
        assertEquals("团队首次接敌", PlayerAnalysisTerms.keyEventLabel("TEAM_FIRST_CONTACT"));
        assertEquals("队形分散", PlayerAnalysisTerms.keyEventLabel("TEAM_FORMATION_SPLIT"));
        assertEquals("车辆被击毁", PlayerAnalysisTerms.keyEventLabel("VEHICLE_DESTROYED"));
        assertEquals("战斗结束", PlayerAnalysisTerms.keyEventLabel("BATTLE_END"));
        assertEquals("首次接敌", PlayerAnalysisTerms.keyEventLabel("FIRST_CONTACT"));
        // 未知全大写机器标签回退为通用中文，不得原样进入 prompt
        assertEquals("其他关键事件", PlayerAnalysisTerms.keyEventLabel("SOME_NEW_TEAM_EVENT"));
        assertEquals("其他关键事件", PlayerAnalysisTerms.keyEventLabel(""));
    }

    // ---- fixtures ----

    private static PlayerResult you() {
        final PlayerResult p = new PlayerResult();
        p.accountId = YOU;
        p.nickname = "You";
        p.team = 1;
        p.tankId = IS_TANK_ID;
        p.survived = true;
        return p;
    }

    private static PlayerResult mate() {
        final PlayerResult p = new PlayerResult();
        p.accountId = MATE;
        p.nickname = "Mate";
        p.team = 1;
        p.tankId = IS_TANK_ID;
        p.survived = true;
        return p;
    }

    private static PlayerResult enemyAce() {
        final PlayerResult p = new PlayerResult();
        p.accountId = ENEMY;
        p.nickname = "EnemyAce";
        p.team = 2;
        p.tankId = SPHT_TANK_ID;
        p.survived = true;
        return p;
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.players = List.of(you(), enemyAce(), mate());
        battle.recorder = "You";
        battle.winnerTeam = 1;
        return battle;
    }

    private static DamageEvent hit(final float clock, final long attacker,
                                   final long victim, final int amount) {
        return new DamageEvent(0, new ReplayTimestamp(clock, null), 8,
                DecodeConfidence.EXACT, 0, 0, attacker, victim, amount, false);
    }

    private static ReplayReconstruction recon(final Float battleStart, final DamageEvent... events) {
        return new ReplayReconstruction(null, null, 600f, battleStart, List.of(),
                List.<ReplayEvent>of(events), List.of(), null, null, null);
    }
}
