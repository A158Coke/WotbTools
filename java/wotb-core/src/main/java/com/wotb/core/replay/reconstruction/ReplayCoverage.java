package com.wotb.core.replay.reconstruction;

import java.util.Map;

/**
 * 解析覆盖率统计。
 * <p>
 * 需要区分：流完整度、语义解码率、状态字段覆盖率。strict reader 在 framing 损坏时直接抛异常，
 * 因此成功返回即代表流已完整消费到物理末尾，{@code streamComplete} 恒为 true —— 作为无信息量字段删除。
 * </p>
 *
 * @param totalPackets        总包数
 * @param decodedPackets      完全解码的包数
 * @param partiallyDecodedPackets 部分解码的包数
 * @param unknownPackets      未知类型的包数
 * @param failedPackets       解码失败的包数
 * @param decodedPacketRatio  解码比例（完全解码包 / 总包）
 * @param packetTypes         各 type 的覆盖率详情
 */
public record ReplayCoverage(
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
