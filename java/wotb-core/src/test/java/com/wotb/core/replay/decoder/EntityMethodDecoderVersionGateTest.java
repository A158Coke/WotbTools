package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * EntityMethod version-scoped gating regressions (P0-1 method1 HP classification +
 * P1 current-version semantic method gating for subtype 8/47/48).
 *
 * <p>Versions:
 * <ul>
 *   <li><b>11.19.0_china</b>: current canonical family — 0xFFFE is VERIFIED_TERMINAL_FFFE,
 *       cause semantics PROVEN.</li>
 *   <li><b>11.18.0_china</b>: only the layout is proved — 0xFFFE stays UNKNOWN (not terminal),
 *       cause semantics are UNKNOWN (raw causeFlag preserved).</li>
 *   <li><b>11.20.0_china</b> (future): raw-preserve — no current-version semantic event.</li>
 * </ul>
 */
class EntityMethodDecoderVersionGateTest {

    private final EntityMethodDecoder decoder = new EntityMethodDecoder();

    /** method1 是 Vehicle 系方法：class 需先由独立生命周期/物化证据建立（P0-1），此处预标记 Vehicle(10)。 */
    private static ReplayDecodeContext vehicleCtx(final String version) {
        final ReplayDecodeContext c = new ReplayDecodeContext(version);
        c.entityClassRegistry().markVehicle(10);
        return c;
    }

    /** method1 packet: entityId + subtype(=1) + argLen(=7) + currentHpRaw(u16) + source(u32) + causeFlag(u8). */
    private static RawReplayPacket method1(final int seq, final float clock,
                                           final int currentHpRaw, final int causeFlag) {
        final byte[] payload = new byte[19];
        putU32(payload, 0, 10);
        putU32(payload, 4, EntityMethodDecoder.SUBTYPE_VEHICLE_HEALTH_STATE);
        putU32(payload, 8, 7);
        putU16(payload, 12, currentHpRaw);
        putU32(payload, 14, 20);
        payload[18] = (byte) causeFlag;
        return new RawReplayPacket(seq, 0, payload.length, EntityMethodDecoder.TYPE_ENTITY_METHOD,
                clock, payload, 0);
    }

    private static RawReplayPacket method(final int seq, final int subtype) {
        final byte[] payload = new byte[33];
        putU32(payload, 0, 10);
        putU32(payload, 4, subtype);
        putU32(payload, 8, 21);
        return new RawReplayPacket(seq, 0, payload.length, EntityMethodDecoder.TYPE_ENTITY_METHOD,
                1f, payload, 0);
    }

    @Test
    void currentVersionFffeIsVerifiedTerminal() {
        // 11.19: 0xFFFE is a verified terminal on the current-version chain.
        final ReplayDecodeResult r = decoder.decode(vehicleCtx("11.19.0_china_apple"),
                method1(1, 1f, 0xFFFE, 0));
        final VehicleHealthStateEvent e = assertInstanceOf(VehicleHealthStateEvent.class, r.events().get(0));
        assertEquals(HpRawState.VERIFIED_TERMINAL_FFFE, e.rawState());
    }

    @Test
    void legacyVersionFffeStaysUnknown() {
        // 11.18: only the layout is proved; 0xFFFE must NOT be upgraded to a terminal.
        final ReplayDecodeResult r = decoder.decode(vehicleCtx("11.18.0_china"),
                method1(1, 1f, 0xFFFE, 0));
        final VehicleHealthStateEvent e = assertInstanceOf(VehicleHealthStateEvent.class, r.events().get(0));
        assertEquals(HpRawState.UNKNOWN_OTHER, e.rawState(), "11.18 must not treat 0xFFFE as a verified terminal");
        assertEquals(DecodeConfidence.EXACT, e.confidence(),
                "layout still decodes EXACT even though the terminal classification is version-gated");
    }

    @Test
    void legacyVersionCauseSemanticsUnknown() {
        // 11.18 proves layout only — cause semantics are UNKNOWN (raw causeFlag preserved).
        final ReplayDecodeResult r = decoder.decode(vehicleCtx("11.18.0_china"),
                method1(1, 1f, 2700, 5));
        final VehicleHealthStateEvent e = assertInstanceOf(VehicleHealthStateEvent.class, r.events().get(0));
        assertEquals(VehicleHealthStateEvent.Cause.UNKNOWN, e.cause(),
                "11.18 only proves layout; cause semantics must be UNKNOWN");
        assertEquals(5, e.causeFlag(), "raw causeFlag preserved");
    }

    @Test
    void currentVersionCauseSemanticsProven() {
        final ReplayDecodeResult r = decoder.decode(vehicleCtx("11.19.0_china"),
                method1(1, 1f, 2700, 5));
        final VehicleHealthStateEvent e = assertInstanceOf(VehicleHealthStateEvent.class, r.events().get(0));
        assertEquals(VehicleHealthStateEvent.Cause.DROWNING, e.cause());
    }

    @Test
    void futureVersionMethod1SemanticNotCertifiedRawPreserves() {
        // PR162/P0-2: future version 只有 Type8 envelope 结构可前向读取；method1 的 numeric identity 与
        // HP/cause 语义是 closed/version-scoped —— 未认证即 raw-preserve（UnknownReplayEvent），
        // 绝不产出 VehicleHealthStateEvent(EXACT) 继承当前版本语义。
        final ReplayDecodeResult r = decoder.decode(vehicleCtx("11.20.0_china"),
                method1(1, 1f, 2700, 0));
        assertInstanceOf(UnknownReplayEvent.class, r.events().get(0));
        assertTrue(r.events().stream().noneMatch(e -> e.getClass().isAssignableFrom(VehicleHealthStateEvent.class)
                        || e instanceof VehicleHealthStateEvent),
                "future method1 不得产出 VehicleHealthStateEvent");
    }

    @Test
    void futureVersionDoesNotProduceDamageEvent() {
        // P1: subtype 8 is a current-version semantic — future version raw-preserves, never DamageEvent.
        final ReplayDecodeResult r = decoder.decode(new ReplayDecodeContext("11.20.0_china"),
                method(1, EntityMethodDecoder.SUBTYPE_ENTITY_METHOD_DAMAGE));
        final UnknownReplayEvent u = assertInstanceOf(UnknownReplayEvent.class, r.events().get(0));
        assertEquals("VERSION_UNSUPPORTED_METHOD8", u.reasonCode());
        assertEquals(DecodeConfidence.UNKNOWN, u.confidence());
        assertTrue(r.events().stream().noneMatch(e -> e.getClass().getName().contains("DamageEvent")));
    }

    @Test
    void futureVersionDoesNotProduceParticipantMapping() {
        // P1: subtype 48 is a current-version semantic — future version raw-preserves.
        final ReplayDecodeResult r = decoder.decode(new ReplayDecodeContext("11.20.0_china"),
                method(1, EntityMethodDecoder.SUBTYPE_UPDATE_ARENA2));
        final UnknownReplayEvent u = assertInstanceOf(UnknownReplayEvent.class, r.events().get(0));
        assertEquals("VERSION_UNSUPPORTED_METHOD48", u.reasonCode());
        assertFalse(r.events().stream().anyMatch(e -> e.getClass().getName().contains("ParticipantMappingEvent")));
        assertFalse(r.events().stream().anyMatch(e -> e.getClass().getName().contains("SupremacyPoints")));
    }

    private static void putU32(final byte[] b, final int i, final int v) {
        b[i] = (byte) (v & 0xFF);
        b[i + 1] = (byte) ((v >> 8) & 0xFF);
        b[i + 2] = (byte) ((v >> 16) & 0xFF);
        b[i + 3] = (byte) ((v >> 24) & 0xFF);
    }

    private static void putU16(final byte[] b, final int i, final int v) {
        b[i] = (byte) (v & 0xFF);
        b[i + 1] = (byte) ((v >> 8) & 0xFF);
    }
}
