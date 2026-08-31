package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

/** Vehicle Type7 EntityProperty decoder with explicit version capability boundaries. */
public class EntityPropertyDecoder implements ReplayPacketDecoder {

    static final int TYPE_ENTITY_PROPERTY = 7;
    static final int PROP_TURRET_RELATIVE_YAW = 2;
    static final int PROP_CURRENT_HP = 3;
    static final double TURRET_YAW_SCALE_DEG = 360.0 / 65536.0;
    static final double TURRET_YAW_OFFSET_DEG = -180.0;

    @Override
    public boolean supports(final ReplayDecodeContext context, final RawReplayPacket packet) {
        return packet.type() == TYPE_ENTITY_PROPERTY;
    }

    @Override
    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        if (!ReplayProtocolProfile.basicVehiclePropertiesAllowed(context.clientVersion())) {
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "VERSION_UNSUPPORTED_ENTITY_PROPERTY", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "EntityProperty numeric semantics not affirmed for client version: "
                                    + context.clientVersion())));
        }
        if (payload.length < 12) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "EntityProperty packet too short: " + payload.length)));
        }

        final int entityId = readI32LE(payload, 0);
        final int propId = readU32LE(payload, 4);
        final int valueLen = readU32LE(payload, 8);
        if (valueLen < 0 || 12 + valueLen != payload.length) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "ENTITY_PROPERTY_LENGTH_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("PROPERTY_VALUE_LENGTH_MISMATCH",
                            "EntityProperty valueLen=" + valueLen + " payload=" + payload.length
                                    + " entity=" + entityId)));
        }

        if (propId == PROP_CURRENT_HP && valueLen == 2) {
            final int raw = readU16LE(payload, 12);
            final HpRawState rawState = HpRawState.classify(raw,
                    ReplayProtocolProfile.levelOf(context.clientVersion(),
                            ReplayProtocolProfile.Capability.TERMINAL_FFFD)
                            == ReplayProtocolProfile.Level.VERIFIED,
                    ReplayProtocolProfile.verifiedFffeTerminalAllowed(context.clientVersion()));
            final List<ReplayDecodeWarning> warnings = new ArrayList<>();
            final HealthChangedEvent event;
            switch (rawState) {
                case CURRENT_HP -> {
                    final int hp = (short) raw;
                    event = new HealthChangedEvent(packet.sequence(), ts, packet.type(),
                            DecodeConfidence.EXACT, entityId, hp, null, true, raw, rawState);
                }
                case HP_ZERO_TERMINAL ->
                        event = new HealthChangedEvent(packet.sequence(), ts, packet.type(),
                                DecodeConfidence.EXACT, entityId, 0, null, false, raw, rawState);
                case DEATH_TERMINAL_FFFD, VERIFIED_TERMINAL_FFFE ->
                        // terminal != HP-zero: preserve terminal truth without inventing current HP=0.
                        event = new HealthChangedEvent(packet.sequence(), ts, packet.type(),
                                DecodeConfidence.EXACT, entityId, null, null, false, raw, rawState);
                case UNKNOWN_FFFF, UNKNOWN_OTHER -> {
                    warnings.add(new ReplayDecodeWarning("HP_SENTINEL_UNKNOWN",
                            "prop3 raw=0x" + Integer.toHexString(raw)
                                    + " preserved as UNKNOWN at entity " + entityId));
                    event = new HealthChangedEvent(packet.sequence(), ts, packet.type(),
                            DecodeConfidence.PARTIAL, entityId, null, null, null, raw, rawState);
                }
                default -> throw new IllegalStateException("Unhandled HP state: " + rawState);
            }
            return new ReplayDecodeResult(
                    warnings.isEmpty() ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL,
                    List.of(event), warnings);
        }

        // PR162/P0-2：prop2 turret-relative yaw 语义必须由 PROP_TURRET_YAW capability 授权（不是 generic
        // ENTITY_PROPERTY_ENVELOPE）。future 版本 prop2 只 raw-preserve，绝不自动产出 TurretDirectionChangedEvent。
        if (propId == PROP_TURRET_RELATIVE_YAW && valueLen == 2
                && ReplayProtocolProfile.turretYawAllowed(context.clientVersion())) {
            final int raw = readU16LE(payload, 12);
            final double deg = raw * TURRET_YAW_SCALE_DEG + TURRET_YAW_OFFSET_DEG;
            return ReplayDecodeResult.of(new TurretDirectionChangedEvent(
                    packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT, entityId, deg));
        }

        return new ReplayDecodeResult(DecodeStatus.PARTIAL,
                List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                        "ENTITY_PROPERTY_prop" + propId + "_len" + valueLen,
                        DecodeConfidence.UNKNOWN)),
                List.of());
    }

    private static int readI32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    private static int readU16LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }
}
