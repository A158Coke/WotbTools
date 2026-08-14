package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import java.util.List;

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

    @Test
    void updateArena2Field12DecodesRealtimeSupremacyPointsForBothTeams() {
        final RawReplayPacket packet = pointsPacket(1, 56.233f, 1, 303, 2, 306);
        final ReplayDecodeResult result = decoder.decode(context, packet);
        final List<SupremacyPointsChangedEvent> points = result.events().stream()
                .filter(SupremacyPointsChangedEvent.class::isInstance)
                .map(SupremacyPointsChangedEvent.class::cast).toList();
        assertEquals(2, points.size());
        final SupremacyPointsChangedEvent t1 = points.get(0);
        assertEquals(1, t1.team());
        assertEquals(303, t1.points());
        assertEquals(DecodeConfidence.EXACT, t1.confidence());
        assertEquals(56.233f, t1.timestamp().rawClockSec(), 1e-6);
        final SupremacyPointsChangedEvent t2 = points.get(1);
        assertEquals(2, t2.team());
        assertEquals(306, t2.points());
        assertEquals(DecodeConfidence.EXACT, t2.confidence());
        assertEquals(DecodeStatus.SUCCESS, result.status());
    }

    @Test
    void malformedField12DoesNotProduceExactPointEvent() {
        // team=9（非法）→ 跳过；points=负数 → 跳过；缺 field2 → 跳过
        final byte[] badTeam = fieldDelimited(12, teamPointsMessage(9, 100));
        final byte[] badPoints = fieldDelimited(12, teamPointsMessage(1, -5));
        final byte[] noField2 = fieldDelimited(12, new byte[]{0x08, 0x01});
        final RawReplayPacket packet = rawPacket48(concat(badTeam, badPoints, noField2));
        final ReplayDecodeResult result = decoder.decode(context, packet);
        assertTrue(result.events().stream().noneMatch(SupremacyPointsChangedEvent.class::isInstance),
                "非法 field12 不得产出 EXACT 点数事件");
    }

    private static byte[] teamPointsMessage(final int team, final int points) {
        final byte[] teamVar = varint(team);
        final byte[] pointsVar = varint(points);
        final byte[] out = new byte[1 + teamVar.length + 1 + pointsVar.length];
        int off = 0;
        out[off++] = 0x08;
        System.arraycopy(teamVar, 0, out, off, teamVar.length);
        off += teamVar.length;
        out[off++] = 0x10;
        System.arraycopy(pointsVar, 0, out, off, pointsVar.length);
        return out;
    }

    private static byte[] fieldDelimited(final int fieldNumber, final byte[] value) {
        final int tag = (fieldNumber << 3) | 2;
        final byte[] out = new byte[2 + value.length];
        out[0] = (byte) tag;
        out[1] = (byte) value.length;
        System.arraycopy(value, 0, out, 2, value.length);
        return out;
    }

    private static byte[] concat(final byte[]... arrays) {
        int total = 0;
        for (final byte[] a : arrays) total += a.length;
        final byte[] out = new byte[total];
        int off = 0;
        for (final byte[] a : arrays) {
            System.arraycopy(a, 0, out, off, a.length);
            off += a.length;
        }
        return out;
    }

    private static byte[] varint(final long value) {
        final java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        long v = value;
        while ((v & ~0x7FL) != 0) {
            out.write((int) ((v & 0x7F) | 0x80));
            v >>>= 7;
        }
        out.write((int) v);
        return out.toByteArray();
    }

    private static RawReplayPacket pointsPacket(final int seq, final float clock,
                                                 final int team1, final int p1, final int team2, final int p2) {
        // root field12 直接携带 {field1=team, field2=points}（交叉验证：数量/点数区间与真实回放一致）
        return rawPacket48(concat(fieldDelimited(12, teamPointsMessage(team1, p1)),
                fieldDelimited(12, teamPointsMessage(team2, p2))));
    }

    /** subtype48 载荷：body[0..3] 固定字段 + varint + msgLen + protoData（root 直接放入）。 */
    private static RawReplayPacket rawPacket48(final byte[] root) {
        final byte[] payload = new byte[8 + 4 + 1 + 1 + root.length];
        payload[4] = EntityMethodDecoder.SUBTYPE_UPDATE_ARENA2;
        payload[12] = 0x01;
        payload[13] = (byte) root.length;
        System.arraycopy(root, 0, payload, 14, root.length);
        return new RawReplayPacket(7, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 56.233f, PacketReadStatus.NORMAL, payload, 0);
    }
}
