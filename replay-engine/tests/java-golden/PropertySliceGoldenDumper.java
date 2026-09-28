import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.EntityPropertyDecoder;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayDecodeResult;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Java oracle for exactly EntityPropertyDecoder, preserving unsupported packets. */
public final class PropertySliceGoldenDumper {
    private static final long OFFSET = 0xcbf29ce484222325L;
    private static final long PRIME = 0x100000001b3L;

    public static void main(final String[] args) throws Exception {
        final Path dir = Path.of(args[0]);
        final List<String> names = List.of("random-battle-example.wotbreplay",
                "cw-training-15-14-example.wotbreplay", "tournament-14-14-example.wotbreplay");
        System.out.println("{\"decoders\":[\"EntityPropertyDecoder\"],\"fixtures\":[");
        for (int n = 0; n < names.size(); n++) {
            final String name = names.get(n);
            final byte[] archive = Files.readAllBytes(dir.resolve(name));
            final byte[] stream = ReplayArchiveReader.read(archive).get("data.wotreplay");
            final List<RawReplayPacket> packets = ReplayPacketStreamReader.read(stream).packets();
            final ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
            registry.register(new EntityPropertyDecoder());
            final ReplayDecodeContext context = new ReplayDecodeContext();
            long digest = OFFSET, blockDigest = OFFSET;
            int blockCount = 0, health = 0, turret = 0, unknown = 0, partial = 0;
            final List<String> blocks = new ArrayList<>(), samples = new ArrayList<>();
            for (final RawReplayPacket packet : packets) {
                final ReplayDecodeResult result = registry.decode(context, packet);
                final String event;
                if (result.events().isEmpty()) {
                    event = "none";
                } else if (result.events().getFirst() instanceof HealthChangedEvent h) {
                    event = "health:" + h.entityId() + ":" + nullable(h.currentHealth()) + ":"
                            + nullable(h.alive()) + ":" + h.rawCurrentHealth() + ":" + h.rawState()
                            + ":" + h.confidence();
                    health++;
                } else if (result.events().getFirst() instanceof TurretDirectionChangedEvent t) {
                    event = "turret:" + t.entityId() + ":"
                            + Long.toUnsignedString(Double.doubleToRawLongBits(t.turretRelativeYawDeg()));
                    turret++;
                } else if (result.events().getFirst() instanceof UnknownReplayEvent u) {
                    event = "unknown:" + u.reasonCode();
                    unknown++;
                } else {
                    throw new IllegalStateException("unexpected event: " + result.events().getFirst());
                }
                if (result.status().name().equals("PARTIAL")) partial++;
                final String row = packet.sequence() + "|" + Integer.toUnsignedLong(packet.type()) + "|"
                        + Integer.toUnsignedLong(Float.floatToRawIntBits(packet.rawClockSec())) + "|"
                        + packet.payloadLength() + "|" + result.status() + "|" + event + "|"
                        + result.warnings().stream().map(w -> w.code()).toList() + "\n";
                for (final byte b : row.getBytes(StandardCharsets.UTF_8)) {
                    digest = (digest ^ (b & 0xff)) * PRIME;
                    blockDigest = (blockDigest ^ (b & 0xff)) * PRIME;
                }
                if (++blockCount == 1000) {
                    blocks.add(Long.toUnsignedString(blockDigest, 16));
                    blockDigest = OFFSET;
                    blockCount = 0;
                }
                if (packet.sequence() < 64 || packet.sequence() >= packets.size() - 16
                        || packet.sequence() % 2000 == 0) samples.add(row.stripTrailing());
            }
            if (blockCount > 0) blocks.add(Long.toUnsignedString(blockDigest, 16));
            System.out.print("{\"name\":\"" + name + "\",\"packetCount\":" + packets.size()
                    + ",\"health\":" + health + ",\"turret\":" + turret
                    + ",\"unknown\":" + unknown + ",\"partial\":" + partial
                    + ",\"digest\":\"" + Long.toUnsignedString(digest, 16)
                    + "\",\"blockDigests\":[\"" + String.join("\",\"", blocks)
                    + "\"],\"samples\":[\"" + String.join("\",\"", samples) + "\"]}");
            System.out.println(n + 1 == names.size() ? "" : ",");
        }
        System.out.println("]}");
    }

    private static String nullable(final Object value) {
        return value == null ? "null" : value.toString();
    }
}
