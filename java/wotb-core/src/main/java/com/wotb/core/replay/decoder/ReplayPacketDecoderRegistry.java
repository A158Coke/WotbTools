package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

/**
 * Decoder 注册中心。
 * <p>
 * 根据游戏版本、packet type、必要时的 subtype、payload 长度或结构特征选择合适的 decoder。
 * 所有 decoder 的遍历和选择在此类中管理。
 * </p>
 */
public class ReplayPacketDecoderRegistry {

    private final List<ReplayPacketDecoder> decoders = new ArrayList<>();

    /**
     * 创建一个默认配置的注册中心，包含所有标准 decoder。
     */
    public static ReplayPacketDecoderRegistry createDefault() {
        final ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
        // 注册所有标准 decoder
        registry.register(new PositionDecoder());
        registry.register(new EntityMethodDecoder());
        registry.register(new EntityLeaveDecoder());
        registry.register(new BattleEndDecoder());
        registry.register(new EntityCreateDecoder());
        // EntityProperty（Type 7）— 第一阶段做占位
        registry.register(new EntityPropertyDecoder());
        // Type 5/31/35/39 占位
        registry.register(new PlaceholderDecoder(5));
        registry.register(new PlaceholderDecoder(31));
        registry.register(new PlaceholderDecoder(35));
        registry.register(new PlaceholderDecoder(39));
        return registry;
    }

    /**
     * 注册一个 decoder。
     */
    public void register(ReplayPacketDecoder decoder) {
        decoders.add(decoder);
    }

    /**
     * 对给定的原始包进行解码。
     * 遍历所有已注册的 decoder，使用第一个匹配的进行解码。
     * 如果没有匹配的 decoder，返回 UNKNOWN 结果。
     *
     * @param context 解码上下文
     * @param packet  原始事件包
     * @return 解码结果
     */
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        for (final ReplayPacketDecoder decoder : decoders) {
            if (decoder.supports(context, packet)) {
                return decoder.decode(context, packet);
            }
        }
        // 无匹配 decoder：返回未知事件
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        final UnknownReplayEvent unknown = new UnknownReplayEvent(
                packet.sequence(), ts, packet.type(),
                packet.payloadLength(), "UNSUPPORTED_TYPE", DecodeConfidence.UNKNOWN);
        return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                List.of(unknown), List.of());
    }

    /**
     * 获取所有已注册的 decoder 列表。
     */
    public List<ReplayPacketDecoder> getDecoders() {
        return List.copyOf(decoders);
    }
}
