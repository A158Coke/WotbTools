package com.wotb.web.util.csv;

import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CsvDecoderTest {
    private final CsvDecoder decoder = new CsvDecoder();
    private final Path fixtures = Path.of("../../common/fixtures/tabular/csv");

    private byte[] fixture(final String name) throws IOException { return Files.readAllBytes(fixtures.resolve(name)); }

    @Test void decodesBasicAndUnicodeFixtures() throws IOException {
        final var basic = decoder.decode(fixture("basic.csv"));
        assertEquals(java.util.List.of("name", "value", "empty"), basic.headers());
        assertEquals(java.util.List.of("alpha", "plain", ""), basic.rows().getFirst().cells());
        assertEquals(1L, basic.rows().getFirst().recordNumber());
        assertEquals(java.util.List.of("中文", "русский"), decoder.decode(fixture("unicode.csv")).rows().getFirst().cells());
    }

    @Test void decodesQuotesMultilineBomAndLfFixtures() throws IOException {
        assertEquals("a,b and \"quote\"", decoder.decode(fixture("quoted.csv")).rows().getFirst().cells().get(1));
        assertEquals("line one\r\nline two", decoder.decode(fixture("multiline.csv")).rows().getFirst().cells().get(1));
        assertEquals("name", decoder.decode(fixture("bom.csv")).headers().getFirst());
        assertEquals("line", decoder.decode(fixture("lf.csv")).rows().getFirst().cells().get(1));
    }

    @Test void preservesSingleColumnEmptyRecordsAtEndAndBetweenNeighbors() throws IOException {
        final var trailing = decoder.decode(fixture("trailing-empty-single.csv"));
        assertEquals(2, trailing.rows().size());
        assertEquals(java.util.List.of("before"), trailing.rows().get(0).cells());
        assertEquals(java.util.List.of(""), trailing.rows().get(1).cells());

        final var middle = decoder.decode(fixture("middle-empty-single.csv"));
        assertEquals(3, middle.rows().size());
        assertEquals(java.util.List.of("before"), middle.rows().get(0).cells());
        assertEquals(java.util.List.of(""), middle.rows().get(1).cells());
        assertEquals(java.util.List.of("after"), middle.rows().get(2).cells());
    }

    @Test void rejectsMalformedEncodingAndSyntaxWithNeutralErrors() {
        assertThrows(CsvEncodingException.class, () -> decoder.decode(new byte[] {(byte) 0xff}));
        assertThrows(CsvSyntaxException.class, () -> decoder.decode("a,b\r\n\"unterminated".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
}
