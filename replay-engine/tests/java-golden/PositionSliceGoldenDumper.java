import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.PositionDecoder;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayDecodeResult;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.event.AttachedTransformEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Java oracle with exactly one decoder registered: PositionDecoder. */
public final class PositionSliceGoldenDumper {
    private static final long OFFSET = 0xcbf29ce484222325L;
    private static final long PRIME = 0x100000001b3L;
    private static final int BLOCK_SIZE = 1000;

    public static void main(final String[] args) throws Exception {
        final Path dir = Path.of(args[0]);
        final List<String> names = List.of("random-battle-example.wotbreplay",
                "cw-training-15-14-example.wotbreplay", "tournament-14-14-example.wotbreplay");
        System.out.println("{\"decoders\":[\"PositionDecoder\"],\"fixtures\":[");
        for (int n = 0; n < names.size(); n++) {
            final String name = names.get(n);
            final byte[] archive = Files.readAllBytes(dir.resolve(name));
            final byte[] stream = ReplayArchiveReader.read(archive).get("data.wotreplay");
            final List<RawReplayPacket> packets = ReplayPacketStreamReader.read(stream).packets();
            final ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
            registry.register(new PositionDecoder());
            final ReplayDecodeContext context = new ReplayDecodeContext();
            long digest = OFFSET;
            long blockDigest = OFFSET;
            int blockCount = 0;
            final List<String> blockDigests = new ArrayList<>();
            final List<String> samples = new ArrayList<>();
            int world = 0, attached = 0, unsupported = 0, partial = 0;
            for (final RawReplayPacket packet : packets) {
                final ReplayDecodeResult result = registry.decode(context, packet);
                final String event;
                if (result.events().getFirst() instanceof PositionChangedEvent p) {
                    event = "world:" + fields(p.entityId(), p.spaceId(), p.attachmentParentEntityId(),
                            p.x(), p.y(), p.z(), p.positionErrorX(), p.positionErrorY(), p.positionErrorZ(),
                            p.yaw(), p.pitch(), p.roll(), p.trailingStateRaw());
                    world++;
                } else if (result.events().getFirst() instanceof AttachedTransformEvent p) {
                    event = "attached:" + fields(p.entityId(), p.spaceId(), p.attachmentParentEntityId(),
                            p.localX(), p.localY(), p.localZ(), p.positionErrorX(), p.positionErrorY(), p.positionErrorZ(),
                            p.yaw(), p.pitch(), p.roll(), p.trailingStateRaw());
                    attached++;
                } else if (result.events().getFirst() instanceof UnknownReplayEvent unknown) {
                    event = "unknown:" + unknown.reasonCode();
                    unsupported++;
                } else {
                    throw new IllegalStateException("unexpected event type");
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
                if (++blockCount == BLOCK_SIZE) {
                    blockDigests.add(Long.toUnsignedString(blockDigest, 16));
                    blockDigest = OFFSET;
                    blockCount = 0;
                }
                if (packet.sequence() < 64 || packet.sequence() >= packets.size() - 16
                        || packet.sequence() % 2000 == 0) {
                    samples.add(row.stripTrailing());
                }
            }
            if (blockCount > 0) blockDigests.add(Long.toUnsignedString(blockDigest, 16));
            System.out.print("{\"name\":\"" + name + "\",\"packetCount\":" + packets.size()
                    + ",\"world\":" + world + ",\"attached\":" + attached
                    + ",\"unsupported\":" + unsupported + ",\"partial\":" + partial
                    + ",\"digest\":\"" + Long.toUnsignedString(digest, 16)
                    + "\",\"blockDigests\":[\"" + String.join("\",\"", blockDigests)
                    + "\"],\"samples\":[\"" + String.join("\",\"", samples) + "\"]}");
            System.out.println(n + 1 == names.size() ? "" : ",");
        }
        System.out.println("]}");
    }

    private static String fields(final int entityId, final int spaceId, final int parentId,
                                 final float x, final float y, final float z,
                                 final float errorX, final float errorY, final float errorZ,
                                 final float yaw, final float pitch, final float roll, final int trailing) {
        return entityId + ":" + spaceId + ":" + parentId + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(x)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(y)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(z)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(errorX)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(errorY)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(errorZ)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(yaw)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(pitch)) + ":"
                + Integer.toUnsignedLong(Float.floatToRawIntBits(roll)) + ":" + trailing;
    }
}
