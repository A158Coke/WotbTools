package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.ArenaPeriodChangedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR147 battle-clock / round-finish decoder regressions (Phase B):
 * <ul>
 *   <li>subtype48 wrapper=3 ARENA_PERIOD（root field3 = period）→ {@link ArenaPeriodChangedEvent}；
 *       period=3 BATTLE 是 battle-start anchor。</li>
 *   <li>Avatar method4 (2-byte) → {@link RoundFinishedEvent}（winnerTeam + finishReasonRaw +
 *       safe FinishCause）；未证明 finishReason → UNKNOWN。</li>
 * </ul>
 */
class BattleClockPhaseBTest {

    private final EntityMethodDecoder decoder = new EntityMethodDecoder();
    private final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");

    /** subtype48 payload：body[0..3]=固定字段 + varint(wrapper) + msgLen + protoData（root 直接放入）。 */
    private static RawReplayPacket rawPacket48(final long wrapper, final byte[] root) {
        final byte[] payload = new byte[8 + 4 + 1 + 1 + root.length];
        payload[4] = EntityMethodDecoder.SUBTYPE_UPDATE_ARENA2;
        payload[12] = (byte) wrapper;
        payload[13] = (byte) root.length;
        System.arraycopy(root, 0, payload, 14, root.length);
        return new RawReplayPacket(7, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 56.233f, PacketReadStatus.NORMAL, payload, 0);
    }

    private static RawReplayPacket method(final int subtype, final byte[] args) {
        final byte[] payload = new byte[12 + args.length];
        payload[4] = (byte) subtype;
        payload[8] = (byte) args.length;
        System.arraycopy(args, 0, payload, 12, args.length);
        return new RawReplayPacket(1, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, PacketReadStatus.NORMAL, payload, 0);
    }

    @Test
    void wrapper3BattleIsBattleStartAnchor() {
        // root field3 = period 3 (BATTLE)
        final byte[] root = {0x18, 0x03}; // field3 varint 3
        final ReplayDecodeResult r = decoder.decode(ctx, rawPacket48(EntityMethodDecoder.WRAPPER_ARENA_PERIOD, root));
        final ArenaPeriodChangedEvent e = r.events().stream()
                .filter(ArenaPeriodChangedEvent.class::isInstance)
                .map(ArenaPeriodChangedEvent.class::cast)
                .findFirst().orElseThrow();
        assertEquals(3, e.periodRaw());
        assertEquals(ArenaPeriodChangedEvent.Period.BATTLE, e.period());
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertTrue(r.events().size() >= 1);
    }

    @Test
    void wrapper3AfterbattlePeriod() {
        final byte[] root = {0x18, 0x04}; // field3 varint 4 (AFTERBATTLE)
        final ReplayDecodeResult r = decoder.decode(ctx, rawPacket48(EntityMethodDecoder.WRAPPER_ARENA_PERIOD, root));
        final ArenaPeriodChangedEvent e = r.events().stream()
                .filter(ArenaPeriodChangedEvent.class::isInstance)
                .map(ArenaPeriodChangedEvent.class::cast)
                .findFirst().orElseThrow();
        assertEquals(ArenaPeriodChangedEvent.Period.AFTERBATTLE, e.period());
    }

    @Test
    void avatarMethod4RoundFinished() {
        // method4 args: winnerTeam(u8)=2, finishReason(u8)=1 (elimination)
        final ReplayDecodeResult r = decoder.decode(ctx,
                method(EntityMethodDecoder.SUBTYPE_ROUND_FINISHED, new byte[]{2, 1}));
        final RoundFinishedEvent e = assertInstanceOf(RoundFinishedEvent.class, r.events().get(0));
        assertEquals(2, e.winnerTeam());
        assertEquals(1, e.finishReasonRaw());
        assertEquals(RoundFinishedEvent.FinishCause.ELIMINATION, e.finishCause());
        assertEquals(DecodeConfidence.EXACT, e.confidence());
    }

    @Test
    void method4UnknownFinishReasonRawPreservedAsUnknown() {
        final ReplayDecodeResult r = decoder.decode(ctx,
                method(EntityMethodDecoder.SUBTYPE_ROUND_FINISHED, new byte[]{1, 9}));
        final RoundFinishedEvent e = assertInstanceOf(RoundFinishedEvent.class, r.events().get(0));
        assertEquals(9, e.finishReasonRaw());
        assertEquals(RoundFinishedEvent.FinishCause.UNKNOWN, e.finishCause(),
                "未证明 finishReason 不得 invent enum 名");
    }
}
