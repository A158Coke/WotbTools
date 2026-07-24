package com.wotb.core.replay.event;

/**
 * 未知或无法解码的事件。
 * <p>
 * 任何未识别或无法完整解码的包都要产生此事件记录。
 * 不要在正常响应中直接暴露全部原始 payload。
 * </p>
 *
 * @param sequence      事件顺序号
 * @param timestamp     时间戳
 * @param packetType    原始 packet type
 * @param payloadLength 原始 payload 长度（不含头部）
 * @param reasonCode    未知原因码
 * @param confidence    解码置信度（通常为 UNKNOWN 或 PARTIAL）
 */
public record UnknownReplayEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        int payloadLength,
        String reasonCode,
        DecodeConfidence confidence
) implements ReplayEvent {
}
