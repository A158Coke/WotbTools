package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingDiagnostics;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConfidenceDto;
import com.wotb.web.replay.dto.BattlePlaybackDataset.VehicleBattleLoadoutDto;
import com.wotb.web.replay.dto.BattlePlaybackDataset.VehiclePlaybackTrack;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.exc.InvalidFormatException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
                    2, 123L);

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

    @Test
    void legacyPlaybackArtifactConfidenceIsNormalizedOnlyAtReadBoundary() throws Exception {
        final Path jobDir = Files.createTempDirectory("wotb-artifact-test");
        try {
            final Path path = ReplayArtifactWriter.battlePlaybackV2Path(jobDir, 0);
            Files.createDirectories(path.getParent());
            Files.writeString(path, """
                    {
                      "durationSec": 60, "mapCode": null, "friendlyTeam": 1,
                      "recorderAccountId": 7, "vehicles": [{
                        "accountId": 7, "playerName": "p", "tankId": 1, "tankName": "t",
                        "tankClass": "medium", "tankTier": 10, "team": 1, "friendly": true,
                        "loadout": {"replayVersion": null, "consumables": [],
                          "consumableWireCodes": [13, 13], "provisions": [], "provisionWireCodes": [],
                          "equipmentIds": [], "confidence": "EXACT"},
                        "positionSegments": [{"startSec": 0, "endSec": 1, "knowledge": "OBSERVED",
                          "interpolationAllowed": true, "samples": [{"timeSec": 0, "x": 1, "y": 2,
                          "knowledge": "OBSERVED"}]}], "orientationSegments": [{"startSec": 0,
                          "endSec": 1, "knowledge": "CURRENT", "samples": [{"timeSec": 0,
                          "hullYawDeg": 0, "turretRelativeYawDeg": 0, "knowledge": "CURRENT"}]}, {"startSec": 2,
                          "endSec": 3, "knowledge": "UNKNOWN", "samples": []}],
                        "healthTransitions": [{"timeSec": 1, "currentHp": null,
                          "knowledge": "UNKNOWN", "source": "UNKNOWN", "displayCapacityHp": null,
                          "confidence": "UNKNOWN"}],
                        "lifeTransitions": [{"timeSec": 1, "lifeState": "UNKNOWN", "destroyedKnownAtSec": null}],
                        "consumableTransitions": [{"timeSec": 1,
                          "consumableSlot": null, "logicalItemId": "REPAIR_KIT", "wireCode": 13,
                          "state": "ACTIVATED", "confidence": "HIGH"}], "moduleCrewTransitions": []
                      }], "events": [], "shots": [], "pointsSamples": [], "limitations": [],
                      "capability": "FULL", "arenaBonusType": null
                    }
                    """);

            final BattlePlaybackDataset read = ReplayArtifactWriter.readBattlePlaybackV2(jobDir, 0);
            assertEquals(BattlePlaybackDataset.ConfidenceDto.HIGH,
                    read.vehicles().get(0).loadout().confidence());
            assertEquals(3, read.vehicles().get(0).loadout().consumables().size());
            assertEquals(9, read.vehicles().get(0).loadout().equipmentIds().size());
            assertEquals(java.util.Arrays.asList(13, 13, null), read.vehicles().get(0).loadout().consumableWireCodes());
            assertNull(read.vehicles().get(0).consumableTransitions().getFirst().consumableSlot(),
                    "duplicate wire code must stay unresolved at the artifact read boundary");
            assertTrue(read.vehicles().get(0).damageLosses().isEmpty());
            assertEquals(1, read.vehicles().get(0).positionSegments().getFirst().samples().getFirst().x());
            assertEquals(1, read.vehicles().get(0).orientationSegments().size(),
                    "legacy UNKNOWN orientation is a gap and must be removed at read boundary");
            assertTrue(read.vehicles().get(0).healthTransitions().isEmpty(),
                    "legacy UNKNOWN health is a no-fact transition and must be removed at read boundary");
            assertTrue(read.vehicles().get(0).lifeTransitions().isEmpty(),
                    "legacy UNKNOWN life is a no-fact transition and must be removed at read boundary");
        } finally {
            deleteRecursively(jobDir);
        }
    }

    @Test
    void unrelatedConfidenceIsNotNormalizedAtReadBoundary() throws Exception {
        final Path jobDir = Files.createTempDirectory("wotb-artifact-test");
        try {
            final Path path = ReplayArtifactWriter.battlePlaybackV2Path(jobDir, 0);
            Files.createDirectories(path.getParent());
            Files.writeString(path, """
                    {
                      "durationSec": 60, "mapCode": null, "friendlyTeam": 1,
                      "recorderAccountId": 7, "vehicles": [{
                        "accountId": 7, "playerName": "p", "tankId": 1, "tankName": "t",
                        "tankClass": "medium", "tankTier": 10, "team": 1, "friendly": true,
                        "loadout": {"replayVersion": null, "consumables": [],
                          "consumableWireCodes": [], "provisions": [], "provisionWireCodes": [],
                          "equipmentIds": [], "confidence": "HIGH"},
                        "positionSegments": [], "orientationSegments": [],
                        "healthTransitions": [{"timeSec": 1, "currentHp": 100,
                          "knowledge": "CURRENT", "source": "EXACT_BATTLE_EVENT",
                          "displayCapacityHp": 100, "confidence": "EXACT"}],
                        "lifeTransitions": [], "consumableTransitions": [], "moduleCrewTransitions": []
                      }], "events": [], "shots": [], "pointsSamples": [], "limitations": [],
                      "capability": "FULL", "arenaBonusType": null
                    }
                    """);

            assertThrows(InvalidFormatException.class,
                    () -> ReplayArtifactWriter.readBattlePlaybackV2(jobDir, 0),
                    "unrelated health confidence must not be blanket-normalized");
        } finally {
            deleteRecursively(jobDir);
        }
    }

    @Test
    void newPlaybackArtifactRoundTripsWithTransportConfidence() throws Exception {
        final Path jobDir = Files.createTempDirectory("wotb-artifact-test");
        try {
            final VehicleBattleLoadoutDto loadout = new VehicleBattleLoadoutDto(
                    "11.19", java.util.Collections.nCopies(3, null), java.util.Collections.nCopies(3, null),
                    java.util.Collections.nCopies(3, null), java.util.Collections.nCopies(3, null),
                    java.util.Collections.nCopies(9, null), ConfidenceDto.HIGH);
            final VehiclePlaybackTrack vehicle = new VehiclePlaybackTrack(
                    7L, "p", 1L, "t", "medium", 10, 1, true, loadout,
                    List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
            final BattlePlaybackDataset dataset = new BattlePlaybackDataset(
                    60, null, 1, 7L, List.of(vehicle), List.of(), List.of(), List.of(),
                    BattlePlaybackDataset.Capability.FULL, null);

            ReplayArtifactWriter.writeBattlePlaybackV2(jobDir, 0, dataset);
            final String json = Files.readString(ReplayArtifactWriter.battlePlaybackV2Path(jobDir, 0));
            final BattlePlaybackDataset read = ReplayArtifactWriter.readBattlePlaybackV2(jobDir, 0);

            assertTrue(json.contains("\"confidence\":\"HIGH\""));
            assertEquals(ConfidenceDto.HIGH, read.vehicles().get(0).loadout().confidence());
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
