package com.wotb.core.replay.stream;

import java.util.Map;

/**
 * 回放数据流扫描的诊断信息。
 * <p>
 * PR147/PR162: strict contiguous framing 已是 production contract —— reader 在 framing 损坏时
 * 直接抛异常，因此成功返回即代表流已完整消费到物理末尾；{@code normalPacketCount==packetCount}、
 * {@code trailingByteCount==0}、{@code reachedPhysicalEnd==true}、{@code streamComplete()==true}、
 * {@code scannedBytes==sourceSize} 都是恒真/恒零的冗余常量，已删除（不再作为 production API）。
 * 同理 {@code recoveredPacketCount/resyncCount/skippedByteCount} 与单值 readStatus/PacketReadStatus
 * 也已删除。
 * </p>
 *
 * @param sourceSize            data.wotreplay 原始大小（字节）
 * @param packetCount           总包数
 * @param firstClockSec         首包时钟
 * @param maxObservedRawClockSec 流内观测到的最大 raw clock（reader 允许时钟回退并单独计数，
 *                              因此不是严格意义上的「末包时钟」）
 * @param clockRegressionCount  时钟回退次数（后包时钟 < 前包时钟）
 * @param packetTypes           各 packet type 的详细诊断
 */
public record ReplayStreamDiagnostics(
        int sourceSize,
        int packetCount,
        float firstClockSec,
        float maxObservedRawClockSec,
        int clockRegressionCount,
        Map<Integer, PacketTypeDiagnostics> packetTypes
) {
}
