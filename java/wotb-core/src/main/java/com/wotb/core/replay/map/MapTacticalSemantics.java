package com.wotb.core.replay.map;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 地图战术语义层（V1）：地图身份 + 战术区域 + 区域关系。
 * <p>只描述高层的战术区域特征（地形/适合车型/风险/关系），不做精确坐标/石头/草丛。
 * 语义数据缺失时用 {@link #UNKNOWN}，调用方必须如实输出 UNKNOWN，禁止 LLM 凭训练知识编造区域。</p>
 *
 * @param mapId         内部地图 code（meta.json 的 mapName，全小写）
 * @param areas         区域 id → 战术区域
 * @param relationships 区域关系（controls / connects / enablesPressureAgainst）
 */
public record MapTacticalSemantics(
        String mapId,
        Map<String, TacticalArea> areas,
        Map<String, AreaRelationships> relationships
) {
    public MapTacticalSemantics {
        mapId = mapId == null ? "" : mapId.toLowerCase(Locale.ROOT);
        areas = areas == null ? Map.of() : Map.copyOf(areas);
        relationships = relationships == null ? Map.of() : Map.copyOf(relationships);
    }

    /** 无语义数据时返回的空语义；{@link #hasSemantics()} 为 false。 */
    public static final MapTacticalSemantics UNKNOWN =
            new MapTacticalSemantics("", Map.of(), Map.of());

    public boolean hasSemantics() {
        return !areas.isEmpty();
    }

    /** 单个战术区域。 */
    public record TacticalArea(
            String id,
            String label,
            List<String> types,
            List<String> characteristics,
            List<String> favors,
            List<String> risks
    ) {
        public TacticalArea {
            id = id == null ? "" : id;
            label = label == null ? "" : label;
            types = types == null ? List.of() : List.copyOf(types);
            characteristics = characteristics == null ? List.of() : List.copyOf(characteristics);
            favors = favors == null ? List.of() : List.copyOf(favors);
            risks = risks == null ? List.of() : List.copyOf(risks);
        }
    }

    /** 区域之间的战术关系。 */
    public record AreaRelationships(
            List<String> controls,
            List<String> connects,
            List<String> enablesPressureAgainst
    ) {
        public AreaRelationships {
            controls = controls == null ? List.of() : List.copyOf(controls);
            connects = connects == null ? List.of() : List.copyOf(connects);
            enablesPressureAgainst = enablesPressureAgainst == null
                    ? List.of() : List.copyOf(enablesPressureAgainst);
        }
    }
}
