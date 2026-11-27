package com.wotb.web.util.csv;

import java.util.List;

public record CsvRow(long recordNumber, List<String> cells) {
    public CsvRow {
        cells = List.copyOf(cells);
    }
}
