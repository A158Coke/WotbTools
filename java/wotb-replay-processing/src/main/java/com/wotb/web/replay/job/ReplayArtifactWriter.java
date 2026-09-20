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
 *
 * <p><b>artifact 单一 SSOT</b>：{@code *Content(...)} 方法是内容生成的唯一实现，写路径统一走
 * {@link ReplayArtifactSink}（本地文件 sink 见 {@link ReplayArtifactFileSink}）。{@code write*(Path,…)}
 * 静态方法只是 socket 默认 sink 的既有入口，保持本地行为逐字节不变。</p>
 */
public final class ReplayArtifactWriter {

    /** ai-facts artifact 文件名（sink 的 artifactName）。 */
    public static final String AI_FACTS_NAME = "ai-facts.json";

    /** map-overview artifact 文件名（sink 的 artifactName）。 */
    public static final String MAP_OVERVIEW_NAME = "map-overview.json";

    /** battle-playback-v2 artifact 文件名（sink 的 artifactName）。 */
    public static final String BATTLE_PLAYBACK_V2_NAME = "battle-playback-v2.json";

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private ReplayArtifactWriter() {
    }

    public static Path aiFactsPath(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve(AI_FACTS_NAME);
    }

    public static Path mapOverviewPath(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve(MAP_OVERVIEW_NAME);
    }

    /** V2 battle playback dataset 路径（仅当 canonical timeline 可用时写出）。 */
    public static Path battlePlaybackV2Path(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve(BATTLE_PLAYBACK_V2_NAME);
    }

    /**
     * ai-facts.json 的内容（唯一实现）：{@link ReplayFactsCodec} 的稳定编码。
     */
    public static byte[] aiFactsContent(final ReplayProcessingResult result) {
        return ReplayFactsCodec.toBytes(AiReplayFacts.fromResult(result));
    }

    /**
     * map-overview.json 的内容（唯一实现）；{@code overview == null}（capability unavailable）
     * 时返回 {@code null}：不写伪 artifact。
     */
    public static byte[] mapOverviewContent(final MapOverview overview) {
        if (overview == null) {
            return null;
        }
        return MAPPER.writeValueAsBytes(overview);
    }

    /**
     * battle-playback-v2.json 的内容（唯一实现）；{@code dataset == null}（timeline 不可用）
     * 时返回 {@code null}。
     */
    public static byte[] battlePlaybackV2Content(final BattlePlaybackDataset dataset) {
        if (dataset == null) {
            return null;
        }
        return MAPPER.writeValueAsBytes(dataset);
    }

    /** 写 ai-facts.json（worker 内调用，先写后 READY）。 */
    public static void writeAiFacts(final Path jobDir, final int sourceIndex,
                                    final ReplayProcessingResult result) throws IOException {
        writeAtomic(aiFactsPath(jobDir, sourceIndex), aiFactsContent(result));
    }

    /** 写 map-overview.json；overview == null（capability unavailable）时跳过。 */
    public static void writeMapOverview(final Path jobDir, final int sourceIndex,
                                        final MapOverview overview) throws IOException {
        final byte[] content = mapOverviewContent(overview);
        if (content == null) {
            return;
        }
        writeAtomic(mapOverviewPath(jobDir, sourceIndex), content);
    }

    /** 写 V2 battle playback dataset；dataset == null（timeline 不可用）时跳过。 */
    public static void writeBattlePlaybackV2(final Path jobDir, final int sourceIndex,
                                             final BattlePlaybackDataset dataset) throws IOException {
        final byte[] content = battlePlaybackV2Content(dataset);
        if (content == null) {
            return;
        }
        writeAtomic(battlePlaybackV2Path(jobDir, sourceIndex), content);
    }

    /** 读取 ai-facts（本地 job 目录路径；分布式走对象存储字节）。 */
    public static AiReplayFacts readAiFacts(final Path jobDir, final int sourceIndex) throws IOException {
        return decodeAiFacts(Files.readAllBytes(aiFactsPath(jobDir, sourceIndex)));
    }

    /** 读取 map-overview；文件不存在（unavailable）返回 null（Playback 204 语义，Phase 7）。 */
    public static MapOverview readMapOverview(final Path jobDir, final int sourceIndex) throws IOException {
        final Path path = mapOverviewPath(jobDir, sourceIndex);
        if (!Files.exists(path)) {
            return null;
        }
        return decodeMapOverview(Files.readAllBytes(path));
    }

    /** 读取 V2 battle playback dataset；文件不存在（unavailable）返回 null（204 语义）。 */
    public static BattlePlaybackDataset readBattlePlaybackV2(final Path jobDir, final int sourceIndex)
            throws IOException {
        final Path path = battlePlaybackV2Path(jobDir, sourceIndex);
        if (!Files.exists(path)) {
            return null;
        }
        return decodeBattlePlaybackV2(Files.readAllBytes(path));
    }

    /**
     * 字节 → ai-facts（**唯一解码实现**，本地文件与对象存储共用同一份语义）。
     *
     * @param content artifact 字节；{@code null}（对象/文件不存在）返回 {@code null}，由调用方
     *                决定「缺失」对它的含义（AI 路径是 DATASET_UNAVAILABLE）
     */
    public static AiReplayFacts decodeAiFacts(final byte[] content) throws IOException {
        return content == null ? null : ReplayFactsCodec.fromBytes(content);
    }

    /** 字节 → map-overview；{@code null}（unavailable）返回 {@code null}（204 语义）。 */
    public static MapOverview decodeMapOverview(final byte[] content) throws IOException {
        return content == null ? null : MAPPER.readValue(content, MapOverview.class);
    }

    /**
     * 字节 → V2 battle playback dataset（含 legacy 归一化）；{@code null}（unavailable）返回
     * {@code null}（204 语义）。
     */
    public static BattlePlaybackDataset decodeBattlePlaybackV2(final byte[] content) throws IOException {
        if (content == null) {
            return null;
        }
        final JsonNode root = MAPPER.readTree(content);
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
            normalizeLegacyHealthFacts(vehicleObject);
            removeUnknownTransitions(vehicleObject, "healthTransitions", "knowledge");
            removeUnknownTransitions(vehicleObject, "lifeTransitions", "lifeState");
            normalizeLegacyDamageFacts(vehicleObject);
            normalizeLegacyModuleFacts(vehicleObject);
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
        if (transitions == null || !transitions.isArray()) return;
        if (!(loadout instanceof ObjectNode loadoutObject)) {
            for (final JsonNode transition : transitions) {
                if (transition instanceof ObjectNode object && !object.has("invalidation")) {
                    object.put("invalidation", object.path("consumableSlot").isNull()
                            && "UNKNOWN".equals(object.path("state").asText()));
                }
            }
            return;
        }
        final JsonNode wires = loadoutObject.get("consumableWireCodes");
        for (final JsonNode transition : transitions) {
            if (!(transition instanceof ObjectNode transitionObject)) continue;
            if (transitionObject.has("invalidation")) continue;
            final JsonNode wireCode = transitionObject.get("wireCode");
            if (wireCode == null || !wireCode.isNumber() || wires == null || !wires.isArray()) {
                transitionObject.put("invalidation", transitionObject.path("consumableSlot").isNull()
                        && "UNKNOWN".equals(transitionObject.path("state").asText()));
                continue;
            }
            if (transitionObject.has("consumableSlot") && !transitionObject.get("consumableSlot").isNull()) {
                transitionObject.put("invalidation", false);
                continue;
            }
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
            transitionObject.put("invalidation", false);
        }
    }

    private static void normalizeLegacyHealthFacts(final ObjectNode vehicle) {
        final JsonNode transitions = vehicle.get("healthTransitions");
        if (!(transitions instanceof ArrayNode array)) return;
        for (final JsonNode transition : array) {
            if (!(transition instanceof ObjectNode object)) continue;
            if ("UNKNOWN".equals(object.path("knowledge").asText())) {
                object.putNull("currentHp");
                object.putNull("knowledge");
                object.putNull("source");
                object.putNull("displayCapacityHp");
                object.put("relativeFull", false);
            } else if (!object.has("relativeFull")) {
                object.put("relativeFull", object.path("currentHp").isNull()
                        && "CURRENT".equals(object.path("knowledge").asText()));
            }
        }
    }

    private static void normalizeLegacyDamageFacts(final ObjectNode vehicle) {
        final JsonNode losses = vehicle.get("damageLosses");
        if (!(losses instanceof ArrayNode array)) return;
        for (final JsonNode loss : array) {
            if (!(loss instanceof ObjectNode object)) continue;
            if (!object.has("fromHp")) object.putNull("fromHp");
            if (!object.has("toHp")) object.putNull("toHp");
            if (!object.has("displayCapacityHp")) object.putNull("displayCapacityHp");
            if (!object.has("transientAllowed")) object.put("transientAllowed", false);
        }
    }

    private static void normalizeLegacyModuleFacts(final ObjectNode vehicle) {
        final JsonNode transitions = vehicle.get("moduleCrewTransitions");
        if (!(transitions instanceof ArrayNode array)) return;
        for (int i = array.size() - 1; i >= 0; i--) {
            final JsonNode transition = array.get(i);
            if (!(transition instanceof ObjectNode object)) continue;
            final String state = object.path("state").asText();
            if ("FULL_REPAIRED_CLEAR".equals(state) || "CREW_HEALED".equals(state)) {
                object.putNull("state");
            } else if ("AUTO_REPAIRED_TO_DAMAGED".equals(state)) {
                object.put("state", "DAMAGED_DEGRADED");
            } else if ("UNKNOWN".equals(state)) {
                array.remove(i);
            }
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

    static Path derivedDir(final Path jobDir, final int sourceIndex) {
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
