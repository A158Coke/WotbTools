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
 * @param reachedPhysicalEnd 扫描是否推进到数据物理末尾（末尾仅剩不足一个包头的字节）。
 *                           由扫描器根据循环退出条件显式给出；超出包数/重同步硬上限时读取器
 *                           直接抛异常（不会返回半截诊断），因此正常返回即代表扫描未被硬上限中断。
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
        Float battleStartRawClockSec,
        boolean reachedPhysicalEnd
) {

    /**
     * 是否完整扫描至数据物理末尾。
     * <p>
     * 取自 {@link #reachedPhysicalEnd}（扫描到达末尾边界），而非早先"扫描字节+尾部字节≥总大小"
     * 的恒真算术式。不等于所有包都已语义解码——解码覆盖率见 {@code ReplayCoverage}。
     * </p>
     */
    public boolean streamComplete() {
        return reachedPhysicalEnd;
    }
}
