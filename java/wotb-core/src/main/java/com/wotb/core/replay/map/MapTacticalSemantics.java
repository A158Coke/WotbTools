package com.wotb.core.replay.map;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 地图战术语义层（V1）：地图身份 + 战术区域 + 区域关系 + 出生点语义 + 可信度。
 * <p>数据来自 {@code map-semanticizer}（Wot Blitz 客户端 SC2 + heightmap 解码，
 * 见仓库 {@code common/map-semantics/*.semantic.json}）。只描述高层的战术区域特征
 * （地形/适合车型/风险/关系），不做精确坐标/石头/草丛；语义数据缺失时用
 * {@link #UNKNOWN}，调用方必须如实输出 UNKNOWN，禁止 LLM 凭训练知识编造区域。
 * {@code verified} 为 false 表示尚未完成人工地图核验，区域候选不得描述为已验证事实。</p>
 *
 * @param mapId          内部地图 code（meta.json 的 mapName，全小写）
 * @param areas          区域 id → 战术区域
 * @param relationships  区域关系（原始语义：from / type / to / reason / confidence）
 * @param spawnSemantics 队伍 → 出生点语义（status / 区域）
 * @param verified       是否完成人工地图核验（false = 尚未核验）
 * @param source         语义数据来源（如 CLIENT_RESOURCE_DERIVED）
 * @param displayName    人类可读地图名（map_names.json 的 en 名；未收录时回退 mapId）
 */
public record MapTacticalSemantics(
        String mapId,
        Map<String, TacticalArea> areas,
        List<TacticalRelationship> relationships,
        Map<String, SpawnSemantics> spawnSemantics,
        boolean verified,
        String source,
        String displayName
) {
    public MapTacticalSemantics {
        mapId = mapId == null ? "" : mapId.toLowerCase(Locale.ROOT);
        areas = areas == null ? Map.of() : Map.copyOf(areas);
        relationships = relationships == null ? List.of() : List.copyOf(relationships);
        spawnSemantics = spawnSemantics == null ? Map.of() : Map.copyOf(spawnSemantics);
        source = source == null ? "" : source;
        displayName = displayName == null ? "" : displayName;
    }

    public static final MapTacticalSemantics UNKNOWN =
            new MapTacticalSemantics("", Map.of(), List.of(), Map.of(), false, "", "");

    public boolean hasSemantics() {
        return !areas.isEmpty();
    }

    public record TacticalArea(
            String id,
            String label,
            List<String> types,
            List<String> gridRegions,
            List<String> characteristics,
            List<String> favors,
            List<String> risks,
            AreaConfidence confidence
    ) {
        public TacticalArea {
            id = id == null ? "" : id;
            label = label == null ? "" : label;
            types = types == null ? List.of() : List.copyOf(types);
            gridRegions = gridRegions == null ? List.of() : List.copyOf(gridRegions);
            characteristics = characteristics == null ? List.of() : List.copyOf(characteristics);
            favors = favors == null ? List.of() : List.copyOf(favors);
            risks = risks == null ? List.of() : List.copyOf(risks);
            confidence = confidence == null ? AreaConfidence.UNKNOWN : confidence;
        }
    }

    public record AreaConfidence(
            String geometry,
            String objectPositions,
            String objectCategories,
            String areaBoundary,
            String favorsAndRisks
    ) {
        public AreaConfidence {
            geometry = geometry == null ? "" : geometry;
            objectPositions = objectPositions == null ? "" : objectPositions;
            objectCategories = objectCategories == null ? "" : objectCategories;
            areaBoundary = areaBoundary == null ? "" : areaBoundary;
            favorsAndRisks = favorsAndRisks == null ? "" : favorsAndRisks;
        }

        public static final AreaConfidence UNKNOWN =
                new AreaConfidence("", "", "", "", "");
    }

    public record TacticalRelationship(
            String from,
            String type,
            String to,
            String reason,
            String confidence
    ) {
        public TacticalRelationship {
            from = from == null ? "" : from;
            type = type == null ? "" : type;
            to = to == null ? "" : to;
            reason = reason == null ? "" : reason;
            confidence = confidence == null ? "" : confidence;
        }
    }

    public record SpawnSemantics(
            String status,
            int spawnCount,
            List<String> areas
    ) {
        public SpawnSemantics {
            status = status == null ? "" : status;
            spawnCount = Math.max(0, spawnCount);
            areas = areas == null ? List.of() : List.copyOf(areas);
        }
    }
}
