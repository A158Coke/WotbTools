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

    private static PlayerResult player(final long accountId, final String tankName,
                                       final int damageDealt, final boolean survived,
                                       final double deathSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = 1;
        p.tankId = 4481;
        p.tankName = tankName;
        p.damageDealt = damageDealt;
        p.damageReceived = 1000;
        p.survived = survived;
        p.deathTimeMillis = survived ? 0 : (long) (deathSec * 1000);
        p.survivalTimeSec = survived ? 300.0 : deathSec;
        return p;
    }

    @Test
    void buildsSevenPlayersWithDeterministicFlags() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(player(1001, "Kranvagn", 3000, true, 0));
        players.add(player(1002, "T110E5", 2000, false, 100));   // 早死（< 150s）
        players.add(player(1003, "E 100", 100, false, 200));      // 输出不足（均值 ~1586 × 0.5 ≈ 793）
        players.add(player(1004, "Leopard 1", 1500, false, 170)); // 窗口 [160,200] 内阵亡
        players.add(player(1005, "E 50 M", 1500, true, 0));
        players.add(player(1006, "T-62A", 1500, true, 0));
        players.add(player(1007, "STB-1", 1500, true, 0));
        final Battle battle = new Battle();
        battle.mapName = "erlenberg";
        battle.durationS = 300.0;
        battle.players = players;
        final AiEvidence window = new AiEvidence(
                "CW_01", EvidenceType.CRITICAL_WINDOW, 160f, 200f,
                List.of(), Map.of(), Map.of(), DecodeConfidence.INFERRED,
                EvidencePriority.CRITICAL, EvidenceProvenance.BACKEND_SKILL, "窗口");

        final List<TeamAutopsyStats> stats =
                new TeamAutopsyStatsBuilder().build(battle, List.of(window), 1001L);

        assertEquals(7, stats.size());
        final TeamAutopsyStats recorder = stats.stream()
                .filter(s -> s.accountId() == 1001L).findFirst().orElseThrow();
        assertFalse(recorder.settlementOnly(), "录像者有窗口证据，不应标记结算代理");
        assertTrue(stats.stream().filter(s -> s.accountId() == 1002L)
                .findFirst().orElseThrow().earlyDeath());
        assertTrue(stats.stream().filter(s -> s.accountId() == 1003L)
                .findFirst().orElseThrow().weakOutput());
        assertTrue(stats.stream().filter(s -> s.accountId() == 1004L)
                .findFirst().orElseThrow().deathInCriticalWindow());
        assertTrue(stats.stream().allMatch(s -> s.confidence() == DecodeConfidence.EXACT));
        assertTrue(stats.stream().filter(s -> s.accountId() != 1001L)
                .allMatch(TeamAutopsyStats::settlementOnly));
    }
}
