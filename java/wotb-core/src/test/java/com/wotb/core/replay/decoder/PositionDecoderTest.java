package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Type 10 位置包解码：完整(49B)= EXACT；截断(<49B)= PARTIAL（尾部字段缺失不得当作真实值）。
 */
class PositionDecoderTest {

    private final PositionDecoder decoder = new PositionDecoder();
    private final ReplayDecodeContext ctx = new ReplayDecodeContext("11.18.0_china_apple");

    /** 构造一个 type=10 的包，payload 为全 0 的指定长度（坐标 0 为合法有限值）。 */
    private static RawReplayPacket positionPacket(int payloadLen) {
        final byte[] payload = new byte[payloadLen];
        return new RawReplayPacket(0, 0, payloadLen, 10, 1.0f,
                PacketReadStatus.NORMAL, payload, 0);
    }

    @Test
    void fullLengthIsExact() {
        final ReplayDecodeResult r = decoder.decode(ctx, positionPacket(49));
        assertEquals(DecodeStatus.SUCCESS, r.status());
        final PositionChangedEvent e = (PositionChangedEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
    }

    @Test
    void truncatedIsPartialNotExact() {
        // 45..48 字节：进入解码但缺失 roll/errorFlag → 必须降级为 PARTIAL
        for (int len = 45; len <= 48; len++) {
            final ReplayDecodeResult r = decoder.decode(ctx, positionPacket(len));
            assertEquals(DecodeStatus.PARTIAL, r.status(), "len=" + len);
            final PositionChangedEvent e = (PositionChangedEvent) r.events().get(0);
            assertEquals(DecodeConfidence.PARTIAL, e.confidence(), "len=" + len);
            assertTrue(r.warnings().stream().anyMatch(w -> "TRUNCATED_POSITION".equals(w.code())),
                    "expected TRUNCATED_POSITION warning at len=" + len);
        }
    }

    @Test
    void tooShortIsMalformed() {
        final ReplayDecodeResult r = decoder.decode(ctx, positionPacket(44));
        assertEquals(DecodeStatus.MALFORMED, r.status());
    }
}
