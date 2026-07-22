package com.wotb.core.replay.stream;

import java.util.Map;

/**
 * 回放数据流扫描的诊断信息。
 * <p>
 * 即使语义解码率不是 100%，只要完整扫描所有包，streamComplete 仍然可以为 true。
 * </p>
 *
 * @param sourceSize         data.wotreplay 原始大小（字节）
 * @param scannedBytes       实际扫描的字节数
 * @param packetCount        总包数
 * @param normalPacketCount  正常读取的包数
 * @param recoveredPacketCount 重同步恢复的包数
 * @param resyncCount        重同步次数
 * @param skippedByteCount  因错误跳过的字节数
 * @param trailingByteCount  尾部无法解析的剩余字节数
 * @param firstClockSec      首包时钟
 * @param lastClockSec       尾包时钟
 * @param clockRegressionCount 时钟回退次数（后包时钟 < 前包时钟）
 * @param packetTypes        各 packet type 的详细诊断
 * @param battleStartIdentified 是否已识别出战斗开始时刻
 * @param battleStartRawClockSec 识别的战斗开始原始时钟（如果有）
 */
public record ReplayStreamDiagnostics(
        int sourceSize,
        int scannedBytes,
        int packetCount,
        int normalPacketCount,
        int recoveredPacketCount,
        int resyncCount,
        int skippedByteCount,
        int trailingByteCount,
        float firstClockSec,
        float lastClockSec,
        int clockRegressionCount,
        Map<Integer, PacketTypeDiagnostics> packetTypes,
        boolean battleStartIdentified,
        Float battleStartRawClockSec
) {

    /**
     * 是否已完整扫描至数据末尾（包括尾部残留字节）。
     * 不等于所有包都已解码，只表示扫描过程没有提前中断。
     */
    public boolean streamComplete() {
        return scannedBytes + trailingByteCount >= sourceSize;
    }
}
