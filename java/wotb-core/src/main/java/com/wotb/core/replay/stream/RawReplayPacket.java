package com.wotb.core.replay.stream;

/**
 * data.wotreplay 中的一个原始事件包。
 * <p>
 * 使用共享源字节数组 + offset/length 方式避免对每个包复制完整 payload。
 * 解码时需要读取只读 slice。
 * </p>
 *
 * @param sequence      包在原始数据流中的稳定顺序，从 0 开始递增
 * @param sourceOffset  包头在 data.wotreplay 中的字节偏移
 * @param payloadLength 原始 payload 长度
 * @param type          原始 packet type
 * @param rawClockSec   文件中原始时钟（浮点数，不修改）
 * @param readStatus    读取状态：正常或重同步恢复
 * @param source        共享的 data.wotreplay 字节数组（只读引用）
 * @param payloadOffset source 中 payload 的起始偏移
 */
public record RawReplayPacket(
        int sequence,
        int sourceOffset,
        int payloadLength,
        int type,
        float rawClockSec,
        PacketReadStatus readStatus,
        byte[] source,
        int payloadOffset
) {

    /**
     * 返回此包 payload 的一个只读视图（与 source 共享底层数组）。
     * 调用方不应修改返回的数组内容。
     */
    public byte[] payload() {
        if (payloadLength == 0) {
            return new byte[0];
        }
        // 返回一个安全副本，避免调用方意外修改共享的 source
        final byte[] copy = new byte[payloadLength];
        System.arraycopy(source, payloadOffset, copy, 0, payloadLength);
        return copy;
    }

    /**
     * 返回 payload 长度。
     */
    public int payloadLength() {
        return payloadLength;
    }
}
