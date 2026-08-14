package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ShotEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EntityMethodDecoderTest {

    private final EntityMethodDecoder decoder = new EntityMethodDecoder();
    private final ReplayDecodeContext context = new ReplayDecodeContext("test");

    @Test
    void updateArenaKeepsNicknameEvidenceWhenAccountIdIsMissing() {
        final byte[] player = new byte[]{
                0x08, 0x0A,
                0x1A, 0x04, 'A', 'l', 'l', 'y',
                0x20, 0x01
        };
        final byte[] wrapper = prependLengthDelimited(player);
        final byte[] root = prependLengthDelimited(wrapper);
        final byte[] payload = new byte[8 + 4 + 1 + 1 + root.length];
        payload[4] = EntityMethodDecoder.SUBTYPE_UPDATE_ARENA2;
        payload[12] = 0x01;
        payload[13] = (byte) root.length;
        System.arraycopy(root, 0, payload, 14, root.length);
        final RawReplayPacket packet = new RawReplayPacket(
                7, 0, payload.length, EntityMethodDecoder.TYPE_ENTITY_METHOD,
                1.0f, PacketReadStatus.NORMAL, payload, 0);

        final ReplayDecodeResult result = decoder.decode(context, packet);
        final ParticipantMappingEvent event =
                (ParticipantMappingEvent) result.events().getFirst();

        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertEquals(10, event.entityId());
        assertEquals(0L, event.accountId());
        assertEquals("Ally", event.nickname());
        assertEquals(1, event.team());
    }

    /** 伤害方法包（type 8 / sub 8）：body[4..7]=攻击者 eid、body[8..11]=目标 eid、body[13]=伤害子类型、body[14..15]=伤害。 */
    private static RawReplayPacket damageMethodPacket(final int seq, final float clock,
                                                       final int attackerEid, final int victimEid,
                                                       final int damageSub, final int damage) {
        final byte[] payload = new byte[33];
        payload[4] = EntityMethodDecoder.SUBTYPE_ENTITY_METHOD_DAMAGE;
        payload[8] = 0x15; // body[0..3] 固定字段（=0x15）
        payload[12] = (byte) (attackerEid & 0xFF);
        payload[13] = (byte) ((attackerEid >> 8) & 0xFF);
        payload[14] = (byte) ((attackerEid >> 16) & 0xFF);
        payload[15] = (byte) ((attackerEid >> 24) & 0xFF);
        payload[16] = (byte) (victimEid & 0xFF);
        payload[17] = (byte) ((victimEid >> 8) & 0xFF);
        payload[18] = (byte) ((victimEid >> 16) & 0xFF);
        payload[19] = (byte) ((victimEid >> 24) & 0xFF);
        payload[20] = 0x01;
        payload[21] = (byte) damageSub;
        payload[22] = (byte) ((damage >> 8) & 0xFF);
        payload[23] = (byte) (damage & 0xFF);
        return new RawReplayPacket(seq, 0, payload.length, EntityMethodDecoder.TYPE_ENTITY_METHOD,
                clock, PacketReadStatus.NORMAL, payload, 0);
    }

    @Test
    void nonDirectDamageSubEmitsShotEvent() {
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6018, 0xFC6017, 0, 0));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertEquals(1, result.events().size());
        assertTrue(result.events().getFirst() instanceof ShotEvent shot
                && shot.attackerEid() == 0xFC6018 && shot.victimEid() == 0xFC6017);
    }

    @Test
    void directHitWithZeroDamageEmitsShotEventOnly() {
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6018, 0xFC6017, EntityMethodDecoder.DAMAGE_SUB_DIRECT, 0));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertEquals(1, result.events().size());
        assertTrue(result.events().getFirst() instanceof ShotEvent);
        assertFalse(result.events().stream().anyMatch(e -> e instanceof DamageEvent));
    }

    @Test
    void directHitWithDamageEmitsDamageEventOnly() {
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6018, 0xFC6017, EntityMethodDecoder.DAMAGE_SUB_DIRECT, 500));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertEquals(1, result.events().size());
        assertTrue(result.events().getFirst() instanceof DamageEvent);
        assertFalse(result.events().stream().anyMatch(e -> e instanceof ShotEvent));
    }

    @Test
    void shortDamageMethodPacketIsNotAShotAndProducesNoWarning() {
        final byte[] payload = new byte[17];
        payload[4] = EntityMethodDecoder.SUBTYPE_ENTITY_METHOD_DAMAGE;
        final RawReplayPacket packet = new RawReplayPacket(1, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, PacketReadStatus.NORMAL, payload, 0);
        final ReplayDecodeResult result = decoder.decode(context, packet);
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertTrue(result.events().isEmpty());
        assertTrue(result.warnings().isEmpty());
    }

    private static byte[] prependLengthDelimited(final byte[] value) {
        final byte[] result = new byte[value.length + 2];
        result[0] = 0x0A;
        result[1] = (byte) value.length;
        System.arraycopy(value, 0, result, 2, value.length);
        return result;
    }
}
