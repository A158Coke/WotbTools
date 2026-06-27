package com.wotb.web.dto;

import java.util.List;

public record RatingResponse(List<RatingRow> rows,
                             List<String[]> duplicates,
                             List<String[]> failures,
                             List<ColumnDef> ratingColumns) {
}