package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.EvidencePriority;
import com.wotb.core.replay.evidence.EvidenceProvenance;
import com.wotb.core.replay.evidence.EvidenceType;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

class TeamAutopsyStatsBuilderTest {

    private static PlayerResult player(final long accountId, final int team,
                                       final String tankName, final int damageDealt,
                                       final boolean survived, final double deathSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = 4481;
        p.tankName = tankName;
        p.nickname = "n" + accountId;
        p.damageDealt = damageDealt;
        p.damageReceived = 1000;
        p.survived = survived;
        p.deathTimeMillis = survived ? 0 : (long) (deathSec * 1000);
        p.survivalTimeSec = survived ? 300.0 : deathSec;
        return p;
    }

    private static List<PlayerResult> sevenFriendlyPlayers() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(player(1001, 1, "Kranvagn", 3000, true, 0));
        players.add(player(1002, 1, "T110E5", 2000, false, 100));   // 早死（< 150s）
        players.add(player(1003, 1, "E 100", 100, false, 200));      // 输出不足（本方均值 ~1586 × 0.5）
        players.add(player(1004, 1, "Leopard 1", 1500, false, 170)); // 窗口 [160,200] 内阵亡
        players.add(player(1005, 1, "E 50 M", 1500, true, 0));
        players.add(player(1006, 1, "T-62A", 1500, true, 0));
        players.add(player(1007, 1, "STB-1", 1500, true, 0));
        return players;
    }

    private static AiEvidence window(final DecodeConfidence confidence) {
        return new AiEvidence(
                "CW_01", EvidenceType.CRITICAL_WINDOW, 160f, 200f,
                List.of(), Map.of(), Map.of(), confidence,
                EvidencePriority.CRITICAL, EvidenceProvenance.BACKEND_SKILL, "窗口");
    }

    private static Battle battle(final List<PlayerResult> players) {
        final Battle battle = new Battle();
        battle.mapName = "erlenberg";
        battle.durationS = 300.0;
        battle.players = players;
        return battle;
    }

    @Test
    void buildsOnlyRecorderTeamWithStablePlayerKeys() {
        final List<PlayerResult> players = sevenFriendlyPlayers();
        players.add(player(2001, 2, "Leopard 1", 99999, true, 0)); // 敌方超高伤害
        players.add(player(2002, 2, "E 50 M", 0, true, 0));        // 敌方零伤害
        final Battle battle = battle(players);

        final List<TeamAutopsyStats> stats =
                new TeamAutopsyStatsBuilder().build(battle, List.of(window(DecodeConfidence.EXACT)), 1, 1001L);

        assertEquals(7, stats.size());
        assertEquals(List.of("P1", "P2", "P3", "P4", "P5", "P6", "P7"),
                stats.stream().map(TeamAutopsyStats::playerKey).toList());
        assertTrue(stats.stream().allMatch(s -> s.team() == 1));
        assertTrue(stats.stream().allMatch(s -> !s.nickname().isBlank()));
    }

    @Test
    void sameTankNamePlayersAreDistinguishedByPlayerKey() {
        final List<PlayerResult> players = List.of(
                player(1001, 1, "Kranvagn", 3000, true, 0),
                player(1002, 1, "Kranvagn", 2000, true, 0),
                player(1003, 1, "Kranvagn", 1500, true, 0),
                player(1004, 1, "Kranvagn", 1500, true, 0),
                player(1005, 1, "Kranvagn", 1500, true, 0),
                player(1006, 1, "Kranvagn", 1500, true, 0),
                player(1007, 1, "Kranvagn", 1500, true, 0));
        final List<TeamAutopsyStats> stats =
                new TeamAutopsyStatsBuilder().build(battle(players), List.of(), 1, 1001L);
        assertEquals(1, stats.stream().map(TeamAutopsyStats::tankName).distinct().count(),
                "tank names are normalized by tankId and identical here");
        assertEquals(7, stats.stream().map(TeamAutopsyStats::playerKey).distinct().count(),
                "playerKey must distinguish same-tank teammates");
        assertEquals(7, stats.stream().map(TeamAutopsyStats::accountId).distinct().count(),
                "accountId must remain distinct for same-tank teammates");
    }

    @Test
    void weakOutputMeanUsesOnlyFriendlyTeam() {
        // 本方 7 人伤害全为 100：均值 100，任何玩家都不低于 0.5×均值 → 不 weakOutput。
        // 若均值混入敌方 99999，均值将 > 200 且 E 100(100) < 0.5×均值 → 错误变 weakOutput；
        // 本方口径下敌方数据不得改变判定。
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            players.add(player(1000L + i, 1, "Tank" + i, 100, true, 0));
        }
        players.add(player(2001, 2, "Maus", 99999, true, 0));
        final List<TeamAutopsyStats> stats =
                new TeamAutopsyStatsBuilder().build(battle(players), List.of(), 1, 1001L);
        assertEquals(7, stats.size());
        assertTrue(stats.stream().noneMatch(TeamAutopsyStats::weakOutput),
                "enemy damage must not flip friendly weakOutput");
    }

    @Test
    void enemyDeathsNeverEnterFriendlyTimelineData() {
        final List<PlayerResult> players = sevenFriendlyPlayers();
        players.add(player(2001, 2, "Maus", 1000, false, 30));
        final List<TeamAutopsyStats> stats =
                new TeamAutopsyStatsBuilder().build(battle(players), List.of(), 1, 1001L);
        assertEquals(7, stats.size());
        assertTrue(stats.stream().noneMatch(s -> s.tankName().equals("Maus")));
    }

    @Test
    void flagsCarryTheirOwnConfidenceAndSettlementDowngradesWindow() {
        final Battle battle = battle(sevenFriendlyPlayers());
        final List<TeamAutopsyStats> stats = new TeamAutopsyStatsBuilder().build(
                battle, List.of(window(DecodeConfidence.EXACT)), 1, 1001L);
        // 录像者（P1=1001）窗口归因保持 EXACT；非录像者命中窗口降级为 PARTIAL
        final TeamAutopsyStats recorder = stats.stream()
                .filter(s -> s.accountId() == 1001L).findFirst().orElseThrow();
        assertFalse(recorder.settlementOnly());
        assertTrue(stats.stream().filter(s -> s.accountId() == 1004L)
                .findFirst().orElseThrow().deathInCriticalWindow());
        assertTrue(stats.stream().filter(s -> s.accountId() == 1004L)
                .findFirst().orElseThrow().deathInWindowConfidence() == DecodeConfidence.PARTIAL);
        assertTrue(stats.stream().filter(s -> s.accountId() == 1002L)
                .findFirst().orElseThrow().earlyDeath());
        assertTrue(stats.stream().filter(s -> s.accountId() == 1002L)
                .findFirst().orElseThrow().earlyDeathConfidence() == DecodeConfidence.EXACT);
        assertTrue(stats.stream().filter(s -> s.accountId() == 1003L)
                .findFirst().orElseThrow().weakOutput());
        assertTrue(stats.stream().allMatch(s -> s.settlementConfidence() == DecodeConfidence.EXACT));
    }

    @Test
    void invalidRecorderTeamReturnsEmpty() {
        assertTrue(new TeamAutopsyStatsBuilder().build(
                battle(sevenFriendlyPlayers()), List.of(), 3, 1001L).isEmpty());
    }
}
