package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

class EntityPropertyDecoderTest {

    private final EntityPropertyDecoder decoder = new EntityPropertyDecoder();
    private final ReplayDecodeContext context = new ReplayDecodeContext("11.19.0_china");

    private static RawReplayPacket packet(final int propId, final byte[] value) {
        final byte[] payload = new byte[12 + value.length];
        putU32(payload, 0, 12_345);
        putU32(payload, 4, propId);
        putU32(payload, 8, value.length);
        System.arraycopy(value, 0, payload, 12, value.length);
        return new RawReplayPacket(
                1, 0, payload.length, EntityPropertyDecoder.TYPE_ENTITY_PROPERTY,
                10.0f, payload, 0);
    }

    @Test
    void propId3DecodesCurrentHpAsLeU16() {
        final byte[] value = {(byte) 0x96, 0x0b};
        final ReplayDecodeResult result = decoder.decode(context, packet(3, value));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        final HealthChangedEvent event = assertInstanceOf(
                HealthChangedEvent.class, result.events().getFirst());
        assertEquals(12_345, event.entityId());
        assertEquals(2966, event.currentHealth());
        assertEquals(Boolean.TRUE, event.alive());
        assertEquals(DecodeConfidence.EXACT, event.confidence());
    }

    @Test
    void propId3ZeroMeansDestroyed() {
        final byte[] value = {0x00, 0x00};
        final ReplayDecodeResult result = decoder.decode(context, packet(3, value));
        final HealthChangedEvent event = assertInstanceOf(
                HealthChangedEvent.class, result.events().getFirst());
        assertEquals(0, event.currentHealth());
        assertEquals(Boolean.FALSE, event.alive());
        assertEquals(HpRawState.HP_ZERO_TERMINAL, event.rawState());
    }

    @Test
    void propId2DecodesTurretRelativeYawDeg() {
        final ReplayDecodeResult zero = decoder.decode(context, packet(2, new byte[]{0x00, 0x00}));
        assertEquals(DecodeStatus.SUCCESS, zero.status());
        final TurretDirectionChangedEvent e0 = assertInstanceOf(
                TurretDirectionChangedEvent.class, zero.events().getFirst());
        assertEquals(-180.0, e0.turretRelativeYawDeg(), 1e-6);
        assertEquals(DecodeConfidence.EXACT, e0.confidence());

        final TurretDirectionChangedEvent eMid = assertInstanceOf(
                TurretDirectionChangedEvent.class,
                decoder.decode(context, packet(2, new byte[]{0x00, (byte) 0x80}))
                        .events().getFirst());
        assertEquals(0.0, eMid.turretRelativeYawDeg(), 1e-6);

        final TurretDirectionChangedEvent eMax = assertInstanceOf(
                TurretDirectionChangedEvent.class,
                decoder.decode(context, packet(2, new byte[]{(byte) 0xff, (byte) 0xff}))
                        .events().getFirst());
        assertEquals(65535 * 360.0 / 65536.0 - 180.0, eMax.turretRelativeYawDeg(), 1e-6);
        assertEquals(12_345, eMax.entityId());
    }

    /**
     * PR162 forward compatibility: an ordinary positive HP is a structural value decodable for a future
     * version, while the special sentinels (0xFFFE / 0xFFFD) are version-scoped closed semantics that a
     * future version must NOT inherit → raw/UNKNOWN, never terminal.
     */
    @Test
    void futureVersionDecodesStructuralHpButNotSpecialSentinel() {
        final ReplayDecodeContext future = new ReplayDecodeContext("11.22.0_china");
        // ordinary positive HP → EXACT CURRENT_HP
        final ReplayDecodeResult hp = decoder.decode(future, packet(3, new byte[]{(byte) 0x96, 0x0b}));
        final HealthChangedEvent hpEvent = assertInstanceOf(HealthChangedEvent.class, hp.events().getFirst());
        assertEquals(2966, hpEvent.currentHealth());
        assertEquals(HpRawState.CURRENT_HP, hpEvent.rawState());
        assertEquals(DecodeConfidence.EXACT, hpEvent.confidence(), "普通正 HP 结构值保留 EXACT");
        // 0xFFFE special sentinel → must NOT inherit 11.19 terminal meaning
        final ReplayDecodeResult fffe = decoder.decode(future, packet(3, new byte[]{(byte) 0xFE, (byte) 0xFF}));
        final HealthChangedEvent fffeEvent = assertInstanceOf(HealthChangedEvent.class, fffe.events().getFirst());
        assertEquals(HpRawState.UNKNOWN_OTHER, fffeEvent.rawState(), "未认证特殊 sentinel 不得继承 terminal");
        assertEquals(DecodeConfidence.PARTIAL, fffeEvent.confidence());
        // 0xFFFD special sentinel → likewise raw/UNKNOWN
        final ReplayDecodeResult fffd = decoder.decode(future, packet(3, new byte[]{(byte) 0xFD, (byte) 0xFF}));
        final HealthChangedEvent fffdEvent = assertInstanceOf(HealthChangedEvent.class, fffd.events().getFirst());
        assertEquals(HpRawState.UNKNOWN_OTHER, fffdEvent.rawState());
    }

    @Test
    void propId2WrongValueLenStaysUnknown() {
        final ReplayDecodeResult result = decoder.decode(context, packet(2, new byte[]{0x01}));
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertInstanceOf(UnknownReplayEvent.class, result.events().getFirst());
    }

    /** PR162/P0-2：prop2 turret-yaw 语义由 PROP_TURRET_YAW 授权；future prop2 不得继承 turret semantic。 */
    @Test
    void prop2TurretYawIsCapabilityGated() {
        final byte[] yaw = new byte[]{0x00, 0x00};
        // 11.19 + 11.18（有独立 evidence）→ TurretDirectionChangedEvent EXACT
        final TurretDirectionChangedEvent e19 = assertInstanceOf(TurretDirectionChangedEvent.class,
                decoder.decode(new ReplayDecodeContext("11.19.0_china"), packet(2, yaw)).events().getFirst());
        assertEquals(DecodeConfidence.EXACT, e19.confidence());
        assertInstanceOf(TurretDirectionChangedEvent.class,
                decoder.decode(new ReplayDecodeContext("11.18.0_china_apple"), packet(2, yaw)).events().getFirst());
        // future 11.22 prop2 2B → 禁止产出 turret semantic（raw-preserve UnknownReplayEvent）
        final ReplayDecodeResult future = decoder.decode(new ReplayDecodeContext("11.22.0_china"), packet(2, yaw));
        assertInstanceOf(UnknownReplayEvent.class, future.events().getFirst(),
                "future prop2 不得自动产出 TurretDirectionChangedEvent");
        assertFalse(future.events().stream().anyMatch(TurretDirectionChangedEvent.class::isInstance));
    }

    @Test
    void unknownPropIdStaysUnknownEvent() {
        final byte[] value = {(byte) 0xff, (byte) 0xff};
        final ReplayDecodeResult result = decoder.decode(context, packet(5, value));
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertInstanceOf(UnknownReplayEvent.class, result.events().getFirst());
    }

    @Test
    void propId3FdFfDeathSentinelPreservesTerminalWithoutInventingHpZero() {
        final byte[] value = {(byte) 0xfd, (byte) 0xff};
        final ReplayDecodeResult result = decoder.decode(context, packet(3, value));
        final HealthChangedEvent event = assertInstanceOf(
                HealthChangedEvent.class, result.events().getFirst());
        assertNull(event.currentHealth(), "0xFFFD is terminal state, not observed HP=0");
        assertEquals(Boolean.FALSE, event.alive());
        assertEquals(0xFFFD, event.rawCurrentHealth());
        assertEquals(HpRawState.DEATH_TERMINAL_FFFD, event.rawState());
        assertEquals(DecodeConfidence.EXACT, event.confidence());
    }

    @Test
    void propId3FfFfUnknownSentinelIsNullNot65535() {
        final byte[] value = {(byte) 0xff, (byte) 0xff};
        final ReplayDecodeResult result = decoder.decode(context, packet(3, value));
        final HealthChangedEvent event = assertInstanceOf(
                HealthChangedEvent.class, result.events().getFirst());
        assertNull(event.currentHealth());
        assertNull(event.alive());
        assertEquals(HpRawState.UNKNOWN_FFFF, event.rawState());
        assertEquals(DecodeConfidence.PARTIAL, event.confidence());
    }

    private static void putU32(final byte[] buf, final int i, final int v) {
        buf[i] = (byte) v;
        buf[i + 1] = (byte) (v >>> 8);
        buf[i + 2] = (byte) (v >>> 16);
        buf[i + 3] = (byte) (v >>> 24);
    }
}
