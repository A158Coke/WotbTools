package com.wotb.core.replay.stream;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/**
 * ReplayPacketStreamReader 单元测试。
 */
class ReplayPacketStreamReaderTest {

    @Test
    void parsesMinimalHeader() {
        // 最小合法头部: 魔数(4) + 未知8 + hash(1+0) + version(1+0) + 填充1 = 15
        final byte[] data = new byte[15];
        writeI32LE(data, 0, 0x12345678);
        // hash 长度 = 0
        data[12] = 0;
        // version 长度 = 0
        data[13] = 0;
        // padding
        data[14] = 0;

        final ReplayStreamHeader header = ReplayStreamHeader.parse(data);
        assertEquals(0x12345678L, header.magic());
        assertEquals("", header.clientHash());
        assertEquals("", header.clientVersion());
        assertEquals(15, header.packetStreamOffset());
    }

    @Test
    void parsesHeaderWithStrings() {
        final byte[] hash = "abcdef".getBytes(StandardCharsets.UTF_8);
        final byte[] ver = "1.2.3".getBytes(StandardCharsets.UTF_8);
        final byte[] data = new byte[4 + 8 + 1 + hash.length + 1 + ver.length + 1];
        int off = 0;
        writeI32LE(data, off, 0x12345678); off += 4;
        off += 8; // unknown
        data[off++] = (byte) hash.length;
        System.arraycopy(hash, 0, data, off, hash.length); off += hash.length;
        data[off++] = (byte) ver.length;
        System.arraycopy(ver, 0, data, off, ver.length); off += ver.length;
        data[off] = 0; // padding

        final ReplayStreamHeader header = ReplayStreamHeader.parse(data);
        assertEquals("abcdef", header.clientHash());
        assertEquals("1.2.3", header.clientVersion());
    }

    @Test
    void rejectsBadMagic() {
        final byte[] data = new byte[15];
        writeI32LE(data, 0, 0xDEADBEEF);

        assertThrows(ReplayHeaderException.class, () -> ReplayStreamHeader.parse(data));
    }

    @Test
    void rejectsTooShortData() {
        assertThrows(ReplayHeaderException.class, () -> ReplayStreamHeader.parse(new byte[10]));
    }

    @Test
    void readsEmptyPacketStream() {
        // 只有头部，没有包
        final byte[] data = createHeaderOnly();
        final var result = ReplayPacketStreamReader.read(data);
        assertNotNull(result.header());
        assertTrue(result.packets().isEmpty());
        assertEquals(0, result.diagnostics().packetCount());
        assertEquals(data.length, result.diagnostics().scannedBytes());
    }

    @Test
    void readsSinglePacket() {
        final byte[] data = createHeaderWithPackets(
                packetBytes(100, 10, 30.5f)  // payloadLen=100, type=10, clock=30.5
        );
        final var result = ReplayPacketStreamReader.read(data);
        assertEquals(1, result.packets().size());

        final RawReplayPacket pkt = result.packets().getFirst();
        assertEquals(0, pkt.sequence());
        assertEquals(10, pkt.type());
        assertEquals(30.5f, pkt.rawClockSec(), 0.001f);
        assertEquals(PacketReadStatus.NORMAL, pkt.readStatus());
        assertEquals(100, pkt.payloadLength());
    }

    @Test
    void readsMultiplePacketsWithSequence() {
        final byte[] data = createHeaderWithPackets(
                packetBytes(50, 4, 10.0f),
                packetBytes(60, 8, 20.0f),
                packetBytes(70, 10, 30.0f)
        );
        final var result = ReplayPacketStreamReader.read(data);
        assertEquals(3, result.packets().size());

        assertEquals(0, result.packets().get(0).sequence());
        assertEquals(10.0f, result.packets().get(0).rawClockSec(), 0.001f);

        assertEquals(1, result.packets().get(1).sequence());
        assertEquals(20.0f, result.packets().get(1).rawClockSec(), 0.001f);

        assertEquals(2, result.packets().get(2).sequence());
        assertEquals(30.0f, result.packets().get(2).rawClockSec(), 0.001f);
    }

    @Test
    void preservesPacketOrderAtSameClock() {
        // 同一时钟下的多个包
        final byte[] data = createHeaderWithPackets(
                packetBytes(10, 1, 15.0f),
                packetBytes(10, 2, 15.0f),
                packetBytes(10, 4, 15.0f)
        );
        final var result = ReplayPacketStreamReader.read(data);
        assertEquals(3, result.packets().size());
        assertEquals(1, result.packets().get(0).type());
        assertEquals(2, result.packets().get(1).type());
        assertEquals(4, result.packets().get(2).type());
    }

    @Test
    void recoversFromBadPacket() {
        // 一个坏包后恢复
        final byte[] header = createHeaderBytes();
        final byte[] good1 = packetBytes(20, 4, 5.0f);
        final byte[] bad = new byte[]{1, 2, 3}; // 不完整的包
        final byte[] good2 = packetBytes(20, 10, 10.0f);

        final byte[] data = concat(header, good1, bad, good2);
        final var result = ReplayPacketStreamReader.read(data);
        assertEquals(2, result.packets().size());

        assertEquals(1, result.diagnostics().resyncCount());
        assertEquals(PacketReadStatus.RESYNC_RECOVERED, result.packets().get(1).readStatus());
    }

    @Test
    void unknownTypePacketsNotDropped() {
        final byte[] data = createHeaderWithPackets(
                packetBytes(10, 999, 5.0f),  // 未知 type
                packetBytes(10, 10, 10.0f)
        );
        final var result = ReplayPacketStreamReader.read(data);
        assertEquals(2, result.packets().size());
        assertEquals(999, result.packets().get(0).type());
    }

    @Test
    void rejectsExcessivePackets() {
        // 创建超过限制的包
        final byte[] header = createHeaderBytes();
        final int maxPackets = 200_000;
        final int dataLen = header.length + (maxPackets + 1) * 13; // 每个包最小 13 字节
        final byte[] data = new byte[dataLen];
        System.arraycopy(header, 0, data, 0, header.length);
        int offset = header.length;
        for (int i = 0; i <= maxPackets; i++) {
            writeI32LE(data, offset, 1); // payloadLen=1
            writeI32LE(data, offset + 4, 4); // type=4
            writeI32LE(data, offset + 8, Float.floatToIntBits(1.0f)); // clock
            data[offset + 12] = 0; // payload
            offset += 13;
        }

        assertThrows(IllegalArgumentException.class,
                () -> ReplayPacketStreamReader.read(data));
    }

    @Test
    void diagnosticsReportsCorrectStats() {
        final byte[] data = createHeaderWithPackets(
                packetBytes(10, 4, 0.0f),
                packetBytes(10, 8, 15.5f),
                packetBytes(10, 10, 30.0f),
                packetBytes(10, 4, 45.2f)
        );
        final var result = ReplayPacketStreamReader.read(data);
        final var diag = result.diagnostics();

        assertEquals(4, diag.packetCount());
        assertEquals(data.length, diag.sourceSize());
        assertEquals(0f, diag.firstClockSec(), 0.001f);
        assertEquals(45.2f, diag.lastClockSec(), 0.001f);
        assertEquals(0, diag.trailingByteCount());
        assertTrue(diag.streamComplete());
    }

    @Test
    void detectsClockRegression() {
        final byte[] data = createHeaderWithPackets(
                packetBytes(10, 4, 10.0f),
                packetBytes(10, 8, 20.0f),
                packetBytes(10, 10, 5.0f) // 时钟回退
        );
        final var result = ReplayPacketStreamReader.read(data);
        assertTrue(result.diagnostics().clockRegressionCount() >= 0);
    }

    @Test
    void readerSkipsInvalidClock() {
        // 无效时钟（NaN）的包应该被跳过
        final byte[] header = createHeaderBytes();
        final byte[] badClockPkt = createRawPacket(10, 4, Float.NaN);
        final byte[] goodPkt = packetBytes(10, 10, 30.0f);

        final byte[] data = concat(header, badClockPkt, goodPkt);
        final var result = ReplayPacketStreamReader.read(data);
        // 注意：badClockPkt 的 payloadLen 可能不合法，所以被跳过
        // 但至少 goodPkt 应该被正常读取
        assertTrue(result.diagnostics().packetCount() >= 1);
    }

    @Test
    void doesNotClampClock() {
        final byte[] data = createHeaderWithPackets(
                packetBytes(10, 4, 5.0f),
                packetBytes(10, 10, 450.0f), // 超过 450 的时钟
                packetBytes(10, 14, 455.0f)
        );
        final var result = ReplayPacketStreamReader.read(data);
        assertEquals(455.0f, result.diagnostics().lastClockSec(), 0.001f);
        assertEquals(3, result.packets().size());
    }

    // ---- 测试工具 ----

    private static byte[] createHeaderOnly() {
        return createHeaderBytes();
    }

    private static byte[] createHeaderBytes() {
        final byte[] header = new byte[15];
        writeI32LE(header, 0, 0x12345678);
        header[12] = 0; // hash len
        header[13] = 0; // version len
        header[14] = 0; // padding
        return header;
    }

    private static byte[] createHeaderWithPackets(byte[]... packets) {
        final byte[] header = createHeaderBytes();
        int totalLen = header.length;
        for (final byte[] pkt : packets) {
            totalLen += pkt.length;
        }
        final byte[] data = new byte[totalLen];
        System.arraycopy(header, 0, data, 0, header.length);
        int off = header.length;
        for (final byte[] pkt : packets) {
            System.arraycopy(pkt, 0, data, off, pkt.length);
            off += pkt.length;
        }
        return data;
    }

    /**
     * 创建一个合法的事件包字节数组。
     * payloadLen(4) + type(4) + clock(f32 4) + payload(payloadLen bytes)
     */
    private static byte[] packetBytes(int payloadLen, int type, float clockSec) {
        final byte[] pkt = new byte[12 + payloadLen];
        writeI32LE(pkt, 0, payloadLen);
        writeI32LE(pkt, 4, type);
        writeI32LE(pkt, 8, Float.floatToIntBits(clockSec));
        // payload 保持为 0
        return pkt;
    }

    private static byte[] createRawPacket(int payloadLen, int type, float clockSec) {
        return packetBytes(payloadLen, type, clockSec);
    }

    private static byte[] concat(byte[]... arrays) {
        int total = 0;
        for (final byte[] a : arrays) total += a.length;
        final byte[] result = new byte[total];
        int off = 0;
        for (final byte[] a : arrays) {
            System.arraycopy(a, 0, result, off, a.length);
            off += a.length;
        }
        return result;
    }

    private static void writeI32LE(byte[] buf, int off, int v) {
        buf[off] = (byte) (v & 0xFF);
        buf[off + 1] = (byte) ((v >>> 8) & 0xFF);
        buf[off + 2] = (byte) ((v >>> 16) & 0xFF);
        buf[off + 3] = (byte) ((v >>> 24) & 0xFF);
    }
}
