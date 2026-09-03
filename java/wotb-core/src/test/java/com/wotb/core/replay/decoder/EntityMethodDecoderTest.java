package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ProjectileLaunchedEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.RawSupremacyBaseUpdate;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.event.UnsupportedDamageEvent;
import com.wotb.core.replay.event.VehicleFiredEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.event.VehicleVehicleCollisionEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * type 8（EntityMethod）解码回归：
 * - direct damage（subtype 8、body[13]=3、damage>0）必须精确解码为单个 DamageEvent（LE/BE 字节序验证）；
 * - 结构合法但未解码的伤害方法变体（body[13] ≠ direct）→ 产出 {@link UnsupportedDamageEvent}
 *   （PARTIAL 证据事件：保留时间 + 攻击者/受击者 eid，不产生精确伤害数字），
 *   同时记 UNSUPPORTED_DAMAGE_VARIANT warning——供 killer/HP-loss attribution fail-closed，
 *   不算解析失败（PARSE_FAILED 不得出现）；
 * - 短体（body<18 / payload<25，如真实流 len=17 变体）→ 同样产出 {@link UnsupportedDamageEvent}
 *   （SHORT_DAMAGE_VARIANT：victim 用可靠 outer entityId、attacker 未知、无伤害数字）+ warning——
 *   warning 绝不能是唯一输出（否则 PlaybackCombatReconstruction 只消费 canonical 事件、
 *   看不到冲突证据，掉血/致死窗口会错误地「无冲突」）；
 * - direct 变体但 raw 伤害 == 0 → 产出 {@link UnsupportedDamageEvent}
 *   （ZERO_RAW_DAMAGE）——raw 值不是权威 HP delta，不得仅凭 0 判定「无伤害」；
 * - 真正截断（payload<8）→ MALFORMED + TRUNCATED_PAYLOAD（无法确认 damage method）。
 * 撤回 ShotEvent 后，direct damage 解码不得退化。
 */
class EntityMethodDecoderTest {

    private final EntityMethodDecoder decoder = new EntityMethodDecoder();
    private final ReplayDecodeContext context = new ReplayDecodeContext("11.19.0_china");

    /** PR162 entity-class scoped：method8 的 outer entityId（受击者）需先由 MaterializationEvent(entityTypeId==2) 证明为 Vehicle。 */
    @BeforeEach
    void registerVehicleDamageTarget() {
        // 0xFC6017 是 method8 测试的 outer entityId（受击者）。真实 lifecycle 证据：entityTypeId==2 → Vehicle。
        context.entityClassRegistry().markVehicle(0xFC6017);
    }

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
                clock, payload, 0);
    }

    @Test
    void updateArenaKeepsNicknameEvidenceWhenAccountIdIsMissing() {
        context.entityClassRegistry().markAvatar(0);
        final byte[] player = new byte[]{
                0x08, 0x0A,
                0x1A, 0x04, 'A', 'l', 'l', 'y',
                0x20, 0x01
        };
        final byte[] wrapper = prependLengthDelimited(player);
        final byte[] root = prependLengthDelimited(wrapper);
        final byte[] payload = new byte[8 + 4 + 1 + 1 + root.length];
        payload[4] = EntityMethodDecoder.SUBTYPE_UPDATE_ARENA2;
        putU32(payload, 8, payload.length - 12);
        payload[12] = 0x01;
        payload[13] = (byte) root.length;
        System.arraycopy(root, 0, payload, 14, root.length);
        final RawReplayPacket packet = new RawReplayPacket(
                7, 0, payload.length, EntityMethodDecoder.TYPE_ENTITY_METHOD,
                1.0f, payload, 0);

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
    void directDamageDecodesSingleVehicleHitEventWithExactFields() {
        // method8 direct = hit/result-feedback (VehicleHitEvent), NOT HP damage. The raw u16
        // "damage" is not an HP delta; authoritative HP loss = Type7 prop3 deltas.
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017,
                        EntityMethodDecoder.DAMAGE_SUB_DIRECT, 500));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertTrue(result.warnings().isEmpty());
        assertEquals(1, result.events().size());
        final VehicleHitEvent event = (VehicleHitEvent) result.events().getFirst();
        assertEquals(0xFC6018, event.attackerEntityId(), "攻击者 eid 按 LE u32 解码");
        assertEquals(0xFC6017, event.victimEntityId());
        assertEquals(3, event.primaryResultRaw(), "direct 变体 primary=body[13]=3");
        assertEquals(1, event.secondaryResultRaw(), "secondary=body[14]=damage 高字节(0x01F4 -> 1)");
        assertEquals(VehicleHitEvent.PenetrationFamily.PENETRATION, event.penetrationFamily());
        assertEquals(DecodeConfidence.EXACT, event.confidence());
        assertEquals(10f, event.timestamp().rawClockSec());
    }

    @Test
    void nonDirectDamageSubProducesUnsupportedEvidenceEvent() {
        // 结构合法但语义未解码的伤害方法变体（body[13]≠3，如火灾/撞击）→ 证据事件
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017, 0, 0));
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertEquals(1, result.events().size(), "非 direct 变体必须产出 UnsupportedDamageEvent 证据事件");
        final UnsupportedDamageEvent ev = (UnsupportedDamageEvent) result.events().getFirst();
        assertEquals(0xFC6018, ev.attackerEid(), "攻击者 eid 按 LE u32 解码（结构可解析）");
        assertEquals(0xFC6017, ev.victimEid(), "受击者 eid 按 LE u32 解码");
        assertEquals(DecodeConfidence.PARTIAL, ev.confidence());
        assertEquals("DAMAGE_METHOD_VARIANT", ev.variant());
        assertEquals(10f, ev.timestamp().rawClockSec(), 1e-6);
        assertEquals(1, result.warnings().size());
        assertEquals("UNSUPPORTED_DAMAGE_VARIANT", result.warnings().getFirst().code());
        assertFalse(result.warnings().getFirst().code().equals("PARSE_FAILED"));
    }

    @Test
    void nonDirectVariantWithMissingVictimEidFallsBackToOuterEntityId() {
        // 结构合法但 body 内 victim eid 缺失（0）的 unsupported 变体：不得静默丢弃——
        // 用可靠 outer entityId（方法调用目标实体 = 受击者）作 victim 证据
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0, 0, 0));
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertEquals(1, result.events().size());
        final UnsupportedDamageEvent ev = (UnsupportedDamageEvent) result.events().getFirst();
        assertEquals(0xFC6017, ev.victimEid(), "victim eid 缺失时用 outer entityId 作 victim 证据");
        assertEquals(0xFC6018, ev.attackerEid());
        assertEquals("DAMAGE_METHOD_VARIANT", ev.variant());
    }

    @Test
    void directSubWithZeroRawDamageStillProducesVehicleHitEvent() {
        // direct 变体但 raw "damage" == 0：method8 是 hit/result-feedback 家族，raw 值不是数值伤害——
        // 仍产出 EXACT VehicleHitEvent（attacker/victim + result 分类），非冲突证据。
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017,
                        EntityMethodDecoder.DAMAGE_SUB_DIRECT, 0));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertEquals(1, result.events().size());
        final VehicleHitEvent ev = (VehicleHitEvent) result.events().getFirst();
        assertEquals(0xFC6018, ev.attackerEntityId());
        assertEquals(0xFC6017, ev.victimEntityId());
        assertEquals(3, ev.primaryResultRaw());
        assertEquals(0, ev.secondaryResultRaw());
        assertEquals(DecodeConfidence.EXACT, ev.confidence());
    }

    @Test
    void zeroRawDamageWithMissingVictimEidFallsBackToOuterEntityId() {
        // direct 且 body 内 victim eid 缺失（0）：仍产出 EXACT VehicleHitEvent，victim 用可靠 outer entityId。
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0,
                        EntityMethodDecoder.DAMAGE_SUB_DIRECT, 0));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertEquals(1, result.events().size());
        final VehicleHitEvent ev = (VehicleHitEvent) result.events().getFirst();
        assertEquals(0xFC6017, ev.victimEntityId(), "victim eid 缺失时用 outer entityId 作 victim 证据");
        assertEquals(0xFC6018, ev.attackerEntityId());
        assertEquals(3, ev.primaryResultRaw());
        assertEquals(DecodeConfidence.EXACT, ev.confidence());
    }

    @Test
    void directDamageWithMissingVictimEidFallsBackToOuterEntityId() {
        // direct 且 body 内 victim eid 缺失（0）：仍产出 EXACT VehicleHitEvent，victim 用可靠 outer entityId
        // （方法调用目标实体）——整个 direct 分支产出 hit-feedback 证据，非冲突/降级。
        final ReplayDecodeResult result = decoder.decode(context,
                damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0,
                        EntityMethodDecoder.DAMAGE_SUB_DIRECT, 500));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertEquals(1, result.events().size());
        final VehicleHitEvent ev = (VehicleHitEvent) result.events().getFirst();
        assertEquals(0xFC6018, ev.attackerEntityId(), "攻击者 eid 仍可解析");
        assertEquals(0xFC6017, ev.victimEntityId(), "victim 用可靠 outer entityId（方法调用目标实体）");
        assertEquals(3, ev.primaryResultRaw());
        assertEquals(1, ev.secondaryResultRaw());
        assertEquals(DecodeConfidence.EXACT, ev.confidence());
    }

    @Test
    void shortDamageMethodPayloadProducesConflictEvidenceWithOuterVictim() {
        // 真实流中的 len=17 短体变体：结构不足以解析身份字段，但包头已确认 damage method——
        // 必须保留带时间戳的冲突证据事件（victim=可靠 outer entityId、attacker 未知、无伤害数字）
        final byte[] payload = new byte[17];
        payload[0] = (byte) 0x17;
        payload[1] = (byte) 0x60;
        payload[2] = (byte) 0xFC;
        payload[3] = 0;
        payload[4] = EntityMethodDecoder.SUBTYPE_ENTITY_METHOD_DAMAGE;
        payload[8] = 0x05;
        final RawReplayPacket packet = new RawReplayPacket(1, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, payload, 0);
        final ReplayDecodeResult result = decoder.decode(context, packet);
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertEquals(1, result.events().size(), "短体变体必须产出冲突证据事件（不能只有 warning）");
        final UnsupportedDamageEvent ev = (UnsupportedDamageEvent) result.events().getFirst();
        assertEquals(0, ev.attackerEid(), "attacker 无法解析 → 保持未知");
        assertEquals(0xFC6017, ev.victimEid(), "victim 用可靠 outer entityId（方法调用目标实体）");
        assertEquals(DecodeConfidence.PARTIAL, ev.confidence());
        assertEquals("SHORT_DAMAGE_VARIANT", ev.variant());
        assertEquals(10f, ev.timestamp().rawClockSec(), 1e-6);
        assertEquals("UNSUPPORTED_DAMAGE_VARIANT", result.warnings().getFirst().code(),
                "warning 保留作诊断（但不是唯一输出）");
    }

    @Test
    void truncatedPacketIsMalformedButRawPreserved() {
        // PR162/P1-4：known packet type + invalid semantic shape 不得 silent disappear —— 必须 raw-preserve
        // 为 UnknownReplayEvent（保留 debug），而非旧「events 为空 + warning」。
        final byte[] payload = new byte[5];
        final RawReplayPacket packet = new RawReplayPacket(1, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, payload, 0);
        final ReplayDecodeResult result = decoder.decode(context, packet);
        assertEquals(DecodeStatus.MALFORMED, result.status());
        assertEquals(1, result.events().size(), "malformed 不得 silent disappear");
        assertTrue(result.events().get(0) instanceof com.wotb.core.replay.event.UnknownReplayEvent);
        assertEquals("TYPE8_ENVELOPE_TRUNCATED",
                ((com.wotb.core.replay.event.UnknownReplayEvent) result.events().get(0)).reasonCode());
        assertEquals("TRUNCATED_PAYLOAD", result.warnings().getFirst().code());
    }

    @Test
    void manyUndecodedVariantsAreNotCountedAsParseFailures() {
        // coverage 回归：大量合法未知 variant 不得被统计为 malformed/parse failure，
        // 同时诚实保持 PARTIAL（不计为完整解码）；每个变体产出 UnsupportedDamageEvent 证据事件
        final int[] variants = {0, 1, 2, 4, 5, 7, 25, 36, 44, 64};
        for (final int sub : variants) {
            final ReplayDecodeResult result = decoder.decode(context,
                    damageMethodPacket(1, 10f, 0xFC6017, 0xFC6018, 0xFC6017, sub, 0));
            assertEquals(DecodeStatus.PARTIAL, result.status(), "sub=" + sub);
            assertEquals(1, result.events().size(), "sub=" + sub);
            assertTrue(result.events().getFirst() instanceof UnsupportedDamageEvent, "sub=" + sub);
            final UnsupportedDamageEvent ev = (UnsupportedDamageEvent) result.events().getFirst();
            assertEquals(0xFC6018, ev.attackerEid(), "sub=" + sub);
            assertEquals(0xFC6017, ev.victimEid(), "sub=" + sub);
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
        context.entityClassRegistry().markAvatar(0);
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
    void updateArena2Wrapper12DecodesAuthoritativeBaseStateFields() {
        context.entityClassRegistry().markAvatar(0);
        // wrapper12 root field11: base B (zero-based index 1), capturing team 1, 3% progress.
        // Fields 5/6 are retained only as raw diagnostics; they have no production semantics.
        final byte[] base = new byte[]{0x08, 0x01, 0x18, 0x01, 0x20, 0x03, 0x28, 0x01, 0x30, 0x01};
        final ReplayDecodeResult result = decoder.decode(context,
                rawPacket48(EntityMethodDecoder.WRAPPER_SUPREMACY_BASE, fieldDelimited(11, base)));
        final RawSupremacyBaseUpdate event = assertInstanceOf(
                RawSupremacyBaseUpdate.class, result.events().getFirst());
        assertEquals(1, event.baseIndex());
        assertNull(event.ownerTeam());
        assertEquals(1, event.capturingTeam());
        assertEquals(3, event.captureProgress());
        assertEquals(1, event.rawField5());
        assertEquals(1, event.rawField6());
        assertEquals(DecodeConfidence.EXACT, event.confidence());
        assertEquals(DecodeStatus.SUCCESS, result.status());
    }

    @Test
    void updateArena2Wrapper12PreservesExplicitZeroCaptureProgress() {
        context.entityClassRegistry().markAvatar(0);
        final byte[] baseWithExplicitZeroProgress = new byte[]{0x08, 0x02, 0x20, 0x00};
        final ReplayDecodeResult result = decoder.decode(context,
                rawPacket48(EntityMethodDecoder.WRAPPER_SUPREMACY_BASE,
                        fieldDelimited(11, baseWithExplicitZeroProgress)));

        final RawSupremacyBaseUpdate event = assertInstanceOf(
                RawSupremacyBaseUpdate.class, result.events().getFirst());
        assertEquals(2, event.baseIndex());
        assertEquals(0, event.captureProgress());
    }

    @Test
    void updateArena2Wrapper12PreservesAbsentFieldsAndProtobufDefaultBase() {
        context.entityClassRegistry().markAvatar(0);
        final ReplayDecodeResult result = decoder.decode(context,
                rawPacket48(EntityMethodDecoder.WRAPPER_SUPREMACY_BASE,
                        fieldDelimited(11, new byte[]{0x20, 0x00})));

        final RawSupremacyBaseUpdate event = assertInstanceOf(
                RawSupremacyBaseUpdate.class, result.events().getFirst());
        assertNull(event.baseIndex(), "field1 absent must remain distinguishable from explicit zero");
        assertNull(event.ownerTeam());
        assertNull(event.capturingTeam());
        assertEquals(0, event.captureProgress(), "explicit field4=0 must be preserved");
        assertNull(event.rawField5());
        assertNull(event.rawField6());
    }

    @Test
    void malformedOrWrongWrapper12DoesNotProduceBaseStateEvent() {
        context.entityClassRegistry().markAvatar(0);
        final ReplayDecodeResult malformed = decoder.decode(context,
                rawPacket48(EntityMethodDecoder.WRAPPER_SUPREMACY_BASE,
                        fieldDelimited(11, new byte[]{0x08})));
        assertTrue(malformed.events().stream().noneMatch(RawSupremacyBaseUpdate.class::isInstance));

        final ReplayDecodeResult wrongWrapper = decoder.decode(context,
                rawPacket48(EntityMethodDecoder.WRAPPER_ARENA_PERIOD,
                        fieldDelimited(11, new byte[]{0x08, 0x00})));
        assertTrue(wrongWrapper.events().stream().noneMatch(RawSupremacyBaseUpdate.class::isInstance));
    }

    @Test
    void wrapper13MalformedField12DoesNotProduceExactPointEvent() {
        context.entityClassRegistry().markAvatar(0);
        // wrapper=13 但：team=9（非法）→ 跳过；points=负数 → 跳过；缺 field2 → 跳过
        final byte[] badTeam = fieldDelimited(12, teamPointsMessage(9, 100));
        final byte[] badPoints = fieldDelimited(12, teamPointsMessage(1, -5));
        final byte[] noField2 = fieldDelimited(12, new byte[]{0x08, 0x01});
        final RawReplayPacket packet = rawPacket48(EntityMethodDecoder.WRAPPER_SUPREMACY_POINTS,
                concat(badTeam, badPoints, noField2));
        final ReplayDecodeResult result = decoder.decode(context, packet);
        assertTrue(result.events().stream().noneMatch(SupremacyPointsChangedEvent.class::isInstance),
                "非法 field12 不得产出 EXACT 点数事件");
    }

    @Test
    void wrapperFieldNumberNot13DoesNotProducePointsEvenWithSameRootField12() {
        // 与 pointsPacket 完全相同的 root field12，但 wrapperFieldNumber=1（名册）与 18（配置）
        final byte[] sameRoot = concat(fieldDelimited(12, teamPointsMessage(1, 303)),
                fieldDelimited(12, teamPointsMessage(2, 306)));
        for (final long wrapper : new long[]{1L, 18L}) {
            final ReplayDecodeResult result = decoder.decode(context,
                    rawPacket48(wrapper, sameRoot));
            assertTrue(result.events().stream().noneMatch(SupremacyPointsChangedEvent.class::isInstance),
                    "wrapper=" + wrapper + " 不得产出实时点数事件（即使 root 结构相同）");
        }
    }

    @Test
    void unknownInnerWrapperIsRawPreserved() {
        final ReplayDecodeResult result = decoder.decode(context,
                rawPacket48(99L, new byte[]{0x08, 0x01}));

        final UnknownReplayEvent unknown = assertInstanceOf(UnknownReplayEvent.class, result.events().getFirst());
        assertTrue(unknown.reasonCode().contains("METHOD48_INNER_SHAPE_UNKNOWN"));
        assertEquals("ENTITY_METHOD_UNDECODED", result.warnings().getFirst().code());
    }

    @Test
    void innerLengthTrailingBytesAreRawPreserved() {
        final RawReplayPacket valid = rawPacket48(EntityMethodDecoder.WRAPPER_ARENA_PERIOD,
                new byte[]{0x18, 0x03});
        final byte[] payload = new byte[valid.payload().length + 1];
        System.arraycopy(valid.payload(), 0, payload, 0, valid.payload().length);
        payload[payload.length - 1] = 0x7F;
        putU32(payload, 8, payload.length - 12);

        final ReplayDecodeResult result = decoder.decode(context, new RawReplayPacket(
                valid.sequence(), valid.sourceOffset(), payload.length, valid.type(), valid.rawClockSec(), payload, 0));
        final UnknownReplayEvent unknown = assertInstanceOf(UnknownReplayEvent.class, result.events().getFirst());
        assertTrue(unknown.reasonCode().contains("METHOD48_INNER_SHAPE_UNKNOWN"));
        assertEquals("ENTITY_METHOD_UNDECODED", result.warnings().getFirst().code());
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

    /** wrapper=13（实时点数）的完整 subtype48 载荷。 */
    private static RawReplayPacket pointsPacket(final int seq, final float clock,
                                                 final int team1, final int p1, final int team2, final int p2) {
        return rawPacket48(EntityMethodDecoder.WRAPPER_SUPREMACY_POINTS,
                concat(fieldDelimited(12, teamPointsMessage(team1, p1)),
                        fieldDelimited(12, teamPointsMessage(team2, p2))));
    }

    /** 通用 EntityMethod 包：entityId + subtype + argLen + args。 */
    private static RawReplayPacket methodPacket(final int seq, final int subtype, final byte[] args) {
        final byte[] payload = new byte[12 + args.length];
        putU32(payload, 0, 12345);
        putU32(payload, 4, subtype);
        putU32(payload, 8, args.length);
        System.arraycopy(args, 0, payload, 12, args.length);
        return new RawReplayPacket(seq, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, payload, 0);
    }

    private static void putU32(final byte[] buf, final int i, final int v) {
        buf[i] = (byte) v;
        buf[i + 1] = (byte) (v >>> 8);
        buf[i + 2] = (byte) (v >>> 16);
        buf[i + 3] = (byte) (v >>> 24);
    }

    /** A valid method0 envelope and vehicle class evidence decode independently of version metadata. */
    @Test
    void futureVersionLayoutMethodStructurallyDecodes() {
        final ReplayDecodeContext future = new ReplayDecodeContext("11.20.0_china");
        future.entityClassRegistry().markVehicle(12345);
        final ReplayDecodeResult result = decoder.decode(future,
                methodPacket(1, EntityMethodDecoder.SUBTYPE_VEHICLE_FIRED, new byte[]{0x01}));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertInstanceOf(VehicleFiredEvent.class, result.events().getFirst());
    }

    /** A valid method29 envelope and avatar class evidence decode independently of version metadata. */
    @Test
    void futureVersionProjectileLaunchStructurallyDecodes() {
        final ReplayDecodeContext future = new ReplayDecodeContext("12.0.0_eu");
        future.entityClassRegistry().markAvatar(12345);
        final byte[] args = new byte[37]; // PROJECTILE_LAUNCH_ARGS_LEN
        final ReplayDecodeResult result = decoder.decode(future,
                methodPacket(1, EntityMethodDecoder.SUBTYPE_PROJECTILE_LAUNCH, args));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        assertInstanceOf(ProjectileLaunchedEvent.class, result.events().getFirst());
    }

    /** P0-3：当前 canonical 11.19 仍解码 method29 为 EXACT（不因 gate 回归）。 */
    @Test
    void currentVersionLayoutMethodStillDecodesExact() {
        context.entityClassRegistry().markAvatar(12345);
        final byte[] args = new byte[37];
        args[0] = 0x01;
        args[1] = 0x02;
        args[2] = 0x03;
        args[3] = 0x04;
        // other bytes zero -> launchPoint=(0,0,0), velocity=(0,0,0), invariant=0 (finite)
        final ReplayDecodeResult result = decoder.decode(context,
                methodPacket(1, EntityMethodDecoder.SUBTYPE_PROJECTILE_LAUNCH, args));
        assertEquals(DecodeStatus.SUCCESS, result.status(), "11.19 method29 仍应解码 EXACT");
        assertEquals(1, result.events().size());
    }

    // ---- PR162 entity-class scoped contract（method4：Avatar 2B=RoundFinished；Vehicle 16B=collision）----

    /** 指定 entityId 的 EntityMethod 包（type 8）：entityId + subtype + argLen + args。 */
    private static RawReplayPacket methodPacketOn(final int seq, final int entityId,
                                                  final int subtype, final byte[] args) {
        final byte[] payload = new byte[12 + args.length];
        putU32(payload, 0, entityId);
        putU32(payload, 4, subtype);
        putU32(payload, 8, args.length);
        System.arraycopy(args, 0, payload, 12, args.length);
        return new RawReplayPacket(seq, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, payload, 0);
    }

    /** f32 LE 字节。 */
    private static byte[] f32(final float v) {
        final int bits = Float.floatToIntBits(v);
        return new byte[]{(byte) (bits & 0xFF), (byte) ((bits >>> 8) & 0xFF),
                (byte) ((bits >>> 16) & 0xFF), (byte) ((bits >>> 24) & 0xFF)};
    }

    /** Vehicle method4 16-byte collision/contact args：sharedScalar + contactPoint(3×f32)。 */
    private static byte[] vehicleCollisionArgs(final float scalar, final float x, final float y, final float z) {
        return concat(f32(scalar), f32(x), f32(y), f32(z));
    }

    @Test
    void avatarMethod4TwoByteDecodesRoundFinishedNotCollision() {
        final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");
        ctx.entityClassRegistry().markAvatar(900);
        final ReplayDecodeResult r = decoder.decode(ctx,
                methodPacketOn(1, 900, EntityMethodDecoder.SUBTYPE_ROUND_FINISHED, new byte[]{2, 1}));
        assertEquals(1, r.events().size());
        final RoundFinishedEvent e = assertInstanceOf(RoundFinishedEvent.class, r.events().get(0));
        assertEquals(2, e.winnerTeam());
        assertEquals(1, e.finishReasonRaw());
        assertEquals(RoundFinishedEvent.FinishCause.ELIMINATION, e.finishCause());
        assertTrue(r.events().stream().noneMatch(VehicleVehicleCollisionEvent.class::isInstance),
                "Avatar method4 2B 禁止生 VehicleVehicleCollisionEvent");
    }

    @Test
    void vehicleMethod4SixteenByteDecodesCollisionNotRoundFinished() {
        final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");
        ctx.entityClassRegistry().markVehicle(901);
        final ReplayDecodeResult r = decoder.decode(ctx,
                methodPacketOn(1, 901, EntityMethodDecoder.SUBTYPE_ROUND_FINISHED,
                        vehicleCollisionArgs(1.5f, 2f, 3f, 4f)));
        assertEquals(1, r.events().size());
        final VehicleVehicleCollisionEvent e =
                assertInstanceOf(VehicleVehicleCollisionEvent.class, r.events().get(0));
        assertEquals(901, e.vehicleEntityId());
        assertEquals(1.5f, e.sharedScalar(), 1e-6f);
        assertEquals(2f, e.contactPointWorld().x(), 1e-6f);
        assertEquals(3f, e.contactPointWorld().y(), 1e-6f);
        assertEquals(4f, e.contactPointWorld().z(), 1e-6f);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertTrue(r.events().stream().noneMatch(RoundFinishedEvent.class::isInstance),
                "Vehicle method4 16B 禁止生 RoundFinishedEvent");
    }

    @Test
    void verifiedRoundFinishedTwoByteDecodesRegardlessOfClass() {
        // 真实 11.19.0_china_apple 证据：2B round-finished 由非录像者实体发送（entity≠recorder avatar），
        // entityClass 未必 AVATAR；2B shape 唯一（Vehicle method4 仅 16B collision）+ VERIFIED 关闭语义 =>
        // 按权威 shape 解码为 RoundFinishedEvent，不再因缺 AVATAR 类证据丢 disc 成 UnknownReplayEvent。
        final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");
        final ReplayDecodeResult r = decoder.decode(ctx,
                methodPacketOn(1, 902, EntityMethodDecoder.SUBTYPE_ROUND_FINISHED, new byte[]{2, 1}));
        assertInstanceOf(RoundFinishedEvent.class, r.events().getFirst());
        assertTrue(r.events().stream().noneMatch(VehicleVehicleCollisionEvent.class::isInstance));
    }

    @Test
    void verifiedRoundFinishedTwoByteDecodesEvenWhenVehicleClass() {
        // Vehicle 类 + 2B round-finished：同属 2B 唯一 shape + VERIFIED 语义 => 仍应按 round-finished 解码
        // （该方法索引被 Vehicle 借用法与 16B collision 区分；2B 无 Vehicle 变体）。
        final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");
        ctx.entityClassRegistry().markVehicle(903);
        final ReplayDecodeResult r = decoder.decode(ctx,
                methodPacketOn(1, 903, EntityMethodDecoder.SUBTYPE_ROUND_FINISHED, new byte[]{2, 1}));
        assertInstanceOf(RoundFinishedEvent.class, r.events().getFirst());
        assertTrue(r.events().stream().noneMatch(VehicleVehicleCollisionEvent.class::isInstance));
    }

    @Test
    void avatarClassMethod4SixteenByteRawPreserves() {
        // Avatar 类 method4+16B（shape 不符，Avatar round finished 需 2B）→ UnknownReplayEvent
        final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");
        ctx.entityClassRegistry().markAvatar(904);
        final ReplayDecodeResult r = decoder.decode(ctx,
                methodPacketOn(1, 904, EntityMethodDecoder.SUBTYPE_ROUND_FINISHED,
                        vehicleCollisionArgs(1.5f, 2f, 3f, 4f)));
        assertInstanceOf(UnknownReplayEvent.class, r.events().getFirst());
        assertTrue(r.events().stream().noneMatch(RoundFinishedEvent.class::isInstance));
        assertTrue(r.events().stream().noneMatch(VehicleVehicleCollisionEvent.class::isInstance));
    }

    @Test
    void recorderAvatarIdentityOverridesMaterializedVehicleClass() {
        // PR162/P0-1：Avatar 类只由独立身份/生命周期证据建立（此处 markAvatar 模拟 subtype-49 recorder
        // sync-options 身份锚点）；先物化为 Vehicle（markVehicle）不会把已证明的 Avatar 降级（粘性）。
        // method4+2B 必须按 Avatar 分派为 RoundFinished（不允许因「先 Vehicle」而 raw-preserve）。
        final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");
        ctx.entityClassRegistry().markVehicle(910);
        ctx.entityClassRegistry().markAvatar(910);
        final ReplayDecodeResult r = decoder.decode(ctx,
                methodPacketOn(1, 910, EntityMethodDecoder.SUBTYPE_ROUND_FINISHED, new byte[]{2, 1}));
        final RoundFinishedEvent e = assertInstanceOf(RoundFinishedEvent.class, r.events().get(0));
        assertEquals(2, e.winnerTeam());
    }

    /** PR162/P0-1.5：EntityMethod decode 必须是 class authority 的<b>纯消费</b>，不得修改 registry。 */
    @Test
    void entityMethodDecodeDoesNotMutateEntityClassRegistry() {
        final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");
        ctx.entityClassRegistry().markVehicle(7);
        ctx.entityClassRegistry().markAvatar(900);
        final EntityClass v7 = ctx.entityClassRegistry().resolve(7);
        final EntityClass a900 = ctx.entityClassRegistry().resolve(900);
        final EntityClass u999 = ctx.entityClassRegistry().resolve(999);

        // method4 2B 在未分类 entity 999 上 → UnknownReplayEvent，且不得把 999 标记为任意类。
        decoder.decode(ctx, methodPacketOn(1, 999, EntityMethodDecoder.SUBTYPE_ROUND_FINISHED,
                new byte[]{2, 1}));
        // method29 在未分类 entity 999 上 → Unknown，不得自证 Avatar。
        decoder.decode(ctx, methodPacketOn(1, 999, EntityMethodDecoder.SUBTYPE_PROJECTILE_LAUNCH,
                new byte[37]));
        assertEquals(v7, ctx.entityClassRegistry().resolve(7), "decode 不得改动已分类 Vehicle");
        assertEquals(a900, ctx.entityClassRegistry().resolve(900), "decode 不得改动已分类 Avatar");
        assertEquals(u999, ctx.entityClassRegistry().resolve(999), "未分类 entity 不得被 method decode 自证 class");
    }

    /** subtype48 载荷（指定 entityId）：body[0..3] 固定字段 + varint(wrapperFieldNumber) + msgLen + protoData。 */
    private static RawReplayPacket rawPacket48For(final long wrapperFieldNumber, final byte[] root, final int entityId) {
        final byte[] payload = new byte[8 + 4 + 1 + 1 + root.length];
        putU32(payload, 0, entityId);
        payload[4] = EntityMethodDecoder.SUBTYPE_UPDATE_ARENA2;
        putU32(payload, 8, payload.length - 12);
        payload[12] = (byte) wrapperFieldNumber;
        payload[13] = (byte) root.length;
        System.arraycopy(root, 0, payload, 14, root.length);
        return new RawReplayPacket(7, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 56.233f, payload, 0);
    }

    /** subtype48 载荷：body[0..3] 固定字段 + varint(wrapperFieldNumber) + msgLen + protoData（root 直接放入）。 */
    private static RawReplayPacket rawPacket48(final long wrapperFieldNumber, final byte[] root) {
        final byte[] payload = new byte[8 + 4 + 1 + 1 + root.length];
        payload[4] = EntityMethodDecoder.SUBTYPE_UPDATE_ARENA2;
        putU32(payload, 8, payload.length - 12);
        payload[12] = (byte) wrapperFieldNumber;
        payload[13] = (byte) root.length;
        System.arraycopy(root, 0, payload, 14, root.length);
        return new RawReplayPacket(7, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 56.233f, payload, 0);
    }
}
