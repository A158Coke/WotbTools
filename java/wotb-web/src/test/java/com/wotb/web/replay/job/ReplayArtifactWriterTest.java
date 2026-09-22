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

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.exc.InvalidFormatException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Derived artifact 编解码往返 + MapOverview unavailable 语义 + legacy 归一化只发生在读取边界。
 *
 * <p>artifact 只以 {@code byte[]} 在 sink 与 reader 之间传递（进程内解析路径已退出正式架构），
 * 因此这里锁定的是内容生成与解码这一对 SSOT，而不是任何本地文件布局。</p>
 */
class ReplayArtifactWriterTest {

    @Test
    void aiFactsRoundTripsThroughContentBytes() throws Exception {
        final ReplayProcessingResult result = new ReplayProcessingResult(
                "a.wotbreplay", ReplayProcessingStatus.SUCCESS, null, battle("arena-1"),
                null, ReplayProcessingDiagnostics.empty(),
                ReplayProcessingCapabilities.summaryOnly(true), null, null);

        final byte[] content = ReplayArtifactWriter.aiFactsContent(result);
        final AiReplayFacts facts = ReplayArtifactWriter.decodeAiFacts(content);

        assertEquals("a.wotbreplay", facts.fileName());
        assertEquals("arena-1", facts.battle().arenaId);
        assertEquals(ReplayProcessingStatus.SUCCESS, facts.status());
        assertNull(ReplayArtifactWriter.decodeAiFacts(null), "缺失 artifact 必须解出 null，而不是抛异常");
    }

    @Test
    void mapOverviewRoundTripsThroughContentBytesAndNullStaysUnavailable() throws Exception {
        final MapOverview overview = new MapOverview(
                "malinovka", "Malinovka", Map.of("zh", "马利诺夫卡"), 1,
                new MapOverview.Bounds(0, 500, 0, 500), java.util.List.of(), null,
                java.util.List.of(), java.util.List.of(), null, java.util.List.of(),
                2, 123L);

        final MapOverview read = ReplayArtifactWriter.decodeMapOverview(
                ReplayArtifactWriter.mapOverviewContent(overview));
        assertEquals("malinovka", read.mapCode());
        assertEquals(1, read.friendlyTeam());

        // MapOverview unavailable（null）→ 不产生伪 artifact 字节
        assertNull(ReplayArtifactWriter.mapOverviewContent(null));
        assertNull(ReplayArtifactWriter.decodeMapOverview(null));
    }

    @Test
    void legacyPlaybackArtifactConfidenceIsNormalizedOnlyAtReadBoundary() throws Exception {
        final byte[] legacyArtifact = """
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
                """.getBytes(StandardCharsets.UTF_8);

        final BattlePlaybackDataset read = ReplayArtifactWriter.decodeBattlePlaybackV2(legacyArtifact);
        assertEquals(BattlePlaybackDataset.ConfidenceDto.HIGH,
                read.vehicles().get(0).loadout().confidence());
        assertEquals(3, read.vehicles().get(0).loadout().consumables().size());
        assertEquals(9, read.vehicles().get(0).loadout().equipmentIds().size());
        assertEquals(java.util.Arrays.asList(13, 13, null), read.vehicles().get(0).loadout().consumableWireCodes());
        assertNull(read.vehicles().get(0).consumableTransitions().getFirst().consumableSlot(),
                "duplicate wire code must stay unresolved at the artifact read boundary");
        assertFalse(read.vehicles().get(0).consumableTransitions().getFirst().invalidation(),
                "duplicate known wire code is unresolved, not a global runtime invalidation");
        assertTrue(read.vehicles().get(0).damageLosses().isEmpty());
        assertEquals(1, read.vehicles().get(0).positionSegments().getFirst().samples().getFirst().x());
        assertEquals(1, read.vehicles().get(0).orientationSegments().size(),
                "legacy UNKNOWN orientation is a gap and must be removed at read boundary");
        assertEquals(1, read.vehicles().get(0).healthTransitions().size(),
                "legacy UNKNOWN health preserves its explicit invalidation boundary");
        assertNull(read.vehicles().get(0).healthTransitions().getFirst().currentHp());
        assertNull(read.vehicles().get(0).healthTransitions().getFirst().knowledge());
        assertFalse(read.vehicles().get(0).healthTransitions().getFirst().relativeFull());
        assertTrue(read.vehicles().get(0).lifeTransitions().isEmpty(),
                "legacy UNKNOWN life is a no-fact transition and must be removed at read boundary");
    }

    @Test
    void unrelatedConfidenceIsNotNormalizedAtReadBoundary() {
        final byte[] artifact = """
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
                """.getBytes(StandardCharsets.UTF_8);

        assertThrows(InvalidFormatException.class,
                () -> ReplayArtifactWriter.decodeBattlePlaybackV2(artifact),
                "unrelated health confidence must not be blanket-normalized");
    }

    @Test
    void newPlaybackArtifactRoundTripsWithTransportConfidence() throws Exception {
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

        final byte[] content = ReplayArtifactWriter.battlePlaybackV2Content(dataset);
        final String json = new String(content, StandardCharsets.UTF_8);
        final BattlePlaybackDataset read = ReplayArtifactWriter.decodeBattlePlaybackV2(content);

        assertTrue(json.contains("\"confidence\":\"HIGH\""));
        assertEquals(ConfidenceDto.HIGH, read.vehicles().get(0).loadout().confidence());
        assertNull(ReplayArtifactWriter.battlePlaybackV2Content(null), "timeline 不可用时不得产生伪 artifact");
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
}
