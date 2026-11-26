package com.wotb.web.tournament.service;

import com.wotb.web.tournament.converter.TournamentCsvConverter;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import com.wotb.web.util.csv.CsvDecoder;
import com.wotb.web.util.csv.CsvEncodingException;
import com.wotb.web.util.csv.CsvSyntaxException;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

final class TournamentImportSupport {
    private TournamentImportSupport() { }
    record CsvSource(String name, String sha256, List<TournamentDtos.HistoricalRow> rows) { }
    static void requireCsvWorkspace(final List<TournamentDay> stored) {
        if (stored.stream().anyMatch(day -> day.draftGroups != null || day.correction)) { throw TournamentService.error(ApiErrorCode.TOURNAMENT_CSV_WORKSPACE_BUSY); }
    }
    static List<TournamentDay> csvDays(final TournamentEvent event, final Map<String, List<Integer>> matrix, final List<TournamentDay> stored) {
        final Map<String, TournamentDay> imported = historicalDays(event, matrix).stream().collect(Collectors.toMap(day -> TournamentService.key(day.roundNumber, day.dayNumber), day -> day));
        final List<TournamentDay> result = new ArrayList<>();
        for (int round = 1; round <= event.roundCount; round++) {
            for (int number = 1; number <= event.daysPerRound; number++) {
                final TournamentDay next = imported.getOrDefault(TournamentService.key(round, number), TournamentService.newDay(event.id, round, number));
                final int selectedRound = round; final int selectedDay = number;
                stored.stream().filter(day -> day.roundNumber == selectedRound && day.dayNumber == selectedDay)
                        .findFirst().ifPresent(day -> next.clearedClans = Set.copyOf(day.clearedClans));
                result.add(next);
            }
        }
        return result;
    }
    static TournamentDtos.CsvChanges csvChanges(final TournamentDtos.Standings before, final TournamentDtos.Standings after, final List<TournamentDay> stored) {
        final Map<String, TournamentDtos.StandingRow> old = before.rows().stream().collect(Collectors.toMap(TournamentDtos.StandingRow::clanTag, row -> row));
        final Map<String, TournamentDtos.StandingRow> next = after.rows().stream().collect(Collectors.toMap(TournamentDtos.StandingRow::clanTag, row -> row));
        final Set<String> tags = new HashSet<>(old.keySet()); tags.addAll(next.keySet());
        int addedClans = 0; int changedClans = 0; int removedClans = 0; int added = 0; int changed = 0; int removed = 0;
        for (final String tag : tags) {
            if (!old.containsKey(tag)) { addedClans++; }
            else if (!next.containsKey(tag)) { removedClans++; }
            else if (!old.get(tag).rounds().equals(next.get(tag).rounds())) { changedClans++; }
            final List<Long> oldValues = old.containsKey(tag) ? old.get(tag).rounds().stream().flatMap(round -> round.days().stream()).map(TournamentDtos.DayPoints::points).toList() : null;
            final List<Long> newValues = next.containsKey(tag) ? next.get(tag).rounds().stream().flatMap(round -> round.days().stream()).map(TournamentDtos.DayPoints::points).toList() : null;
            final int count = oldValues != null ? oldValues.size() : newValues.size();
            for (int cell = 0; cell < count; cell++) {
                final Long left = oldValues == null ? null : oldValues.get(cell); final Long right = newValues == null ? null : newValues.get(cell);
                if (left == null && right != null) { added++; } else if (left != null && right == null) { removed++; }
                else if (!Objects.equals(left, right)) { changed++; }
            }
        }
        final int clears = stored.stream().mapToInt(day -> day.clearedClans.size()).sum();
        return new TournamentDtos.CsvChanges(addedClans, changedClans, removedClans, added, changed, removed, clears);
    }
    static TournamentDtos.CsvChanges storedCsvChanges(final Map<String, Object> applied) {
        final Object saved = applied.get("changes");
        if (saved instanceof TournamentDtos.CsvChanges changes) { return changes; }
        final Map<?, ?> values = (Map<?, ?>) saved;
        return new TournamentDtos.CsvChanges(((Number) values.get("addedClans")).intValue(), ((Number) values.get("changedClans")).intValue(),
                ((Number) values.get("removedClans")).intValue(), ((Number) values.get("addedScores")).intValue(), ((Number) values.get("changedScores")).intValue(),
                ((Number) values.get("removedScores")).intValue(), ((Number) values.get("preservedClears")).intValue());
    }
    static CsvSource csvSource(final TournamentEvent event, final MultipartFile file) {
        final int limit = 2 * 1024 * 1024;
        if (file == null) { throw csvInvalid(0, "file", "empty"); }
        if (file.getSize() > limit) { throw TournamentService.error(ApiErrorCode.FILE_TOO_LARGE); }
        final byte[] bytes;
        try (final var input = file.getInputStream()) { bytes = input.readNBytes(limit + 1); }
        catch (final IOException failure) { throw csvInvalid(0, "file", "read"); }
        if (bytes.length > limit) { throw TournamentService.error(ApiErrorCode.FILE_TOO_LARGE); }
        if (bytes.length == 0) { throw csvInvalid(0, "file", "empty"); }
        final String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().replace('\\', '/');
        final String sourceName = name.substring(name.lastIndexOf('/') + 1).strip();
        if (!StringUtils.hasText(sourceName) || sourceName.codePointCount(0, sourceName.length()) > 200 || sourceName.codePoints().anyMatch(Character::isISOControl)) { throw csvInvalid(0, "file", "name"); }
        final List<TournamentDtos.HistoricalRow> rows = new ArrayList<>();
        final List<TournamentCsvConverter.Row> sourceRows;
        try {
            final var document = new CsvDecoder().decode(bytes);
            sourceRows = TournamentCsvConverter.convert(document, event.roundCount, event.daysPerRound);
        } catch (final CsvEncodingException failure) { throw csvInvalid(0, "file", "encoding"); }
        catch (final CsvSyntaxException failure) { throw csvInvalid(0, "file", "syntax"); }
        catch (final TournamentCsvConverter.InvalidCsv failure) { throw csvInvalid(failure.rowNumber(), failure.column(), failure.reason()); }
        catch (final IllegalArgumentException invalidHeader) { throw csvInvalid(1, "header", "header"); }
        final List<String> pointColumns = new ArrayList<>();
        for (int round = 1; round <= event.roundCount; round++) {
            for (int day = 1; day <= event.daysPerRound; day++) { pointColumns.add("R" + round + "D" + day); }
        }
        for (final TournamentCsvConverter.Row sourceRow : sourceRows) {
            final long rowNumber = sourceRow.rowNumber();
            if (rows.size() >= 10000) { throw csvInvalid(rowNumber, "file", "rows"); }
            final String tag;
            try { tag = TournamentService.clanTag(sourceRow.clanTag()); } catch (final ApiException invalidTag) { throw csvInvalid(rowNumber, "军团标签", "clanTag"); }
            final List<Integer> points = new ArrayList<>(); long sum = 0;
            for (int index = 0; index < pointColumns.size(); index++) {
                final String value = sourceRow.pointCells().get(index).strip();
                final Integer point = value.isEmpty() ? null : (int) csvNumber(value, 1_000_000, rowNumber, pointColumns.get(index));
                points.add(point); if (point != null) { sum += point; }
            }
            final long total = csvNumber(sourceRow.totalCell().strip(), (long) pointColumns.size() * 1_000_000, rowNumber, "总积分");
            if (sum != total) { throw csvInvalid(rowNumber, "总积分", "total"); }
            rows.add(new TournamentDtos.HistoricalRow(tag, points, total));
        }
        if (rows.isEmpty()) { throw csvInvalid(0, "file", "empty"); }
        try { return new CsvSource(sourceName, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)), List.copyOf(rows)); }
        catch (final NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable", impossible); }
    }
    static long csvNumber(final String text, final long maximum, final long row, final String column) {
        if (!text.matches("[0-9]+")) { throw csvInvalid(row, column, "number"); }
        try { final long value = Long.parseLong(text); if (value > maximum) { throw csvInvalid(row, column, "number"); } return value; }
        catch (final NumberFormatException invalidNumber) { throw csvInvalid(row, column, "number"); }
    }
    static ApiException csvInvalid(final long row, final String column, final String reason) {
        return new ApiException(ApiErrorCode.TOURNAMENT_CSV_INVALID, null, Map.of("rowNumber", row, "column", column, "reason", reason));
    }
    static boolean historicalTargetEmpty(final TournamentEvent event, final List<TournamentDay> storedDays) {
        return !event.csvImported && event.historicalImportKey == null && storedDays.stream().noneMatch(day -> day.draftGroups != null || TournamentService.published(day) || day.correction || !day.clearedClans.isEmpty());
    }
    static Map<String, List<Integer>> historicalMatrix(final TournamentEvent event, final String sourceName, final String sourceSha256, final List<TournamentDtos.HistoricalRow> input) {
        if (!StringUtils.hasText(sourceName) || sourceName.codePointCount(0, sourceName.length()) > 200 || sourceName.codePoints().anyMatch(Character::isISOControl)
                || sourceSha256 == null || !sourceSha256.matches("[a-f0-9]{64}") || input == null || input.isEmpty() || input.size() > 10000) { throw TournamentService.invalid(); }
        final int cellCount = event.roundCount * event.daysPerRound;
        final Map<String, List<Integer>> matrix = new LinkedHashMap<>();
        for (int rowIndex = 0; rowIndex < input.size(); rowIndex++) {
            final TournamentDtos.HistoricalRow row = input.get(rowIndex);
            if (row == null || row.points() == null || row.points().size() != cellCount || row.sourceTotal() < 0) { throw TournamentService.invalid(); }
            final String tag = TournamentService.clanTag(row.clanTag()); long total = 0;
            for (final Integer point : row.points()) {
                if (point != null) { if (point < 0 || point > 1_000_000) { throw TournamentService.invalid(); } total += point; }
            }
            if (total != row.sourceTotal()) { throw new ApiException(ApiErrorCode.INVALID_ARGUMENT, null, Map.of("sourceRow", rowIndex + 1, "clanTag", tag, "computedTotal", total, "sourceTotal", row.sourceTotal())); }
            final List<Integer> merged = matrix.computeIfAbsent(tag, ignored -> new ArrayList<>(java.util.Collections.nCopies(cellCount, null)));
            for (int column = 0; column < cellCount; column++) {
                final Integer next = row.points().get(column); if (next == null) { continue; }
                if (merged.get(column) != null) { throw new ApiException(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT, null, Map.of("sourceRow", rowIndex + 1, "clanTag", tag, "roundNumber", column / event.daysPerRound + 1, "dayNumber", column % event.daysPerRound + 1)); }
                merged.set(column, next);
            }
        }
        return matrix;
    }
    static List<TournamentDay> historicalDays(final TournamentEvent event, final Map<String, List<Integer>> matrix) {
        final List<TournamentDay> result = new ArrayList<>();
        for (int column = 0; column < event.roundCount * event.daysPerRound; column++) {
            final Map<String, Integer> values = new LinkedHashMap<>();
            for (final Map.Entry<String, List<Integer>> row : matrix.entrySet()) {
                final Integer point = row.getValue().get(column); if (point != null) { values.put(row.getKey(), point); }
            }
            if (values.isEmpty()) { continue; }
            final TournamentDay day = TournamentService.newDay(event.id, column / event.daysPerRound + 1, column % event.daysPerRound + 1);
            day.publishedHistoricalPoints = Map.copyOf(values); result.add(day);
        }
        return result;
    }
    static String historicalHash(final String sourceName, final String sourceSha256, final List<TournamentDtos.HistoricalRow> rows) {
        final StringBuilder canonical = new StringBuilder().append(sourceName.length()).append(':').append(sourceName).append(':').append(sourceSha256);
        for (final TournamentDtos.HistoricalRow row : rows) {
            final String tag = TournamentService.clanTag(row.clanTag()); canonical.append('|').append(tag.length()).append(':').append(tag).append(':').append(row.sourceTotal()).append(':').append(row.points());
        }
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8))); }
        catch (final NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable", impossible); }
    }
}
