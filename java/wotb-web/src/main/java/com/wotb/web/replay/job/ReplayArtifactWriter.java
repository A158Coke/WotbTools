package com.wotb.web.replay.job;

import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import com.wotb.web.replay.dto.MapOverview;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Derived Artifact 读写：
 * <ul>
 *   <li>路径固定 {@code <jobDir>/derived/{sourceId}/ai-facts.json} 与
 *       {@code map-overview.json}（sourceId = r{sourceIndex}，sourceName 不入路径）；</li>
 *   <li>写：临时文件 + atomic move，先写 artifact 后置 source READY；</li>
 *   <li>MapOverview 不可用（builder 返回 null）→ 不写伪 artifact，不判 parse failure；</li>
 *   <li>immutable JSON（Jackson），TTL 由 job 目录清理接管。</li>
 * </ul>
 */
public final class ReplayArtifactWriter {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private ReplayArtifactWriter() {
    }

    public static Path aiFactsPath(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve("ai-facts.json");
    }

    public static Path mapOverviewPath(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve("map-overview.json");
    }

    /** V2 battle playback dataset 路径（仅当 canonical timeline 可用时写出）。 */
    public static Path battlePlaybackV2Path(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve("battle-playback-v2.json");
    }

    /** 写 ai-facts.json（worker 内调用，先写后 READY）。 */
    public static void writeAiFacts(final Path jobDir, final int sourceIndex,
                                    final ReplayProcessingResult result) throws IOException {
        writeAtomic(aiFactsPath(jobDir, sourceIndex),
                ReplayFactsCodec.toBytes(AiReplayFacts.fromResult(result)));
    }

    /** 写 map-overview.json；overview == null（capability unavailable）时跳过。 */
    public static void writeMapOverview(final Path jobDir, final int sourceIndex,
                                        final MapOverview overview) throws IOException {
        if (overview == null) {
            return;
        }
        writeAtomic(mapOverviewPath(jobDir, sourceIndex), MAPPER.writeValueAsBytes(overview));
    }

    /** 写 V2 battle playback dataset；dataset == null（timeline 不可用）时跳过。 */
    public static void writeBattlePlaybackV2(final Path jobDir, final int sourceIndex,
                                             final BattlePlaybackDataset dataset) throws IOException {
        if (dataset == null) {
            return;
        }
        writeAtomic(battlePlaybackV2Path(jobDir, sourceIndex), MAPPER.writeValueAsBytes(dataset));
    }

    /** 读取 ai-facts（AI Dataset 迁移 Phase 6 用）。 */
    public static AiReplayFacts readAiFacts(final Path jobDir, final int sourceIndex) throws IOException {
        return ReplayFactsCodec.fromBytes(Files.readAllBytes(aiFactsPath(jobDir, sourceIndex)));
    }

    /** 读取 map-overview；文件不存在（unavailable）返回 null（Playback 204 语义，Phase 7）。 */
    public static MapOverview readMapOverview(final Path jobDir, final int sourceIndex) throws IOException {
        final Path path = mapOverviewPath(jobDir, sourceIndex);
        if (!Files.exists(path)) {
            return null;
        }
        return MAPPER.readValue(Files.readAllBytes(path), MapOverview.class);
    }

    /** 读取 V2 battle playback dataset；文件不存在（unavailable）返回 null（204 语义）。 */
    public static BattlePlaybackDataset readBattlePlaybackV2(final Path jobDir, final int sourceIndex)
            throws IOException {
        final Path path = battlePlaybackV2Path(jobDir, sourceIndex);
        if (!Files.exists(path)) {
            return null;
        }
        final JsonNode root = MAPPER.readTree(Files.readAllBytes(path));
        normalizeLegacyPlayback(root);
        return MAPPER.treeToValue(root, BattlePlaybackDataset.class);
    }

    /**
     * Legacy persisted V2 artifacts used the domain enum names. Normalize only while reading
     * the persisted artifact; new HTTP responses remain strictly transport-contract shaped.
     */
    private static void normalizeLegacyPlayback(final JsonNode root) {
        if (!(root instanceof ObjectNode object)) {
            return;
        }
        object.remove("shots");
        final JsonNode capability = object.get("capability");
        if (capability != null && "UNAVAILABLE".equals(capability.asText())) {
            object.put("capability", object.path("limitations").isArray()
                    && object.path("limitations").size() > 0 ? "PARTIAL" : "FULL");
        }
        final JsonNode vehicles = object.get("vehicles");
        if (vehicles == null || !vehicles.isArray()) {
            return;
        }
        for (final JsonNode vehicle : vehicles) {
            if (!(vehicle instanceof ObjectNode vehicleObject)) {
                continue;
            }
            if (!vehicleObject.has("damageLosses")) vehicleObject.putArray("damageLosses");
            removeSampleKnowledge(vehicleObject, "positionSegments");
            removeSampleKnowledge(vehicleObject, "orientationSegments");
            removeUnknownTransitions(vehicleObject, "orientationSegments", "knowledge");
            removeUnknownTransitions(vehicleObject, "healthTransitions", "knowledge");
            removeUnknownTransitions(vehicleObject, "lifeTransitions", "lifeState");
            normalizeLegacyLoadout(vehicleObject);
            normalizeConsumableSlots(vehicleObject);
            if (!(vehicleObject.get("loadout") instanceof ObjectNode loadout)) {
                continue;
            }
            final JsonNode confidence = loadout.get("confidence");
            if (confidence != null && confidence.isTextual()) {
                final String normalized = switch (confidence.asString()) {
                    case "EXACT" -> "HIGH";
                    case "INFERRED" -> "MEDIUM";
                    case "PARTIAL" -> "LOW";
                    case "UNKNOWN" -> "UNKNOWN";
                    default -> confidence.asString();
                };
                loadout.put("confidence", normalized);
            }
        }
    }

    private static void removeSampleKnowledge(final ObjectNode vehicle, final String segmentsField) {
        final JsonNode segments = vehicle.get(segmentsField);
        if (segments == null || !segments.isArray()) return;
        for (final JsonNode segment : segments) {
            if (!(segment instanceof ObjectNode segmentObject)) continue;
            final JsonNode samples = segmentObject.get("samples");
            if (samples == null || !samples.isArray()) continue;
            for (final JsonNode sample : samples) {
                if (sample instanceof ObjectNode sampleObject) sampleObject.remove("knowledge");
            }
        }
    }

    private static void removeUnknownTransitions(final ObjectNode vehicle,
                                                 final String field,
                                                 final String stateField) {
        final JsonNode transitions = vehicle.get(field);
        if (!(transitions instanceof ArrayNode array)) return;
        for (int i = array.size() - 1; i >= 0; i--) {
            final JsonNode transition = array.get(i);
            if (transition instanceof ObjectNode object
                    && "UNKNOWN".equals(object.path(stateField).asText())) {
                array.remove(i);
            }
        }
    }

    private static void normalizeConsumableSlots(final ObjectNode vehicle) {
        final JsonNode loadout = vehicle.get("loadout");
        final JsonNode transitions = vehicle.get("consumableTransitions");
        if (!(loadout instanceof ObjectNode loadoutObject) || transitions == null || !transitions.isArray()) return;
        final JsonNode wires = loadoutObject.get("consumableWireCodes");
        for (final JsonNode transition : transitions) {
            if (!(transition instanceof ObjectNode transitionObject)
                    || (transitionObject.has("consumableSlot")
                    && !transitionObject.get("consumableSlot").isNull())) continue;
            final JsonNode wireCode = transitionObject.get("wireCode");
            if (wireCode == null || !wireCode.isNumber() || wires == null || !wires.isArray()) continue;
            int match = -1;
            for (int i = 0; i < wires.size(); i++) {
                if (wires.get(i).isNumber() && wires.get(i).intValue() == wireCode.intValue()) {
                    if (match >= 0) {
                        match = -2;
                        break;
                    }
                    match = i;
                }
            }
            if (match >= 0) transitionObject.put("consumableSlot", match);
        }
    }

    /** Normalize only legacy persisted loadouts before constructing the strict current DTO. */
    private static void normalizeLegacyLoadout(final ObjectNode vehicle) {
        if (!(vehicle.get("loadout") instanceof ObjectNode loadout)) return;
        normalizeLegacyArray(loadout, "consumables", 3);
        normalizeLegacyArray(loadout, "consumableWireCodes", 3);
        normalizeLegacyArray(loadout, "provisions", 3);
        normalizeLegacyArray(loadout, "provisionWireCodes", 3);
        normalizeLegacyArray(loadout, "equipmentIds", 9);
    }

    private static void normalizeLegacyArray(final ObjectNode object, final String field, final int size) {
        final JsonNode source = object.get(field);
        if (source != null && !source.isArray()) return;
        final ArrayNode normalized = object.putArray(field);
        if (source != null) {
            for (int i = 0; i < Math.min(source.size(), size); i++) normalized.add(source.get(i));
        }
        while (normalized.size() < size) normalized.addNull();
    }

    private static Path derivedDir(final Path jobDir, final int sourceIndex) {
        return jobDir.resolve("derived").resolve("r" + sourceIndex);
    }

    private static void writeAtomic(final Path target, final byte[] data) throws IOException {
        Files.createDirectories(target.getParent());
        final Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, data);
        try {
            Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (final AtomicMoveNotSupportedException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
