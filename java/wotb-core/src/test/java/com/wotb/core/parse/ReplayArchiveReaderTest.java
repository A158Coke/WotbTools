package com.wotb.core.parse;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ReplayArchiveReaderTest {

    private static byte[] zip(final Map<String, byte[]> entries) throws IOException {
        final ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(bos)) {
            for (final Map.Entry<String, byte[]> e : entries.entrySet()) {
                zos.putNextEntry(new ZipEntry(e.getKey()));
                zos.write(e.getValue());
                zos.closeEntry();
            }
        }
        return bos.toByteArray();
    }

    @Test
    void readsWhitelistedEntriesInOrder() throws Exception {
        final Map<String, byte[]> out = ReplayArchiveReader.read(zip(Map.of(
                "meta.json", new byte[]{1, 1},
                "battle_results.dat", new byte[]{2, 2},
                "data.wotreplay", new byte[]{3, 3})));
        assertEquals(3, out.size());
        assertEquals(2, out.get("meta.json").length);
        assertEquals(2, out.get("battle_results.dat").length);
        assertEquals(2, out.get("data.wotreplay").length);
    }

    @Test
    void rejectsUnexpectedEntry() {
        assertThrows(IOException.class, () -> ReplayArchiveReader.read(zip(Map.of(
                "meta.json", new byte[]{1},
                "evil.txt", new byte[]{2}))));
    }

    @Test
    void rejectsOversizedMetaEntry() {
        final byte[] big = new byte[ReplayArchiveReader.MAX_META_JSON_BYTES + 1];
        assertThrows(IOException.class, () -> ReplayArchiveReader.read(zip(Map.of(
                "meta.json", big))));
    }
}
