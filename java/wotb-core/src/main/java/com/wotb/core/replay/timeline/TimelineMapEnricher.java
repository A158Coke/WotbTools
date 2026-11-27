package com.wotb.core.replay.timeline;

import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class TimelineMapEnricher {

    private final String mapCode;
    private final MapTacticalSemanticsRegistry semanticsRegistry;
    private final MapTacticalSemantics semantics;

    public TimelineMapEnricher(final String mapCode) {
        this.mapCode = mapCode == null ? "" : mapCode.trim().toLowerCase(Locale.ROOT);
        this.semanticsRegistry = MapTacticalSemanticsRegistry.load();
        this.semantics = semanticsRegistry.semanticsFor(this.mapCode);
    }

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
                null,
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
