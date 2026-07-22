package com.wotb.core.replay.reconstruction;

import java.util.Map;

/**
 * 解析覆盖率统计。
 * <p>
 * 需要区分：流完整度、语义解码率、状态字段覆盖率。
 * </p>
 *
 * @param streamComplete      是否完整扫描了所有包
 * @param totalPackets        总包数
 * @param decodedPackets      完全解码的包数
 * @param partiallyDecodedPackets 部分解码的包数
 * @param unknownPackets      未知类型的包数
 * @param failedPackets       解码失败的包数
 * @param decodedPacketRatio  解码比例（完全解码包 / 总包）
 * @param packetTypes         各 type 的覆盖率详情
 */
public record ReplayCoverage(
        boolean streamComplete,
        int totalPackets,
        int decodedPackets,
        int partiallyDecodedPackets,
        int unknownPackets,
        int failedPackets,
        double decodedPacketRatio,
        Map<Integer, PacketTypeCoverage> packetTypes
) {

    /**
     * 特定 packet type 的覆盖率详情。
     */
    public record PacketTypeCoverage(
            int type,
            int count,
            int decoded,
            int partiallyDecoded,
            int unknown,
            int failed,
            double ratio
    ) {
    }
}
