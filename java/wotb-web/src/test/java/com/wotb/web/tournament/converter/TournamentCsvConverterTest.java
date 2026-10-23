package com.wotb.web.tournament.converter;

import com.wotb.web.util.csv.CsvDecoder;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TournamentCsvConverterTest {
    private final CsvDecoder decoder = new CsvDecoder();
    private final Path fixtures = Path.of("../../common/fixtures/tournament/csv");

    private byte[] fixture(final String name) throws IOException { return Files.readAllBytes(fixtures.resolve(name)); }

    @Test void mapsFourByTwoAndFiveByThreeCanonicalFixturesInTournamentColumnOrder() throws IOException {
        final var four = TournamentCsvConverter.convert(decoder.decode(fixture("4x2.csv")), 4, 2);
        assertEquals(3, four.size());
        assertEquals(2, four.getFirst().rowNumber());
        assertEquals("-KSR-", four.getFirst().clanTag());
        assertEquals(List.of("100", "", "0", "50", "", "25", "10", "15"), four.getFirst().pointCells());
        assertEquals("200", four.getFirst().totalCell());
        assertEquals("雪,豹*", four.get(1).clanTag());
        assertEquals("=SUM(A1:A2)", four.get(2).clanTag());

        final var five = TournamentCsvConverter.convert(decoder.decode(fixture("5x3.csv")), 5, 3);
        assertEquals(3, five.size());
        assertEquals(List.of("100", "", "0", "50", "", "25", "10", "15", "", "20", "0", "30", "", "40", "10"), five.getFirst().pointCells());
        assertEquals("300", five.getFirst().totalCell());
        assertEquals("雪,豹*", five.get(1).clanTag());
        assertEquals("500", five.get(1).totalCell());
        assertEquals("=CMD+1", five.get(2).clanTag());
    }

    @Test void rejectsRepeatedAndUnknownHeadersWithExistingHeaderLocation() {
        final var repeated = decoder.decode("军团标签,军团标签,R1D1,R1D2,R2D1,R2D2,R3D1,R3D2,R4D1,R4D2,总积分\r\nA,A,0,0,0,0,0,0,0,0,0".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        final var repeatedError = assertThrows(TournamentCsvConverter.InvalidCsv.class,
                () -> TournamentCsvConverter.convert(repeated, 4, 2));
        assertEquals(1, repeatedError.rowNumber());
        assertEquals("header", repeatedError.column());
        assertEquals("header", repeatedError.reason());
    }
}
