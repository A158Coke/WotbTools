package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.replay.event.DecodeConfidence;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

class CriticalWindowSkillTest {

    private static AiEvidence evidence(final EvidenceType type, final float start, final float end,
                                       final Map<String, Double> numbers, final EvidencePriority priority) {
        return new AiEvidence(
                "T_" + type, type, start, end, List.of(), numbers, Map.of(),
                DecodeConfidence.INFERRED, priority, EvidenceProvenance.BACKEND_SKILL, "test " + type);
    }

    @Test
    void mergesOverlappingSignalsIntoCriticalWindow() {
        final AiEvidence hp = evidence(EvidenceType.HP_MOMENTUM, 0f, 20f,
                Map.of("hpLeadBefore", 100.0, "hpLeadAfter", -2900.0,
                        "hpSwing", 3000.0, "poolEstimate", 8000.0,
                        "observedCoverage", 1.0), EvidencePriority.CRITICAL);
        final AiEvidence deaths = evidence(EvidenceType.DEATH_CASCADE, 10f, 22f,
                Map.of("friendlyDeaths", 2.0, "enemyDeaths", 0.0, "totalDeaths", 2.0),
                EvidencePriority.IMPORTANT);
        final AiEvidence support = evidence(EvidenceType.LOCAL_SUPPORT, 15f, 25f,
                Map.of("nearbyFriendlyBefore", 4.0, "nearbyFriendlyAfter", 1.0,
                        "nearbyEnemyBefore", 2.0, "nearbyEnemyAfter", 4.0,
                        "friendlyDelta", -3.0, "enemyDelta", 2.0),
                EvidencePriority.CRITICAL);

        final List<AiEvidence> windows = new CriticalWindowSkill().detect(List.of(hp, deaths, support));
        assertEquals(1, windows.size());
        final AiEvidence window = windows.getFirst();
        assertEquals(EvidenceType.CRITICAL_WINDOW, window.type());
        assertEquals(EvidencePriority.CRITICAL, window.priority());
        assertEquals(0f, window.startSec());
        assertEquals(25f, window.endSec());
        assertEquals(2.0, window.numbers().get("friendlyDeaths"));
        assertEquals(3000.0, window.numbers().get("teamHpSwing"));
        assertTrue(window.summary().contains("战局变化窗口"));
    }

    @Test
    void noSignalsYieldsNoWindows() {
        assertTrue(new CriticalWindowSkill().detect(List.of()).isEmpty());
    }

    @Test
    void normalOnlySignalsProduceNoWindow() {
        final AiEvidence route = evidence(EvidenceType.ROUTE, 0f, 45f, Map.of(),
                EvidencePriority.NORMAL);
        assertTrue(new CriticalWindowSkill().detect(List.of(route)).isEmpty());
    }
}
