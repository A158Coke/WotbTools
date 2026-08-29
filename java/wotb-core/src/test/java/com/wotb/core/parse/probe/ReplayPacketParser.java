package com.wotb.core.parse.probe;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * data.wotreplay 事件流包头/包解析器：魔数校验、strict contiguous framing 与二进制读取工具。
 * <p>从 {@link EventStreamReader} 拆出，纯静态工具类。</p>
 *
 * <p>PR147 framing 契约（docs/research/replay/packet-stream.md）：包从 header 后严格连续排列；
 * {@code payloadLen == 0} 合法（Type 17）；流以 {@code type == 0xFFFFFFFF} 的 terminator 记录
 * 结束；任何 framing corruption 直接 FAIL（抛 {@link IllegalArgumentException}），
 * 绝不逐 byte 寻找 plausible packet（恢复扫描仅用于 diagnostics/research）。</p>
 */
final class ReplayPacketParser {

    private ReplayPacketParser() {
    }

    private static final int MAGIC = 0x12345678;
    private static final int MAX_PAYLOAD_LEN = 200_000;
    private static final float MAX_SANE_CLOCK = 5000f;
    /** 当前版本流 terminator（PROVEN：payloadLen=16、rawClock=0；packet-stream.md）。 */
    static final int TERMINATOR_TYPE = 0xFFFFFFFF;
    static final int MAX_PACKETS = 200_000;

    /**
     * 解析整个 data.wotreplay（strict contiguous framing）。
     */
    public static EventStreamReader.EventStream read(byte[] data) {
        int i = 0;
        final int n = data.length;

        // 动态 header：magic + unknown[8] + hashLen/hash + versionLen/version + padding
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

        // packets：strict contiguous framing —— 下一个包必须恰好接在当前包末尾；
        // payloadLen == 0 合法；type == 0xFFFFFFFF 为 terminator，其后数据视为 corruption。
        final List<EventStreamReader.ParsedPacket> packets = new ArrayList<>();
        while (i + 12 <= n) {
            final int payloadLen = readU32LE(data, i);
            if (payloadLen < 0 || payloadLen > MAX_PAYLOAD_LEN) {
                throw new IllegalArgumentException(
                        "Invalid payloadLen " + Integer.toUnsignedString(payloadLen) + " at offset " + i);
            }
            if (i + 12 + payloadLen > n) {
                throw new IllegalArgumentException("Packet extends beyond stream end at offset " + i);
            }
            final int type = readU32LE(data, i + 4);
            final float clockSecs = Float.intBitsToFloat(readU32LE(data, i + 8));
            if (Float.isNaN(clockSecs) || clockSecs < 0 || clockSecs > MAX_SANE_CLOCK) {
                throw new IllegalArgumentException("Invalid packet clock at offset " + i);
            }
            final byte[] payload = new byte[payloadLen];
            System.arraycopy(data, i + 12, payload, 0, payloadLen);
            if (packets.size() >= MAX_PACKETS) {
                throw new IllegalArgumentException("Event stream packet limit exceeded");
            }
            packets.add(new EventStreamReader.ParsedPacket(type, clockSecs, payload));
            i += 12 + payloadLen;
            if (type == TERMINATOR_TYPE) {
                // terminator 之后不得再解析任何数据
                break;
            }
        }
        if (i < n) {
            throw new IllegalArgumentException(
                    "Trailing data after stream terminator at offset " + i);
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
