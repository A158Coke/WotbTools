package com.wotb.core.replay.stream;

/**
 * 特定 packet type 在流中的统计诊断信息。
 *
 * @param type               packet type
 * @param packetCount        该类型的总包数
 * @param decodedCount       成功解码（EXACT）的包数
 * @param partiallyDecodedCount 部分解码（PARTIAL）的包数
 * @param unknownCount       未知类型包数
 * @param decodeFailureCount 解码失败的包数
 * @param firstClockSec      该类型首包时钟
 * @param maxObservedRawClockSec 该类型观测到的最大 raw clock（非严格末包时钟）
 */
public record PacketTypeDiagnostics(
        int type,
        int packetCount,
        int decodedCount,
        int partiallyDecodedCount,
        int unknownCount,
        int decodeFailureCount,
        float firstClockSec,
        float maxObservedRawClockSec
) {
}
