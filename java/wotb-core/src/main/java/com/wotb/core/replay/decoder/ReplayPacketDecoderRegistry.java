package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

/** Decoder registry for raw replay packets. */
public class ReplayPacketDecoderRegistry {

    private final List<ReplayPacketDecoder> decoders = new ArrayList<>();

    public static ReplayPacketDecoderRegistry createDefault() {
        final ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
        registry.register(new PositionDecoder());
        // Specialized Type8 methods must precede the generic EntityMethod decoder.
        registry.register(new VehicleModuleCrewStateDecoder());
        registry.register(new EntityMethodDecoder());
        registry.register(new EntityLeaveDecoder());
        registry.register(new BattleEndDecoder());
        registry.register(new EntityCreateDecoder());
        registry.register(new MaterializationAnnouncedDecoder());
        registry.register(new MaterializationDecoder());
        registry.register(new AmmunitionSelectionDecoder());
        registry.register(new EntityPropertyDecoder());
        registry.register(new GunMarkerSizeDecoder());
        registry.register(new AimRayStateDecoder());
        registry.register(new PlaceholderDecoder(35));
        return registry;
    }

    public void register(final ReplayPacketDecoder decoder) {
        decoders.add(decoder);
    }

    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        for (final ReplayPacketDecoder decoder : decoders) {
            if (decoder.supports(context, packet)) {
                return decoder.decode(context, packet);
            }
        }
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        final UnknownReplayEvent unknown = new UnknownReplayEvent(
                packet.sequence(), ts, packet.type(),
                packet.payloadLength(), "UNSUPPORTED_TYPE", DecodeConfidence.UNKNOWN);
        return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                List.of(unknown), List.of());
    }

    public List<ReplayPacketDecoder> getDecoders() {
        return List.copyOf(decoders);
    }
}
