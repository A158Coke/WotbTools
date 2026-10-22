package com.wotb.web.tournament.converter;

import com.wotb.web.util.csv.CsvDocument;
import org.springframework.util.StringUtils;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/** Maps generic CSV records to the Tournament import column shape without applying score or clan rules. */
public final class TournamentCsvConverter {
    private TournamentCsvConverter() { }

    public static List<Row> convert(final CsvDocument document, final int roundCount, final int daysPerRound) {
        final List<String> headers = document.headers();
        final List<String> pointColumns = new ArrayList<>();
        for (int round = 1; round <= roundCount; round++) {
            for (int day = 1; day <= daysPerRound; day++) { pointColumns.add("R" + round + "D" + day); }
        }
        final Set<String> required = new HashSet<>(pointColumns);
        required.add("军团标签");
        required.add("总积分");
        final Set<String> actual = new HashSet<>(headers);
        if (actual.size() != headers.size() || !actual.containsAll(required)
                || actual.stream().anyMatch(header -> !required.contains(header) && !"积分排名".equals(header))) {
            throw new InvalidCsv(1, "header", "header");
        }

        final Map<String, Integer> indexes = java.util.stream.IntStream.range(0, headers.size()).boxed()
                .collect(Collectors.toMap(headers::get, index -> index));
        final int clanIndex = indexes.get("军团标签");
        final int totalIndex = indexes.get("总积分");
        final List<Integer> pointIndexes = pointColumns.stream().map(indexes::get).toList();
        final List<Row> rows = new ArrayList<>();
        for (final var csvRow : document.rows()) {
            final List<String> cells = csvRow.cells();
            final long rowNumber = csvRow.recordNumber() + 1;
            if (cells.stream().allMatch(value -> !StringUtils.hasText(value))) { continue; }
            if (cells.size() != headers.size()) { throw new InvalidCsv(rowNumber, "header", "columns"); }
            rows.add(new Row(rowNumber, cells.get(clanIndex), pointIndexes.stream().map(cells::get).toList(), cells.get(totalIndex)));
        }
        return List.copyOf(rows);
    }

    public record Row(long rowNumber, String clanTag, List<String> pointCells, String totalCell) {
        public Row { pointCells = List.copyOf(pointCells); }
    }

    public static final class InvalidCsv extends RuntimeException {
        private final long rowNumber;
        private final String column;
        private final String reason;

        private InvalidCsv(final long rowNumber, final String column, final String reason) {
            super(reason);
            this.rowNumber = rowNumber;
            this.column = column;
            this.reason = reason;
        }

        public long rowNumber() { return rowNumber; }
        public String column() { return column; }
        public String reason() { return reason; }
    }
}
