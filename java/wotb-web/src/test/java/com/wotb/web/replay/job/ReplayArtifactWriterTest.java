package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingDiagnostics;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Phase 5：derived artifact 原子写 + 读取往返 + MapOverview unavailable 语义。 */
class ReplayArtifactWriterTest {

    @Test
    void aiFactsRoundTripsToDisk() throws Exception {
        final Path jobDir = Files.createTempDirectory("wotb-artifact-test");
        try {
            final ReplayProcessingResult result = new ReplayProcessingResult(
                    "a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, battle("arena-1"),
                    null, ReplayProcessingDiagnostics.empty(),
                    ReplayProcessingCapabilities.summaryOnly(true), null, null);

            ReplayArtifactWriter.writeAiFacts(jobDir, 0, result);
            final AiReplayFacts facts = ReplayArtifactWriter.readAiFacts(jobDir, 0);

            assertEquals("a.wotbreplay", facts.fileName());
            assertEquals("arena-1", facts.battle().arenaId);
            assertEquals(ReplayProcessingStatus.SUCCESS, facts.status());
            assertTrue(Files.exists(ReplayArtifactWriter.aiFactsPath(jobDir, 0)));
        } finally {
            deleteRecursively(jobDir);
        }
    }

    @Test
    void mapOverviewRoundTripsToDiskAndNullSkips() throws Exception {
        final Path jobDir = Files.createTempDirectory("wotb-artifact-test");
        try {
            final MapOverview overview = new MapOverview(
                    "malinovka", "Malinovka", Map.of("zh", "马利诺夫卡"), 1,
                    new MapOverview.Bounds(0, 500, 0, 500), java.util.List.of(), null,
                    java.util.List.of(), java.util.List.of(), null, java.util.List.of(),
                    2, 123L, null);

            ReplayArtifactWriter.writeMapOverview(jobDir, 1, overview);
            final MapOverview read = ReplayArtifactWriter.readMapOverview(jobDir, 1);
            assertEquals("malinovka", read.mapCode());
            assertEquals(1, read.friendlyTeam());

            // MapOverview unavailable（null）→ 不写伪 artifact
            ReplayArtifactWriter.writeMapOverview(jobDir, 2, null);
            assertFalse(Files.exists(ReplayArtifactWriter.mapOverviewPath(jobDir, 2)));
            assertNull(ReplayArtifactWriter.readMapOverview(jobDir, 2));
        } finally {
            deleteRecursively(jobDir);
        }
    }

    private static Battle battle(final String arenaId) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.players = new ArrayList<>();
        final PlayerResult p = new PlayerResult();
        p.accountId = 1L;
        p.nickname = "p1";
        p.team = 1;
        battle.players.add(p);
        return battle;
    }

    private static void deleteRecursively(final Path dir) {
        try (var walk = Files.walk(dir)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (final Exception ignored) {
                    // best-effort test cleanup
                }
            });
        } catch (final Exception ignored) {
            // best-effort test cleanup
        }
    }
}
