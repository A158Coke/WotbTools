package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * type 8（EntityMethod）解码回归：
 * - direct damage（subtype 8、body[13]=3、damage>0）必须精确解码为单个 DamageEvent（LE/BE 字节序验证）；
 * - 结构合法但未解码的伤害变体（非 direct / 零伤害 / 短体）→ UNSUPPORTED_DAMAGE_VARIANT（PARTIAL），
 *   不产出事件、不算解析失败（PARSE_FAILED 不得出现）；
 * - 真正截断（payload<8）→ MALFORMED + TRUNCATED_PAYLOAD。
 * 撤回 ShotEvent 后，direct damage 解码不得退化。
 */
class EntityMethodDecoderTest {

    private final EntityMethodDecoder decoder = new EntityMethodDecoder();
    private final ReplayDecodeContext context = new ReplayDecodeContext("test");

    /** 伤害方法包（type 8 / sub 8）：payload[0..3]=entityId、[4..7]=subtype、body[4..7]=攻击者 eid(LE)、
     *  body[8..11]=目标 eid(LE)、body[13]=伤害子类型、body[14..15]=伤害（u16 BE：高字节在前）。 */
    private static RawReplayPacket damageMethodPacket(final int seq, final float clock,
                                                       final int entityId, final int attackerEid,
                                                       final int victimEid, final int damageSub,
                                                       final int damage) {
        final byte[] payload = new byte[33];
        payload[0] = (byte) (entityId & 0xFF);
        payload[1] = (byte) ((entityId >> 8) & 0xFF);
        payload[2] = (byte) ((entityId >> 16) & 0xFF);
        payload[3] = (byte) ((entityId >> 24) & 0xFF);
        payload[4] = EntityMethodDecoder.SUBTYPE_ENTITY_METHOD_DAMAGE;
        payload[8] = 0x15; // body[0..3] 固定字段
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
        payload[22] = (byte) ((damage >> 8) & 0xFF); // u16 高字节在前（网络序），非 LE
        payload[23] = (byte) (damage & 0xFF);
        return new RawReplayPacket(seq, 0, payload.length, EntityMethodDecoder.TYPE_ENTITY_METHOD,
                clock, PacketReadStatus.NORMAL, payload, 0);
    }

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

    @Test
    void directDamageDecodesSingleDamageEventWithExactFields() {
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017,
                        EntityMethodDecoder.DAMAGE_SUB_DIRECT, 500));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertTrue(result.warnings().isEmpty());
        assertEquals(1, result.events().size());
        final DamageEvent event = (DamageEvent) result.events().getFirst();
        assertEquals(0xFC6018, event.attackerEid(), "攻击者 eid 按 LE u32 解码");
        assertEquals(0xFC6017, event.victimEid());
        assertEquals(500, event.damage(), "伤害 u16 高字节在前（0x01F4），不得按 LE 误读为 62465");
        assertEquals(DecodeConfidence.EXACT, event.confidence());
        assertEquals(10f, event.timestamp().rawClockSec());
    }

    @Test
    void nonDirectDamageSubProducesNoEventAndVariantWarning() {
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017, 0, 0));
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertTrue(result.events().isEmpty(), "非 direct 变体不得产出事件（无 DamageEvent、无 ShotEvent）");
        assertEquals(1, result.warnings().size());
        assertEquals("UNSUPPORTED_DAMAGE_VARIANT", result.warnings().getFirst().code());
        assertFalse(result.warnings().getFirst().code().equals("PARSE_FAILED"));
    }

    @Test
    void directSubWithZeroDamageProducesNoEventAndVariantWarning() {
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017,
                        EntityMethodDecoder.DAMAGE_SUB_DIRECT, 0));
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertTrue(result.events().isEmpty());
        assertEquals("UNSUPPORTED_DAMAGE_VARIANT", result.warnings().getFirst().code());
    }

    @Test
    void shortDamageMethodPayloadIsAVariantNotAFailure() {
        // 真实流中的 len=17 短体变体：结构合法但语义未解码
        final byte[] payload = new byte[17];
        payload[4] = EntityMethodDecoder.SUBTYPE_ENTITY_METHOD_DAMAGE;
        payload[8] = 0x05;
        final RawReplayPacket packet = new RawReplayPacket(1, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, PacketReadStatus.NORMAL, payload, 0);
        final ReplayDecodeResult result = decoder.decode(context, packet);
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertTrue(result.events().isEmpty());
        assertEquals("UNSUPPORTED_DAMAGE_VARIANT", result.warnings().getFirst().code());
    }

    @Test
    void truncatedPacketIsMalformedNotVariant() {
        final byte[] payload = new byte[5];
        final RawReplayPacket packet = new RawReplayPacket(1, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, PacketReadStatus.NORMAL, payload, 0);
        final ReplayDecodeResult result = decoder.decode(context, packet);
        assertEquals(DecodeStatus.MALFORMED, result.status());
        assertTrue(result.events().isEmpty());
        assertEquals("TRUNCATED_PAYLOAD", result.warnings().getFirst().code());
    }

    @Test
    void manyUndecodedVariantsAreNotCountedAsParseFailures() {
        // coverage 回归：大量合法未知 variant 不得被统计为 malformed/parse failure，
        // 同时诚实保持 PARTIAL（不计为完整解码）
        final int[] variants = {0, 1, 2, 4, 5, 7, 25, 36, 44, 64};
        for (final int sub : variants) {
            final ReplayDecodeResult result = decoder.decode(context,
                    damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017, sub, 0));
            assertEquals(DecodeStatus.PARTIAL, result.status(), "sub=" + sub);
            assertTrue(result.events().isEmpty(), "sub=" + sub);
            assertEquals("UNSUPPORTED_DAMAGE_VARIANT", result.warnings().getFirst().code(),
                    "sub=" + sub);
        }
    }

    private static byte[] prependLengthDelimited(final byte[] value) {
        final byte[] result = new byte[value.length + 2];
        result[0] = 0x0A;
        result[1] = (byte) value.length;
        System.arraycopy(value, 0, result, 2, value.length);
        return result;
    }
}
