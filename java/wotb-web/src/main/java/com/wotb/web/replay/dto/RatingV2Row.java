package com.wotb.web.replay.dto;

import java.util.List;
import java.util.Map;

/** One historical Rating V2 result row; keys stay English for the admin SPA to localize. */
public record RatingV2Row(Map<String, Object> cells, List<RatingV2RadarAxis> radar) {

    public RatingV2Row(final Map<String, Object> cells) {
        this(cells, List.of());
    }
}
