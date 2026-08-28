package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class DeathCascadeSkillTest {

    private static Battle battleWithDeaths() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", false, 100));
        players.add(EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", false, 108));
        players.add(EvidenceTestFixtures.player(1003, 1, 4481, "Kranvagn", false, 130));
        players.add(EvidenceTestFixtures.player(1004, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(2001, 2, 10785, "T110E5", false, 105));
        players.add(EvidenceTestFixtures.player(2002, 2, 10785, "T110E5", false, 110));
        players.add(EvidenceTestFixtures.player(2003, 2, 10785, "T110E5", true, 300));
        return EvidenceTestFixtures.battle(players);
    }

    @Test
    void clustersSameTeamDeathsWithinGap() {
        final List<AiEvidence> cascades = new DeathCascadeSkill().detect(battleWithDeaths(), 1);
        assertEquals(2, cascades.size());

        final AiEvidence friendly = cascades.stream()
                .filter(e -> "FRIENDLY".equals(e.labels().get("team")))
                .findFirst().orElseThrow();
        assertEquals(2.0, friendly.numbers().get("friendlyDeaths"));
        assertEquals(100f, friendly.startSec());
        assertEquals(108f, friendly.endSec());
        assertEquals(EvidenceProvenance.BACKEND_SKILL, friendly.provenance());

        final AiEvidence enemy = cascades.stream()
                .filter(e -> "TEAM_2".equals(e.labels().get("team")))
                .findFirst().orElseThrow();
        assertEquals(2.0, enemy.numbers().get("enemyDeaths"));
    }

    @Test
    void singleDeathsAreNotCascades() {
        final List<AiEvidence> cascades = new DeathCascadeSkill().detect(battleWithDeaths(), 2);
        // 130s 单亡不入连锁；两个有效连锁（TEAM_1 与 TEAM_2 各 2 辆）
        assertEquals(2, cascades.size());
        final AiEvidence enemyCascade = cascades.stream()
                .filter(e -> "TEAM_1".equals(e.labels().get("team")))
                .findFirst().orElseThrow();
        assertEquals(2.0, enemyCascade.numbers().get("enemyDeaths"));
    }

    @Test
    void unknownDeathTimesNeverCreateOpeningCascade() {
        final PlayerResult a = EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", false, 100);
        final PlayerResult b = EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", false, 108);
        a.deathTimeMillis = 0;
        a.survivalTimeSec = 0;
        a.deathTimeSource = DeathTimeSource.UNKNOWN;
        b.deathTimeMillis = 0;
        b.survivalTimeSec = 0;
        b.deathTimeSource = DeathTimeSource.UNKNOWN;
        final Battle battle = EvidenceTestFixtures.battle(List.of(a, b));

        assertEquals(List.of(), new DeathCascadeSkill().detect(battle, 1));
    }
}
