package com.wotb.core.replay.decoder;

import com.wotb.core.replay.stream.RawReplayPacket;

/**
 * 原始事件包的解码器接口。
 * <p>
 * 每个 decoder 负责将一种或多种类型的原始包解码为领域事件。
 * Decoder 不能直接修改全局 BattleState。
 * </p>
 */
public interface ReplayPacketDecoder {

    /**
     * 判断此 decoder 是否能处理给定的原始包。
     *
     * @param context 解码上下文（含游戏版本等）
     * @param packet  原始事件包
     * @return true 如果此 decoder 支持解码该包
     */
    boolean supports(ReplayDecodeContext context, RawReplayPacket packet);

    /**
     * 解码原始包为领域事件。
     * 一个原始包可以产生零个、一个或多个 ReplayEvent。
     *
     * @param context 解码上下文
     * @param packet  原始事件包
     * @return 解码结果
     */
    ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet);
}
