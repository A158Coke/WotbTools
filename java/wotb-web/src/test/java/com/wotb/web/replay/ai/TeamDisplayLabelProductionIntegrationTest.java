package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayStreamHeader;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.BatchAnalyzer;
import com.wotb.core.replay.processing.ReplayIdentity;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Team display label 生产路径集成测试——
 * Battle roster → {@link TeamRosterResolver}（display labels）→ {@link TeamAiPromptBuilder}
 * （system/user prompt 的 teamDisplayLabel / opponentDisplayLabel）→ {@link PreBattleSectionRenderer}。
 * <p>无 clan：不得出现 {@code 队伍-\d+} / 「对方主要军团」，PreBattle 只显示「我方画像/对方画像」；
 * 可靠 CHRD/KSR：prompt 明确拿到 CHRD / KSR，PreBattle 显示「我方（CHRD）画像」。</p>
 */
class TeamDisplayLabelProductionIntegrationTest {

    private static final float START_RAW = 1000f;

    @Test
    void noClanRosterUsesNeutralLabelsEverywhere() {
        final Battle battle = battleWithClans(null, null);
        assertEquals("", TeamRosterResolver.resolveDisplayLabel(battle, 1),
                "no clan → 我方 display label 为空（fallback 我方）");
        assertEquals("", TeamRosterResolver.resolveOpponentDisplayLabel(battle, 1),
                "no clan → 对方 display label 为空（fallback 对方）");

        final String user = TeamAiPromptBuilder.single(
                contextOf(battle), List.of(), null, null, Integer.MAX_VALUE).content();
        assertTrue(user.contains("teamDisplayLabel=(none)"), "prompt 必须携带空的 teamDisplayLabel: " + user);
        assertTrue(user.contains("opponentDisplayLabel=(none)"), "prompt 必须携带空的 opponentDisplayLabel: " + user);
        assertFalse(user.contains("队伍-"), "prompt 不得出现 队伍- hash fallback: " + user);
        assertFalse(user.contains("对方主要军团"), "prompt 不得把「对方主要军团」当 proper noun: " + user);
        assertFalse(user.contains("主要军团"), "prompt 不得出现「主要军团」proper noun: " + user);

        final String section = PreBattleSectionRenderer.render(
                prior(), 1, "", AllowedLanguage.ZH, "team_map");
        assertTrue(section.contains("我方画像"), "PreBattle 无 clan 时显示「我方画像」: " + section);
        assertTrue(section.contains("对方画像"), "PreBattle 无 clan 时显示「对方画像」: " + section);
        assertFalse(section.contains("队伍-"), "PreBattle 不得出现 队伍- hash fallback: " + section);
    }

    @Test
    void reliableClanRosterCarriesDisplayLabelsIntoPromptAndPreBattle() {
        final Battle battle = battleWithClans("CHRD", "KSR");
        assertEquals("CHRD", TeamRosterResolver.resolveDisplayLabel(battle, 1));
        assertEquals("KSR", TeamRosterResolver.resolveOpponentDisplayLabel(battle, 1));

        final String user = TeamAiPromptBuilder.single(
                contextOf(battle), List.of(), null, null, Integer.MAX_VALUE).content();
        assertTrue(user.contains("teamDisplayLabel=\"CHRD\""), "prompt 必须拿到 CHRD: " + user);
        assertTrue(user.contains("opponentDisplayLabel=\"KSR\""), "prompt 必须拿到 KSR: " + user);
        assertFalse(user.contains("队伍-"), "prompt 不得出现 队伍- hash fallback: " + user);

        final String section = PreBattleSectionRenderer.render(
                prior(), 1, "CHRD", AllowedLanguage.ZH, "team_map");
        assertTrue(section.contains("我方（CHRD）画像"), "PreBattle 显示「我方（CHRD）画像」: " + section);
        assertTrue(section.contains("对方画像"), "PreBattle 对方无 clan 显示「对方画像」: " + section);
        assertFalse(section.contains("队伍-"), "PreBattle 不得出现 队伍- hash fallback: " + section);
    }

    @Test
    void mixedReliabilityFallsBackPerSide() {
        final Battle battle = battleWithClans("CHRD", null);
        assertEquals("CHRD", TeamRosterResolver.resolveDisplayLabel(battle, 1));
        assertEquals("", TeamRosterResolver.resolveOpponentDisplayLabel(battle, 1));

        final String user = TeamAiPromptBuilder.single(
                contextOf(battle), List.of(), null, null, Integer.MAX_VALUE).content();
        assertTrue(user.contains("teamDisplayLabel=\"CHRD\""), user);
        assertTrue(user.contains("opponentDisplayLabel=(none)"), user);

        final String section = PreBattleSectionRenderer.render(
                prior(), 1, "CHRD", AllowedLanguage.ZH, "team_map");
        assertTrue(section.contains("我方（CHRD）画像"), section);
        assertTrue(section.contains("对方画像"), section);
    }

    // ---- fixture ----

    private static PreBattleStrategicPrior prior() {
        return new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of("mobility", "HIGH"), List.of("重坦正面推进"), List.of("w1"), List.of("p1")),
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of("mobility", "MEDIUM"), List.of("中坦机动拉扯"), List.of("w2"), List.of("p2")),
                List.of(), List.of(),
                List.of(new PreBattleStrategicPrior.StrategicHypothesis("H1", "开局左路集结", "rs")));
    }

    private static Battle battleWithClans(final String myClan, final String oppClan) {
        final Battle battle = new Battle();
        battle.arenaId = "arena-display";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 120.0;
        battle.winnerTeam = 1;
        battle.recorder = "Ally";
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            final PlayerResult ally = new PlayerResult();
            ally.accountId = 1001L + i;
            ally.nickname = i == 0 ? "Ally" : "Ally" + i;
            ally.team = 1;
            ally.clan = myClan;
            ally.tankId = 4481L;
            ally.tankName = "Kranvagn";
            ally.damageDealt = 1000;
            ally.survived = true;
            players.add(ally);
        }
        for (int i = 0; i < 2; i++) {
            final PlayerResult enemy = new PlayerResult();
            enemy.accountId = 2001L + i;
            enemy.nickname = "Enemy" + i;
            enemy.team = 2;
            enemy.clan = oppClan;
            enemy.tankId = 29985L;
            enemy.tankName = "SPHT";
            enemy.damageDealt = 800;
            enemy.survived = true;
            players.add(enemy);
        }
        battle.players = players;
        return battle;
    }

    private static SingleTeamBattleAnalysisContext contextOf(final Battle battle) {
        final ReplayPerspectiveGroup group = new BatchAnalyzer().analyze(List.of(
                result(battle))).groups().getFirst();
        return TeamContextBuilder.buildSingleTeamContext(group);
    }

    private static ReplayProcessingResult result(final Battle battle) {
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                "display.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("hash-display", battle.arenaId, "11.0", battle.mapName,
                        1001L, null),
                battle, validRecon(), null, capabilities, null, null);
    }

    private static ReplayReconstruction validRecon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 120.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(10, 10, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mapping(0, 1, 1001L));
        events.add(mapping(1, 2, 1002L));
        events.add(mapping(2, 3, 2001L));
        events.add(mapping(3, 4, 2002L));
        events.add(position(4, 1, 0, 10f, 10f));
        events.add(position(5, 2, 0, 20f, 20f));
        events.add(position(6, 3, 0, -10f, -10f));
        events.add(position(7, 4, 0, -20f, -20f));
        events.add(health(8, 1, 0, 2000, true));
        events.add(health(9, 2, 0, 1800, true));
        events.add(health(10, 3, 0, 1500, true));
        events.add(health(11, 4, 0, 1500, true));
        events.add(new DamageEvent(12, new ReplayTimestamp(START_RAW + 5f, null), 8,
                DecodeConfidence.EXACT, 1, 3, null, null, 420, false));
        return new ReplayReconstruction(meta, header, 120f, START_RAW, List.of(),
                events, List.of(), BattleStateSnapshot.empty(), coverage, diag);
    }

    private static ParticipantMappingEvent mapping(final int seq, final int eid, final long accountId) {
        return new ParticipantMappingEvent(seq, new ReplayTimestamp(START_RAW, null), 8,
                DecodeConfidence.EXACT, eid, accountId);
    }

    private static PositionChangedEvent position(final int seq, final int eid, final float battleSec,
                                                 final float x, final float z) {
        return new PositionChangedEvent(seq, new ReplayTimestamp(START_RAW + battleSec, null), 10,
                DecodeConfidence.EXACT, eid, 0, 0, x, 0f, z, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    private static HealthChangedEvent health(final int seq, final int eid, final float battleSec,
                                             final int hp, final boolean alive) {
        return new HealthChangedEvent(seq, new ReplayTimestamp(START_RAW + battleSec, null), 7,
                DecodeConfidence.EXACT, eid, hp, null, alive);
    }
}
