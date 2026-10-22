package com.wotb.web.util.csv;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import java.io.IOException;
import java.io.StringReader;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Strict UTF-8 and RFC4180 decoder for generic string tables. */
public final class CsvDecoder {
    public CsvDocument decode(final byte[] bytes) {
        final String text = decodeUtf8(bytes);
        try (final CSVParser parser = CSVFormat.RFC4180.builder().setHeader().setSkipHeaderRecord(true).setIgnoreEmptyLines(true)
                .get().parse(new StringReader(text))) {
            final List<CsvRow> rows = new ArrayList<>();
            for (final CSVRecord record : parser) {
                rows.add(new CsvRow(record.getRecordNumber(), record.toList()));
            }
            return new CsvDocument(parser.getHeaderNames(), rows);
        } catch (final IOException | UncheckedIOException failure) {
            throw new CsvSyntaxException(failure);
        }
    }

    private String decodeUtf8(final byte[] bytes) {
        try {
            final String decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            return decoded.startsWith("\ufeff") ? decoded.substring(1) : decoded;
        } catch (final CharacterCodingException failure) {
            throw new CsvEncodingException(failure);
        }
    }
}
