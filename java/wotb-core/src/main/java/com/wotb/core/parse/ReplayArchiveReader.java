package com.wotb.core.parse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * .wotbreplay 归档（zip）读取：白名单条目 + 大小限制 + 条目数限制 + 去重。
 * <p>由 {@link ReplayParser} 与 {@link com.wotb.core.replay.reconstruction.ReplayReconstructionService}
 * 共用，消除两处重复的 unzip 实现；常量与历史行为逐字节一致。</p>
 */
public final class ReplayArchiveReader {

    private static final int MEBIBYTE = 1024 * 1024;

    public static final int MAX_ARCHIVE_BYTES = 20 * MEBIBYTE;
    public static final int MAX_META_JSON_BYTES = MEBIBYTE;
    public static final int MAX_BATTLE_RESULTS_BYTES = 8 * MEBIBYTE;
    public static final int MAX_DATA_WOTREPLAY_BYTES = 20 * MEBIBYTE;
    public static final int MAX_TOTAL_UNCOMPRESSED_BYTES = 24 * MEBIBYTE;

    private static final Map<String, Integer> ENTRY_SIZE_LIMITS = Map.of(
            "meta.json", MAX_META_JSON_BYTES,
            "battle_results.dat", MAX_BATTLE_RESULTS_BYTES,
            "data.wotreplay", MAX_DATA_WOTREPLAY_BYTES);

    private ReplayArchiveReader() {
    }

    /** 读取整个归档，返回 条目名 → 字节。校验失败抛 {@link IOException}。 */
    public static Map<String, byte[]> read(final byte[] data) throws IOException {
        if (data == null) {
            throw new IOException("Replay archive is null");
        }
        if (data.length > MAX_ARCHIVE_BYTES) {
            throw new IOException("Replay archive exceeds compressed size limit");
        }

        final Map<String, byte[]> out = new HashMap<>();
        final Set<String> seenEntryNames = new HashSet<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(data))) {
            ZipEntry entry;
            final byte[] tmp = new byte[8192];
            int entryCount = 0;
            int totalUncompressedBytes = 0;
            while ((entry = zis.getNextEntry()) != null) {
                entryCount++;
                if (entryCount > ENTRY_SIZE_LIMITS.size()) {
                    throw new IOException("Replay archive contains too many entries");
                }

                final String entryName = entry.getName();
                if (entry.isDirectory() || !ENTRY_SIZE_LIMITS.containsKey(entryName)) {
                    throw new IOException("Unexpected replay entry: " + entryName);
                }
                if (!seenEntryNames.add(entryName)) {
                    throw new IOException("Duplicate replay entry: " + entryName);
                }

                final int entryLimit = ENTRY_SIZE_LIMITS.get(entryName);
                final long declaredSize = entry.getSize();
                if (declaredSize < -1 || declaredSize > entryLimit) {
                    throw new IOException("Replay entry too large: " + entryName);
                }

                final ByteArrayOutputStream bos = new ByteArrayOutputStream();
                int read;
                int entryBytes = 0;
                while ((read = zis.read(tmp)) != -1) {
                    if (read == 0) {
                        continue;
                    }
                    if ((long) entryBytes + read > entryLimit) {
                        throw new IOException("Replay entry too large: " + entryName);
                    }
                    if ((long) totalUncompressedBytes + read > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                        throw new IOException("Replay uncompressed data exceeds total size limit");
                    }
                    bos.write(tmp, 0, read);
                    entryBytes += read;
                    totalUncompressedBytes += read;
                }
                out.put(entryName, bos.toByteArray());
                zis.closeEntry();
            }
        }
        return out;
    }
}
