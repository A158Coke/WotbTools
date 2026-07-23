package com.wotb.core.replay.stream;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 从 data.wotreplay 字节数组中完整扫描事件包数据流。
 * <p>
 * 职责：
 * <ul>
 *   <li>解析文件头（{@link ReplayStreamHeader}）</li>
 *   <li>从头到尾扫描所有合法事件包</li>
 *   <li>错误容忍：坏包时跳过 1 字节尝试重同步</li>
 *   <li>记录完整诊断信息（{@link ReplayStreamDiagnostics}）</li>
 *   <li>保留原始包顺序和 sequence 编号</li>
 *   <li>不因 {@code battleDuration} 提前停止</li>
 *   <li>不修改 {@code rawClockSec}</li>
 * </ul>
 * </p>
 *
 * <p>此读取器只负责扫描和记录原始包，不负责解码语义。
 * 解码由 {@code com.wotb.core.replay.decoder} 包中的 decoder 完成。</p>
 */
public final class ReplayPacketStreamReader {

    private static final int MAX_PAYLOAD_LEN = 200_000;
    private static final float MAX_SANE_CLOCK = 5000f;
    private static final int MAX_PACKETS = 200_000;
    private static final int MAX_SCAN_STEPS = 1_000_000;
    private static final int MAX_RESYNC_STEPS = 10_000;

    private final byte[] source;
    private final int sourceSize;

    private final List<RawReplayPacket> packets = new ArrayList<>();
    private final Map<Integer, PacketTypeStats> typeStats = new HashMap<>();

    private int scannedBytes;
    private int skippedByteCount;
    private int resyncCount;
    private int trailingByteCount;
    private float firstClockSec = Float.NaN;
    private float lastClockSec = Float.NaN;
    private float previousClockSec = Float.NaN;
    private int clockRegressionCount;
    private int normalPacketCount;
    private int recoveredPacketCount;

    private ReplayPacketStreamReader(byte[] data) {
        this.source = Objects.requireNonNull(data, "data must not be null");
        this.sourceSize = data.length;
    }

    /**
     * 读取整个 data.wotreplay 数据流。
     *
     * @param data data.wotreplay 的完整字节内容
     * @return 读取结果，包含头部、包列表和诊断信息
     * @throws ReplayHeaderException 如果头部非法
     * @throws IllegalArgumentException 如果超出安全限制
     */
    public static ReplayStreamResult read(byte[] data) {
        final ReplayPacketStreamReader reader = new ReplayPacketStreamReader(data);
        return reader.scan();
    }

    /**
     * 扫描整个数据流。
     */
    private ReplayStreamResult scan() {
        // 1. 解析头部
        final ReplayStreamHeader header = ReplayStreamHeader.parse(source);
        int offset = header.packetStreamOffset();
        scannedBytes = offset;

        // 2. 遍历事件包
        boolean inResync = false;
        int resyncStepCount = 0;

        while (offset + 12 <= sourceSize) {
            if (packets.size() >= MAX_PACKETS) {
                throw new IllegalArgumentException("REPLAY_PACKET_LIMIT_EXCEEDED");
            }
            if (inResync) {
                resyncStepCount++;
                if (resyncStepCount > MAX_RESYNC_STEPS) {
                    throw new IllegalArgumentException("REPLAY_MAX_RESYNC_EXCEEDED");
                }
            }

            final int payloadLen = readU32LE(source, offset);

            // 非法长度 —— 跳过 1 字节
            if (payloadLen <= 0 || payloadLen > MAX_PAYLOAD_LEN) {
                offset = advanceWithResync(offset, inResync);
                inResync = true;
                continue;
            }

            // payload 超出文件范围 —— 跳过 1 字节
            if (offset + 12 + payloadLen > sourceSize) {
                offset = advanceWithResync(offset, inResync);
                inResync = true;
                continue;
            }

            final int type = readU32LE(source, offset + 4);
            final float clockSecs = Float.intBitsToFloat(readU32LE(source, offset + 8));

            // 时钟无效 —— 跳过 1 字节
            if (Float.isNaN(clockSecs) || clockSecs < 0 || clockSecs > MAX_SANE_CLOCK) {
                offset = advanceWithResync(offset, inResync);
                inResync = true;
                continue;
            }

            // 成功读取一个包
            final PacketReadStatus status = inResync ? PacketReadStatus.RESYNC_RECOVERED : PacketReadStatus.NORMAL;
            final int sequence = packets.size();

            packets.add(new RawReplayPacket(
                    sequence,
                    offset,
                    payloadLen,
                    type,
                    clockSecs,
                    status,
                    source,
                    offset + 12
            ));

            // 更新统计
            if (status == PacketReadStatus.NORMAL) {
                normalPacketCount++;
            } else {
                recoveredPacketCount++;
            }

            typeStats.computeIfAbsent(type, k -> new PacketTypeStats()).increment(clockSecs);

            if (Float.isNaN(firstClockSec) || clockSecs < firstClockSec) {
                firstClockSec = clockSecs;
            }
            if (Float.isNaN(lastClockSec) || clockSecs >= lastClockSec) {
                if (!Float.isNaN(lastClockSec) && clockSecs < previousClockSec) {
                    clockRegressionCount++;
                }
                lastClockSec = clockSecs;
            } else if (clockSecs < previousClockSec) {
                clockRegressionCount++;
            }
            previousClockSec = clockSecs;

            offset += 12 + payloadLen;
            scannedBytes = offset;
            inResync = false;
            resyncStepCount = 0;
        }

        // 尾部剩余字节
        trailingByteCount = sourceSize - offset;
        scannedBytes = offset;
        // while 循环仅在 offset+12 > sourceSize（末尾不足一个包头）时正常退出；
        // 超出包数/重同步硬上限会在循环内抛异常，不会走到这里。
        final boolean reachedPhysicalEnd = offset + 12 > sourceSize;

        // 构建诊断
        final Map<Integer, PacketTypeDiagnostics> diagTypes = new HashMap<>();
        for (final Map.Entry<Integer, PacketTypeStats> entry : typeStats.entrySet()) {
            final PacketTypeStats s = entry.getValue();
            diagTypes.put(entry.getKey(), new PacketTypeDiagnostics(
                    entry.getKey(),
                    s.count,
                    0, // decodedCount – 由 decoder 阶段填充
                    0, // partiallyDecodedCount
                    s.count, // unknownCount – 初始视为未知
                    0, // decodeFailureCount
                    s.firstClockSec,
                    s.lastClockSec
            ));
        }

        final ReplayStreamDiagnostics diagnostics = new ReplayStreamDiagnostics(
                sourceSize,
                scannedBytes,
                packets.size(),
                normalPacketCount,
                recoveredPacketCount,
                resyncCount,
                skippedByteCount,
                trailingByteCount,
                Float.isNaN(firstClockSec) ? 0f : firstClockSec,
                Float.isNaN(lastClockSec) ? 0f : lastClockSec,
                clockRegressionCount,
                Collections.unmodifiableMap(diagTypes),
                false,  // battleStartIdentified
                null,   // battleStartRawClockSec
                reachedPhysicalEnd
        );

        return new ReplayStreamResult(header, Collections.unmodifiableList(packets), diagnostics);
    }

    /**
     * 执行重同步：跳过 1 字节。
     */
    private int advanceWithResync(int offset, boolean alreadyInResync) {
        if (!alreadyInResync) {
            resyncCount++;
        }
        skippedByteCount++;
        return offset + 1;
    }

    // ---- 结果封装 ----

    /**
     * 读取结果：包含头部、不可修改的包列表和诊断信息。
     */
    public record ReplayStreamResult(
            ReplayStreamHeader header,
            List<RawReplayPacket> packets,
            ReplayStreamDiagnostics diagnostics
    ) {
    }

    // ---- 内部统计 ----

    private static final class PacketTypeStats {
        int count;
        float firstClockSec = Float.NaN;
        float lastClockSec = Float.NaN;

        void increment(float clockSec) {
            count++;
            if (Float.isNaN(firstClockSec) || clockSec < firstClockSec) {
                firstClockSec = clockSec;
            }
            if (Float.isNaN(lastClockSec) || clockSec > lastClockSec) {
                lastClockSec = clockSec;
            }
        }
    }

    // ---- 二进制读取 ----

    private static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    /**
     * 工厂方法：从字节数组读取完整数据流。
     * 供外部调用，与内部 read() 等效。
     */
    public static ReplayStreamResult readStream(byte[] data) {
        return read(data);
    }
}
