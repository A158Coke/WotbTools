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

    /**
     * 无语义数据时返回的空语义；{@link #hasSemantics()} 为 false。
     */
    public static final MapTacticalSemantics UNKNOWN =
            new MapTacticalSemantics("", Map.of(), List.of(), Map.of(), false, "", "");

    public boolean hasSemantics() {
        return !areas.isEmpty();
    }

    /**
     * 单个战术区域。
     */
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

    /**
     * 区域可信度（语义化器 area.confidence）。
     * EXACT_CLIENT_DATA / EXACT_SCENE_DATA = 客户端直接事实；
     * NAME_HEURISTIC = 对象位置精确但建筑/植被/铁路等类别由资源名推断；
     * GRID_RULE_DERIVED = 区域名称/边界/合并是确定性规则候选；
     * RULE_DERIVED_CANDIDATE = favors/risks 只是战术假设候选。
     */
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

    /**
     * 区域关系（与 semantic.json 原始语义一致，不做有损分组/改名）。
     * type 可能为 ADJACENT_TO / HIGHER_THAN / CONTAINS_CONTROL_POINT /
     * CONTAINS_STRATEGIC_POINT；reason 与 confidence 必须原样保留。
     */
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

    /**
     * 单队出生点语义（语义化器 spawnSemantics 的子集）。
     * {@code status} 为 UNKNOWN 时仅表示出生点无法可靠确定，不得输出具体区域。
     */
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
