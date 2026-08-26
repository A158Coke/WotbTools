package com.wotb.web.replay.dto;

import java.util.List;

/** Admin-only historical Rating V2 response for one existing processing job. */
public record RatingV2Response(List<RatingV2Row> rows,
                               List<String[]> duplicates,
                               List<String[]> failures,
                               List<ColumnDef> columns) {
}
