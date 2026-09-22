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

/**
 * Derived Artifact 编解码：
 * <ul>
 *   <li>{@code *Content(...)} 是 artifact <b>字节生成</b>的唯一实现，落地由
 *       {@link ReplayArtifactSink} 决定（分布式 sink 写对象存储）；</li>
 *   <li>{@code decode*(...)} 是 <b>字节 → 模型</b>的唯一实现（含 legacy 归一化）；</li>
 *   <li>MapOverview 不可用（builder 返回 null）→ {@code null} 字节，不写伪 artifact，
 *       不判 parse failure；</li>
 *   <li>immutable JSON（Jackson）。</li>
 * </ul>
 *
 * <p>本类不再持有任何本地 job 目录布局：进程内解析路径已退出正式架构，artifact 只以
 * {@code byte[]} 在 sink 与 reader 之间传递。</p>
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

    /**
     * 字节 → ai-facts（**唯一解码实现**）。
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

}
