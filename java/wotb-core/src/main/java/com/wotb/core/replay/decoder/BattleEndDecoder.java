package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 14 (Battle End) 解码器。
 *
 * <p><b>PR147 边界（P1）</b>：Type14 payload 语义<em>未证明</em> —— 绝不得根据
 * {@code payload[0..4) == 1/2} 推断出 {@code winnerTeam=EXACT}。在没有独立的
 * PR147/controlled evidence 之前，{@link BattleEndedEvent} 的 {@code winnerTeam} 恒为
 * {@code null}（confidence=PARTIAL：战斗结束 containment 已识别，胜方未证明）。</p>
 *
 * <p>battle-start clock 估计只消费该事件的 <b>raw framing 时间</b>（包序列时钟，raw fact）
 * 与结算 <b>durationS</b>（proven settlement surface），不消费未证明的 payload 语义；因此
 * Type14 不会影响 battle-state winner（恒 null）、也不会用 payload 内容正向改变时钟。
 * 胜方 / 战斗结束的权威来源是结算层（{@code battle_results}.{@code winnerTeam} / {@code durationS}）。</p>
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
        // P1: payload semantics unproven -> winnerTeam is ALWAYS null, never derived from payload[0..4).
        // DecodeConfidence.PARTIAL = battle-end containment recognized, winner unknown (not EXACT).
        final BattleEndedEvent event = new BattleEndedEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.PARTIAL, null);
        return ReplayDecodeResult.of(event);
    }
}
