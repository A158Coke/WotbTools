package com.wotb.core.parse;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReplayParserTest {

    @Test
    void parseLongTreatsWhitespaceAsMissing() throws ReflectiveOperationException {
        final Method parseLong = ReplayParser.class.getDeclaredMethod("parseLong", String.class);
        parseLong.setAccessible(true);

        assertNull(invokeParseLong(parseLong, "   "));
        assertEquals(1719835200000L, invokeParseLong(parseLong, " 1719835200000 "));
    }

    @Test
    void parsesMinimalReplayWithExpectedEntries() throws IOException {
        final byte[] protobuf = {0x18, 0x01};
        final byte[] pickle = {
                (byte) 0x80, 0x04,
                'K', 42,
                'C', (byte) protobuf.length, protobuf[0], protobuf[1],
                (byte) 0x86,
                '.'
        };
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("meta.json", "{}".getBytes(StandardCharsets.UTF_8));
        entries.put("battle_results.dat", pickle);

        final Battle battle = ReplayParser.parse(zip(entries));

        assertEquals("42", battle.arenaId);
        assertEquals(1, battle.winnerTeam);
        assertTrue(battle.players.isEmpty());
    }

    @Test
    void parsesSupremacyVictoryPointsFromBattleResults() throws IOException {
        // info: #32 earned=300, #33 seized=120, #101 account=42, #102 team=1
        final ByteArrayOutputStream info = new ByteArrayOutputStream();
        writeField(info, 32, 300);
        writeField(info, 33, 120);
        writeField(info, 101, 42);
        writeField(info, 102, 1);
        // playerResults entry: #2 = info
        final ByteArrayOutputStream entry = new ByteArrayOutputStream();
        writeBytesField(entry, 2, info.toByteArray());
        // root: winner #3 = 1, players #301 = entry
        final ByteArrayOutputStream root = new ByteArrayOutputStream();
        writeField(root, 3, 1);
        writeBytesField(root, 301, entry.toByteArray());

        final Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("meta.json", "{}".getBytes(StandardCharsets.UTF_8));
        entries.put("battle_results.dat", pickle(root.toByteArray()));

        final Battle battle = ReplayParser.parse(zip(entries));
        assertEquals(1, battle.players.size());
        final PlayerResult p = battle.players.get(0);
        assertEquals(42, p.accountId);
        assertEquals(1, p.team);
        assertEquals(300, p.victoryPointsEarned);
        assertEquals(120, p.victoryPointsSeized);
    }

    @Test
    void rejectsUnexpectedZipEntry() throws IOException {
        final IOException error = assertThrows(IOException.class,
                () -> ReplayParser.parse(zip(Map.of("payload.bin", new byte[0]))));

        assertEquals("Unexpected replay entry: payload.bin", error.getMessage());
    }

    @Test
    void normalizesClanPrefixedRecorderToPureNickname() throws IOException {
        // meta playerName = "CHRD-A158布丁"（军团-昵称拼接），roster nickname = "A158布丁"：
        // 录像者必须归一化为纯昵称，禁止把军团名当玩家名
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("meta.json",
                "{\"playerName\":\"CHRD-A158布丁\",\"arenaBonusType\":1}".getBytes(StandardCharsets.UTF_8));
        entries.put("battle_results.dat", pickle(clanPrefixedFixtureRoot()));

        final Battle battle = ReplayParser.parse(zip(entries));

        assertEquals("A158布丁", battle.recorder,
                "recorder must be the pure roster nickname, not the clan-prefixed meta playerName");
        assertNotNull(battle.recorderResult());
        assertEquals("A158布丁", battle.recorderResult().nickname);
        assertEquals("CHRD", battle.recorderResult().clan);
    }

    @Test
    void keepsPureNicknameRecorderUnchanged() throws IOException {
        // meta playerName 已是纯昵称：保持不变
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("meta.json",
                "{\"playerName\":\"A158布丁\"}".getBytes(StandardCharsets.UTF_8));
        entries.put("battle_results.dat", pickle(clanPrefixedFixtureRoot()));

        final Battle battle = ReplayParser.parse(zip(entries));

        assertEquals("A158布丁", battle.recorder);
        assertNotNull(battle.recorderResult());
    }

    /** roster #201（nickname=A158布丁 / clan=CHRD）+ 成绩 #301（account=1001, team=1）的 protobuf 根消息。 */
    private static byte[] clanPrefixedFixtureRoot() {
        final ByteArrayOutputStream rosterInfo = new ByteArrayOutputStream();
        writeStringField(rosterInfo, 1, "A158布丁");
        writeStringField(rosterInfo, 5, "CHRD");
        final ByteArrayOutputStream rosterEntry = new ByteArrayOutputStream();
        writeField(rosterEntry, 1, 1001);
        writeBytesField(rosterEntry, 2, rosterInfo.toByteArray());

        final ByteArrayOutputStream resultInfo = new ByteArrayOutputStream();
        writeField(resultInfo, 101, 1001);
        writeField(resultInfo, 102, 1);
        writeField(resultInfo, 103, 4481);
        writeField(resultInfo, 8, 500);
        writeField(resultInfo, 105, -1);
        final ByteArrayOutputStream resultEntry = new ByteArrayOutputStream();
        writeBytesField(resultEntry, 2, resultInfo.toByteArray());

        final ByteArrayOutputStream root = new ByteArrayOutputStream();
        writeField(root, 3, 1);
        writeBytesField(root, 201, rosterEntry.toByteArray());
        writeBytesField(root, 301, resultEntry.toByteArray());
        return root.toByteArray();
    }

    @Test
    void rejectsArchiveWithTooManyEntries() throws IOException {
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("meta.json", new byte[0]);
        entries.put("battle_results.dat", new byte[0]);
        entries.put("data.wotreplay", new byte[0]);
        entries.put("extra.bin", new byte[0]);

        final IOException error = assertThrows(IOException.class, () -> ReplayParser.parse(zip(entries)));

        assertEquals("Replay archive contains too many entries", error.getMessage());
    }

    @Test
    void rejectsDuplicateZipEntry() throws IOException {
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("meta.json", "{}".getBytes(StandardCharsets.UTF_8));
        entries.put("fake.json", "{}".getBytes(StandardCharsets.UTF_8));
        final byte[] archive = zip(entries);
        assertEquals(2, replaceAllAscii(archive, "fake.json", "meta.json"));

        final IOException error = assertThrows(IOException.class, () -> ReplayParser.parse(archive));

        assertEquals("Duplicate replay entry: meta.json", error.getMessage());
    }

    @Test
    void rejectsEntryWhoseInflatedDataExceedsLimit() throws IOException {
        final byte[] archive = zipRepeated(
                new EntrySpec("meta.json", ReplayParser.MAX_META_JSON_BYTES + 1));

        final IOException error = assertThrows(IOException.class, () -> ReplayParser.parse(archive));

        assertEquals("Replay entry too large: meta.json", error.getMessage());
    }

    @Test
    void rejectsCompressedArchiveWhoseInputExceedsLimit() {
        final byte[] archive = new byte[ReplayParser.MAX_ARCHIVE_BYTES + 1];

        final IOException error = assertThrows(IOException.class, () -> ReplayParser.parse(archive));

        assertEquals("Replay archive exceeds compressed size limit", error.getMessage());
    }

    @Test
    void rejectsArchiveWhoseTotalInflatedDataExceedsLimit() throws IOException {
        final int battleBytes = ReplayParser.MAX_TOTAL_UNCOMPRESSED_BYTES
                - ReplayParser.MAX_DATA_WOTREPLAY_BYTES + 1;
        final byte[] archive = zipRepeated(
                new EntrySpec("data.wotreplay", ReplayParser.MAX_DATA_WOTREPLAY_BYTES),
                new EntrySpec("battle_results.dat", battleBytes));

        final IOException error = assertThrows(IOException.class, () -> ReplayParser.parse(archive));

        assertEquals("Replay uncompressed data exceeds total size limit", error.getMessage());
    }

    @Test
    void rejectsMissingBattleResultsWithStableError() throws IOException {
        final IOException error = assertThrows(IOException.class,
                () -> ReplayParser.parse(zip(Map.of("meta.json", "{}".getBytes(StandardCharsets.UTF_8)))));

        assertEquals("Replay is missing battle_results.dat", error.getMessage());
    }

    @Test
    void wrapsMalformedProtobufWithStableReplayError() throws IOException {
        final byte[] malformedProtobuf = {0x0A, 0x04, 0x01};
        final byte[] pickle = {
                'K', 42,
                'C', (byte) malformedProtobuf.length,
                malformedProtobuf[0], malformedProtobuf[1], malformedProtobuf[2],
                (byte) 0x86,
                '.'
        };

        final IOException error = assertThrows(IOException.class,
                () -> ReplayParser.parse(zip(Map.of("battle_results.dat", pickle))));

        assertTrue(error.getMessage().startsWith("Invalid replay data: Invalid protobuf at offset"));
    }

    @Test
    void rejectsRosterBeyondPlayerLimit() throws IOException {
        final byte[] protobuf = repeatedLengthDelimitedField(201, ReplayParser.MAX_PLAYERS_PER_REPLAY + 1);

        final IOException error = assertThrows(IOException.class,
                () -> ReplayParser.parse(zip(Map.of("battle_results.dat", pickle(protobuf)))));

        assertEquals("Replay roster exceeds player limit", error.getMessage());
    }

    @Test
    void rejectsResultsBeyondPlayerLimit() throws IOException {
        final byte[] protobuf = repeatedLengthDelimitedField(301, ReplayParser.MAX_PLAYERS_PER_REPLAY + 1);

        final IOException error = assertThrows(IOException.class,
                () -> ReplayParser.parse(zip(Map.of("battle_results.dat", pickle(protobuf)))));

        assertEquals("Replay results exceed player limit", error.getMessage());
    }

    private static Long invokeParseLong(final Method parseLong, final String value)
            throws InvocationTargetException, IllegalAccessException {
        return (Long) parseLong.invoke(null, value);
    }

    private static byte[] zip(final Map<String, byte[]> entries) throws IOException {
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            for (final Map.Entry<String, byte[]> entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue());
                zip.closeEntry();
            }
        }
        return output.toByteArray();
    }

    private static byte[] zipRepeated(final EntrySpec... entries) throws IOException {
        final byte[] block = new byte[8192];
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            for (final EntrySpec entry : entries) {
                zip.putNextEntry(new ZipEntry(entry.name()));
                int written = 0;
                while (written < entry.size()) {
                    final int chunkSize = Math.min(block.length, entry.size() - written);
                    zip.write(block, 0, chunkSize);
                    written += chunkSize;
                }
                zip.closeEntry();
            }
        }
        return output.toByteArray();
    }

    private static byte[] repeatedLengthDelimitedField(final int fieldNumber, final int count) {
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        final int tag = fieldNumber << 3 | 2;
        for (int index = 0; index < count; index++) {
            writeVarint(output, tag);
            output.write(0);
        }
        return output.toByteArray();
    }

    private static byte[] pickle(final byte[] protobuf) {
        if (protobuf.length > 255) {
            throw new IllegalArgumentException("Test protobuf exceeds SHORT_BINBYTES limit");
        }
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write('K');
        output.write(42);
        output.write('C');
        output.write(protobuf.length);
        output.writeBytes(protobuf);
        output.write(0x86);
        output.write('.');
        return output.toByteArray();
    }

    private static void writeVarint(final ByteArrayOutputStream output, final int value) {
        int remaining = value;
        while ((remaining & ~0x7F) != 0) {
            output.write(remaining & 0x7F | 0x80);
            remaining >>>= 7;
        }
        output.write(remaining);
    }

    private static void writeField(final ByteArrayOutputStream output,
                                   final int field, final int value) {
        writeVarint(output, field << 3);
        writeVarint(output, value);
    }

    private static void writeBytesField(final ByteArrayOutputStream output,
                                        final int field, final byte[] value) {
        writeVarint(output, (field << 3) | 2);
        writeVarint(output, value.length);
        output.writeBytes(value);
    }

    private static void writeStringField(final ByteArrayOutputStream output,
                                         final int field, final String value) {
        writeBytesField(output, field, value.getBytes(StandardCharsets.UTF_8));
    }

    private static int replaceAllAscii(final byte[] data, final String target, final String replacement) {
        final byte[] targetBytes = target.getBytes(StandardCharsets.US_ASCII);
        final byte[] replacementBytes = replacement.getBytes(StandardCharsets.US_ASCII);
        assertEquals(targetBytes.length, replacementBytes.length);
        int replacements = 0;
        for (int offset = 0; offset <= data.length - targetBytes.length; offset++) {
            boolean match = true;
            for (int index = 0; index < targetBytes.length; index++) {
                if (data[offset + index] != targetBytes[index]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                System.arraycopy(replacementBytes, 0, data, offset, replacementBytes.length);
                replacements++;
                offset += targetBytes.length - 1;
            }
        }
        return replacements;
    }

    private record EntrySpec(String name, int size) {
    }
}
