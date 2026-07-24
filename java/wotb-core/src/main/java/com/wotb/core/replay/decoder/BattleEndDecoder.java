package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 14 (Battle End) 解码器。
 * <p>
 * 识别战斗结束状态，输出 BattleEndedEvent。
 * 不要只依赖 meta.json#battleDuration。
 * </p>
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
        // Type 14 payload 格式待进一步研究
        // 目前先确认 packet type 并记录事件

        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        // 尝试从 payload 提取胜方信息（格式待确认）
        Integer winnerTeam = null;
        if (payload.length >= 4) {
            final int possibleWinner = readI32LE(payload, 0);
            // 合理的 team 值通常为 1 或 2
            if (possibleWinner == 1 || possibleWinner == 2) {
                winnerTeam = possibleWinner;
            }
        }

        final BattleEndedEvent event = new BattleEndedEvent(
                packet.sequence(), ts, packet.type(),
                winnerTeam != null ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL,
                winnerTeam);

        return ReplayDecodeResult.of(event);
    }

    private static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }
}
