import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.*;
import com.wotb.core.replay.event.*;
import com.wotb.core.replay.stream.*;
import java.nio.file.*;
import java.util.*;

/** Oracle for the Type31/Type39-only registry, in Java default relative order. */
public final class AimMarkerSliceGoldenDumper {
    public static void main(String[] args) throws Exception {
        var names = List.of("random-battle-example.wotbreplay", "cw-training-15-14-example.wotbreplay", "tournament-14-14-example.wotbreplay");
        System.out.print("{\"decoders\":[\"GunMarkerSizeDecoder\",\"AimRayStateDecoder\"],\"fixtures\":[");
        for (int n = 0; n < names.size(); n++) {
            if (n > 0) System.out.print(",");
            var stream = ReplayArchiveReader.read(Files.readAllBytes(Path.of(args[0], names.get(n)))).get("data.wotreplay");
            var packets = ReplayPacketStreamReader.read(stream).packets();
            var registry = new ReplayPacketDecoderRegistry();
            registry.register(new GunMarkerSizeDecoder());
            registry.register(new AimRayStateDecoder());
            var rows = new ArrayList<String>();
            for (var packet : packets) {
                if (packet.type() != 31 && packet.type() != 39) continue;
                rows.add(row(registry.decode(new ReplayDecodeContext(), packet)));
            }
            System.out.print("{\"name\":\"" + names.get(n) + "\",\"packetCount\":" + packets.size() + ",\"rows\":[");
            for (int i = 0; i < rows.size(); i++) {
                if (i > 0) System.out.print(",");
                System.out.print("\"" + rows.get(i) + "\"");
            }
            System.out.print("]}");
        }
        System.out.print("],\"synthetic\":[");
        int[] types = {31, 31, 39, 39, 39};
        byte[][] bodies = {new byte[0], le(0x7fc00001), new byte[0], concat(le(0), le(0), le(0x7f800000), le(0), le(0), le(0), le(0)), concat(le(0), le(0), le(0), le(0), le(0), le(0), le(0x7fc00001))};
        for (int i = 0; i < types.length; i++) {
            if (i > 0) System.out.print(",");
            var registry = new ReplayPacketDecoderRegistry();
            registry.register(new GunMarkerSizeDecoder());
            registry.register(new AimRayStateDecoder());
            var packet = new RawReplayPacket(i, 0, bodies[i].length, types[i], 1.25f, bodies[i], 0);
            var result = registry.decode(new ReplayDecodeContext(), packet);
            var event = (UnknownReplayEvent) result.events().getFirst();
            var warning = result.warnings().getFirst();
            System.out.print("{\"type\":" + types[i] + ",\"hex\":\"" + HexFormat.of().formatHex(bodies[i]) + "\",\"status\":\"" + result.status() + "\",\"reason\":\"" + event.reasonCode() + "\",\"warningCode\":\"" + warning.code() + "\",\"warningMessage\":\"" + warning.message() + "\"}");
        }
        System.out.println("]}");
    }
    private static String row(ReplayDecodeResult result) {
        var event = result.events().getFirst();
        if (event instanceof GunMarkerSizeEvent value) return value.sequence() + "|31|SUCCESS|" + Integer.toUnsignedString(Float.floatToRawIntBits(value.markerSizeRaw()));
        if (event instanceof AimRayStateEvent value) {
            float[] f = {value.worldYawDeg(), value.storedNegatedWorldPitchDeg(), value.aimRayPointX(), value.aimRayPointY(), value.aimRayPointZ(), value.relativeYawFamilyRawRad(), value.verticalStateFamilyRawRad()};
            var out = new StringBuilder(value.sequence() + "|39|SUCCESS");
            for (float v : f) out.append('|').append(Integer.toUnsignedString(Float.floatToRawIntBits(v)));
            return out.toString();
        }
        var unknown = (UnknownReplayEvent) event;
        return unknown.sequence() + "|" + unknown.packetType() + "|" + result.status() + "|" + unknown.reasonCode();
    }
    private static byte[] le(int bits) { return new byte[]{(byte) bits, (byte)(bits >>> 8), (byte)(bits >>> 16), (byte)(bits >>> 24)}; }
    private static byte[] concat(byte[]... chunks) {
        byte[] out = new byte[chunks.length * 4];
        for (int i = 0; i < chunks.length; i++) System.arraycopy(chunks[i], 0, out, i * 4, 4);
        return out;
    }
}
