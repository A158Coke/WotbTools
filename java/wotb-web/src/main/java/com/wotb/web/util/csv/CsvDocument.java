package com.wotb.web.util.csv;

import java.util.List;

public record CsvDocument(List<String> headers, List<CsvRow> rows) {
    public CsvDocument {
        headers = List.copyOf(headers);
        rows = List.copyOf(rows);
    }
}
