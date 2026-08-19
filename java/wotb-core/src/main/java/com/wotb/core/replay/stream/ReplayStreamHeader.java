package com.wotb.core.replay.stream;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Objects;

/**
 * data.wotreplay 的文件头。
 * <p>
 * 格式：魔数(4B) + 未知(8B) + hash(1B长度+内容) + version(1B长度+内容) + 1B填充。
 * </p>
 *
 * @param magic              魔数，应为 0x12345678
 * @param unknownHeaderBytes 魔数后的 8 字节未知头部
 * @param clientHash         客户端 hash 字符串
 * @param clientVersion      客户端版本字符串
 * @param packetStreamOffset packet stream 起始偏移（头部总长度）
 */
public record ReplayStreamHeader(
        long magic,
        byte[] unknownHeaderBytes,
        String clientHash,
        String clientVersion,
        int packetStreamOffset
) {

    /** 标准魔数 */
    public static final long EXPECTED_MAGIC = 0x12345678L;

    /**
     * 从 data.wotreplay 字节数组中解析头部。
     *
     * @param data 完整的 data.wotreplay 字节数组
     * @return 解析后的头部
     * @throws ReplayHeaderException 如果头部非法
     */
    public static ReplayStreamHeader parse(byte[] data) {
        Objects.requireNonNull(data, "data must not be null");
        if (data.length < 15) {
            throw new ReplayHeaderException("Data too short for header: " + data.length + " bytes");
        }

        int offset = 0;

        // 魔数 (4 bytes, little-endian)
        final long magic = readU32LE(data, offset) & 0xFFFFFFFFL;
        offset += 4;
        if (magic != EXPECTED_MAGIC) {
            throw new ReplayHeaderException(
                    "Bad magic: expected 0x" + Long.toHexString(EXPECTED_MAGIC)
                            + " but got 0x" + Long.toHexString(magic));
        }

        // 未知 8 字节
        if (data.length < offset + 8) {
            throw new ReplayHeaderException("Data too short for unknown header bytes");
        }
        final byte[] unknownHeaderBytes = Arrays.copyOfRange(data, offset, offset + 8);
        offset += 8;

        // 客户端 hash (1 字节长度 + 内容)
        if (offset >= data.length) {
            throw new ReplayHeaderException("Data too short for client hash length");
        }
        final int hashLen = data[offset] & 0xFF;
        offset += 1;
        if (hashLen < 0 || offset + hashLen > data.length) {
            throw new ReplayHeaderException(
                    "Invalid client hash length: " + hashLen + " at offset " + (offset - 1));
        }
        final String clientHash = new String(data, offset, hashLen, StandardCharsets.UTF_8);
        offset += hashLen;

        // 客户端版本 (1 字节长度 + 内容)
        if (offset >= data.length) {
            throw new ReplayHeaderException("Data too short for client version length");
        }
        final int versionLen = data[offset] & 0xFF;
        offset += 1;
        if (versionLen < 0 || offset + versionLen > data.length) {
            throw new ReplayHeaderException(
                    "Invalid client version length: " + versionLen + " at offset " + (offset - 1));
        }
        final String clientVersion = new String(data, offset, versionLen, StandardCharsets.UTF_8);
        offset += versionLen;

        // 1 字节填充
        if (offset >= data.length) {
            throw new ReplayHeaderException("Data too short for header padding byte");
        }
        offset += 1;

        return new ReplayStreamHeader(magic, unknownHeaderBytes, clientHash, clientVersion, offset);
    }

    /**
     * 获取 packet stream 数据部分的起始偏移。
     */
    @Override
    public int packetStreamOffset() {
        return packetStreamOffset;
    }

    private static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ReplayStreamHeader that)) return false;
        return magic == that.magic
                && packetStreamOffset == that.packetStreamOffset
                && Arrays.equals(unknownHeaderBytes, that.unknownHeaderBytes)
                && clientHash.equals(that.clientHash)
                && clientVersion.equals(that.clientVersion);
    }

    @Override
    public int hashCode() {
        int result = Long.hashCode(magic);
        result = 31 * result + Arrays.hashCode(unknownHeaderBytes);
        result = 31 * result + clientHash.hashCode();
        result = 31 * result + clientVersion.hashCode();
        result = 31 * result + packetStreamOffset;
        return result;
    }

    @Override
    public String toString() {
        return "ReplayStreamHeader{"
                + "magic=0x" + Long.toHexString(magic)
                + ", clientHash='" + clientHash + '\''
                + ", clientVersion='" + clientVersion + '\''
                + ", packetStreamOffset=" + packetStreamOffset
                + '}';
    }
}
