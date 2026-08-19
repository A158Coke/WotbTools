package com.wotb.core.replay.timeline;

import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * BattleFrame 车辆地图语义 enrich（确定性，复用 common/map-semantics）。
 * <p>边界（docs/current-plan.md §16.2）：只表达「该格含硬掩体/该位置较高/该区域有建筑」这类
 * 几何/语义证据，禁止声称 exact LOS / 具体障碍挡炮 / hull-down。仓库内无逐对象几何与
 * 逐位置 heightmap 栅格（只有聚合统计），因此 terrain/slope 只在可推导时给出候选，绝不编造。</p>
 */
public final class TimelineMapEnricher {

    private final String mapCode;
    private final MapTacticalSemanticsRegistry semanticsRegistry;
    private final MapTacticalSemantics semantics;

    public TimelineMapEnricher(final String mapCode) {
        this.mapCode = mapCode == null ? "" : mapCode.trim().toLowerCase(Locale.ROOT);
        this.semanticsRegistry = MapTacticalSemanticsRegistry.load();
        this.semantics = semanticsRegistry.semanticsFor(this.mapCode);
    }

    /**
     * 对位置采样 enrich；无位置时返回 UNKNOWN。
     */
    FrameMapState enrich(final EntityIndex.PosSample pos) {
        if (pos == null) {
            return FrameMapState.UNKNOWN;
        }
        final int region = MapRegionResolver.resolveRegionFromRaw(pos.x(), pos.z(), mapCode);
        final Integer gridRegion = region > 0 ? region : null;

        String areaId = null;
        final List<String> areaLabels = new ArrayList<>();
        final List<String> tags = new ArrayList<>();
        if (gridRegion != null && semantics.hasSemantics() && semantics.areas() != null) {
            for (final Map.Entry<String, MapTacticalSemantics.TacticalArea> e
                    : semantics.areas().entrySet()) {
                if (e.getValue().gridRegions() != null
                        && e.getValue().gridRegions().contains("GRID_REGION_" + gridRegion)) {
                    if (areaId == null) {
                        areaId = e.getKey();
                    }
                    if (e.getValue().label() != null && !e.getValue().label().isBlank()) {
                        areaLabels.add(e.getValue().label());
                    }
                    if (e.getValue().types() != null) {
                        tags.addAll(e.getValue().types());
                    }
                    if (e.getValue().characteristics() != null) {
                        tags.addAll(e.getValue().characteristics());
                    }
                }
            }
        }

        final Float elevation = Float.isFinite(pos.y()) ? pos.y() : null;
        final String confidence = semantics.hasSemantics()
                ? (semantics.verified() ? "VERIFIED_SEMANTIC" : "RULE_DERIVED_CANDIDATE")
                : "UNKNOWN_SEMANTIC";

        return new FrameMapState(
                gridRegion,
                areaId,
                List.copyOf(areaLabels),
                List.copyOf(tags),
                elevation,
                null, // slope 需要相邻采样推导，当前不编造
                null,
                hasTag(tags, "HARD_COVER") ? Boolean.TRUE : null,
                hasTag(tags, "SOFT_COVER") ? Boolean.TRUE : null,
                hasTag(tags, "VEGETATION") ? Boolean.TRUE : null,
                hasTag(tags, "RIDGE") ? Boolean.TRUE : null,
                hasTag(tags, "OPEN_GROUND") ? Boolean.TRUE : null,
                confidence);
    }

    private static boolean hasTag(final List<String> tags, final String needle) {
        if (tags == null) {
            return false;
        }
        final String upper = needle.toUpperCase(Locale.ROOT);
        for (final String tag : tags) {
            if (tag != null && tag.toUpperCase(Locale.ROOT).contains(upper)) {
                return true;
            }
        }
        return false;
    }
}
