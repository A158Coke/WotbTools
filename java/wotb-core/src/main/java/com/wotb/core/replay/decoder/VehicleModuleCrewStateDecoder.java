package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.event.VehicleModuleCrewStateEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/** Specialized Avatar method16 decoder; registered before the generic Type8 decoder. */
public final class VehicleModuleCrewStateDecoder implements ReplayPacketDecoder {

    private static final int TYPE_ENTITY_METHOD = 8;
    private static final int METHOD_ID = 16;
    private static final int ARG_LEN = 10;

    @Override
    public boolean supports(final ReplayDecodeContext context, final RawReplayPacket packet) {
        if (packet.type() != TYPE_ENTITY_METHOD) {
            return false;
        }
        final byte[] payload = packet.payload();
        return payload.length >= 8 && readU32LE(payload, 4) == METHOD_ID;
    }

    @Override
    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        if (payload.length < 12) {
            return malformed(packet, ts, payload.length, "METHOD16_ENVELOPE_TRUNCATED");
        }
        final int avatarEntityId = readI32LE(payload, 0);
        // PR162/P0-1 entity-class scoping：method16 是 Avatar 系方法，class 只由独立生命周期/身份证据
        //（prepass）建立。class != AVATAR（含 UNKNOWN/VEHICLE/OTHER）→ raw-preserve，不得借用 Avatar 语义，
        // 也绝不在此由 method16 自证 class。
        final EntityClass entityClass = context.entityClassRegistry().resolve(avatarEntityId);
        if (entityClass != EntityClass.AVATAR) {
            return new ReplayDecodeResult(DecodeStatus.PARTIAL,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "METHOD16_CLASS_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("ENTITY_CLASS_MISMATCH",
                            "Avatar method16 on non-Avatar entity " + avatarEntityId
                                    + " (class=" + entityClass + ")")));
        }
        if (payload.length < 12) {
            return malformed(packet, ts, payload.length, "METHOD16_ENVELOPE_TRUNCATED");
        }
        final int argLen = readU32LE(payload, 8);
        if (argLen != ARG_LEN || payload.length != 12 + ARG_LEN) {
            return malformed(packet, ts, payload.length, "METHOD16_LAYOUT_MISMATCH");
        }
        final int vehicleId = readI32LE(payload, 12);
        final int stateCode = payload[16] & 0xFF;
        final int componentCode = payload[17] & 0xFF;
        final int relatedEntityId = readI32LE(payload, 18);
        final VehicleModuleCrewStateEvent.Component component =
                VehicleModuleCrewStateEvent.componentOf(componentCode);
        final VehicleModuleCrewStateEvent.State state =
                VehicleModuleCrewStateEvent.stateOf(stateCode, component);
        final DecodeConfidence confidence = component == VehicleModuleCrewStateEvent.Component.UNKNOWN
                || state == VehicleModuleCrewStateEvent.State.UNKNOWN
                ? DecodeConfidence.PARTIAL : DecodeConfidence.EXACT;
        final VehicleModuleCrewStateEvent event = new VehicleModuleCrewStateEvent(
                packet.sequence(), ts, packet.type(), confidence,
                avatarEntityId, vehicleId, stateCode, componentCode, relatedEntityId,
                component, state);
        return new ReplayDecodeResult(
                confidence == DecodeConfidence.EXACT ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL,
                List.of(event), List.of());
    }

    private static ReplayDecodeResult malformed(
            final RawReplayPacket packet,
            final ReplayTimestamp ts,
            final int payloadLength,
            final String reason) {
        return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payloadLength,
                        reason, DecodeConfidence.UNKNOWN)),
                List.of(new ReplayDecodeWarning(reason, reason)));
    }

    private static int readI32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return readI32LE(buf, i);
    }
}
