package com.wotb.core.parse;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * data.wotreplay 事件流包头/包解析器：魔数校验、事件包扫描（错误容忍）与二进制读取工具。
 * <p>从 {@link EventStreamReader} 拆出，纯静态工具类。</p>
 */
final class ReplayPacketParser {

    private ReplayPacketParser() {
    }

    private static final int MAGIC = 0x12345678;
    private static final int MAX_PAYLOAD_LEN = 200_000;
    private static final float MAX_SANE_CLOCK = 5000f;
    static final int MAX_PACKETS = 200_000;
    static final int MAX_SCAN_STEPS = 1_000_000;

    /**
     * 解析整个 data.wotreplay (错误容忍)。
     */
    public static EventStreamReader.EventStream read(byte[] data) {
        int i = 0;
        final int n = data.length;

        // header
        final int magic = readU32LE(data, i);
        i += 4;
        if (magic != MAGIC) {
            throw new IllegalArgumentException("Bad magic: " + Integer.toHexString(magic));
        }
        i += 8;
        final String clientHash = readLenPrefixedStr(data, i);
        i += 1 + clientHash.length();
        final String clientVersion = readLenPrefixedStr(data, i);
        i += 1 + clientVersion.length();
        i += 1;

        // packets (error-tolerant)
        final List<EventStreamReader.ParsedPacket> packets = new ArrayList<>();
        int scanSteps = 0;
        while (i + 12 <= n) {
            scanSteps++;
            if (scanSteps > MAX_SCAN_STEPS) {
                throw new IllegalArgumentException("Event stream scan budget exceeded");
            }
            final int payloadLen = readU32LE(data, i);
            if (payloadLen <= 0 || payloadLen > MAX_PAYLOAD_LEN) {
                i++;
                continue;
            }
            if (i + 8 + payloadLen > n) {
                i++;
                continue;
            }
            final int type = readU32LE(data, i + 4);
            final float clockSecs = Float.intBitsToFloat(readU32LE(data, i + 8));
            if (clockSecs < 0 || clockSecs > MAX_SANE_CLOCK) {
                i++;
                continue;
            }
            final byte[] payload = new byte[payloadLen];
            System.arraycopy(data, i + 12, payload, 0, payloadLen);
            if (packets.size() >= MAX_PACKETS) {
                throw new IllegalArgumentException("Event stream packet limit exceeded");
            }
            packets.add(new EventStreamReader.ParsedPacket(type, clockSecs, payload));
            i += 12 + payloadLen;
        }

        return new EventStreamReader.EventStream(clientVersion, clientHash, packets);
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    static int readU16LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }

    static String readLenPrefixedStr(byte[] buf, int i) {
        final int len = buf[i] & 0xFF;
        return new String(buf, i + 1, len, StandardCharsets.UTF_8);
    }

    static long[] readVarint(byte[] buf, int i) {
        int idx = i;
        int shift = 0;
        long result = 0;
        while (true) {
            final int b = buf[idx] & 0xFF;
            idx++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                break;
            }
            shift += 7;
        }
        return new long[]{result, idx};
    }

}
