package com.wotb.web.replay.dto;

import java.util.List;

public record PerformanceResponse(List<PerformanceRow> rows,
                                  List<String[]> duplicates,
                                  List<String[]> failures,
                                  List<ColumnDef> performanceColumns) {
}
