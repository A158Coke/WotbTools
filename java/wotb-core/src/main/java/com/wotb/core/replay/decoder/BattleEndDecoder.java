package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayStreamClosedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

/**
 * Type 14 解码器。
 *
 * <p><b>PR147（P1）</b>：Type14 = <b>packet-stream end / stop marker</b> —— 只得表示
 * {@code data.wotreplay} stream closed。绝不得根据 payload 推断 winner / finishReason / battle start，
 * 也不得作为 battle-start clock 锚点。战斗结束 / 胜方 / finishReason 的权威来源是
 * {@code RoundFinishedEvent}（Avatar method4 / wrapper3 AFTERBATTLE）与 settlement root3/4。</p>
 *
 * <p>payload 未证明 → raw-preserve（{@code UNKNOWN} + 诊断），不产出具象的 {@code BattleEndedEvent}。</p>
 */
public class BattleEndDecoder implements ReplayPacketDecoder {

    static final int TYPE_BATTLE_END = 14;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_BATTLE_END;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        // P1: Type14 payload unproven; stream-close containment only (never winner/finish/battle-start).
        final ReplayStreamClosedEvent event = new ReplayStreamClosedEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.UNKNOWN);
        return ReplayDecodeResult.of(event);
    }
}
