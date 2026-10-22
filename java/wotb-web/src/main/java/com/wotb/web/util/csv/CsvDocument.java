package com.wotb.web.util.csv;

import java.util.List;

/** Parsed CSV headers and logical records without application-specific meaning. */
public record CsvDocument(List<String> headers, List<CsvRow> rows) {
    public CsvDocument {
        headers = List.copyOf(headers);
        rows = List.copyOf(rows);
    }
}
