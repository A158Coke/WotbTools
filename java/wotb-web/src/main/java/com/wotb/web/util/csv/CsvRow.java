package com.wotb.web.util.csv;

import java.util.List;

/** One parsed logical CSV record, with its parser record number and ordered cells. */
public record CsvRow(long recordNumber, List<String> cells) {
    public CsvRow {
        cells = List.copyOf(cells);
    }
}
