import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.*;
import com.wotb.core.replay.event.*;
import com.wotb.core.replay.stream.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Three-decoder subset in the same relative order as createDefault(). */
public final class EntityLifecycleSliceGoldenDumper {
    private static final long OFFSET = 0xcbf29ce484222325L, PRIME = 0x100000001b3L;
    private static final List<String> NAMES = List.of("random-battle-example.wotbreplay",
            "cw-training-15-14-example.wotbreplay", "tournament-14-14-example.wotbreplay");

    public static void main(String[] args) throws Exception {
        System.out.println("{\"decoders\":[\"EntityLeaveDecoder\",\"EntityCreateDecoder\",\"MaterializationAnnouncedDecoder\"],\"fixtures\":[");
        for (int i = 0; i < NAMES.size(); i++) {
            String name = NAMES.get(i);
            byte[] stream = ReplayArchiveReader.read(Files.readAllBytes(Path.of(args[0], name))).get("data.wotreplay");
            List<RawReplayPacket> packets = ReplayPacketStreamReader.read(stream).packets();
            ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
            registry.register(new EntityLeaveDecoder());
            registry.register(new EntityCreateDecoder());
            registry.register(new MaterializationAnnouncedDecoder());
            ReplayDecodeContext context = new ReplayDecodeContext();
            long digest = OFFSET, blockDigest = OFFSET;
            int count = 0, create = 0, leave = 0, announced = 0, unknown = 0, malformed = 0;
            List<String> blocks = new ArrayList<>(), samples = new ArrayList<>();
            for (RawReplayPacket packet : packets) {
                ReplayDecodeResult result = registry.decode(context, packet);
                String event;
                if (result.events().isEmpty()) { event = "none"; malformed++; }
                else if (result.events().getFirst() instanceof EntityCreatedEvent e) {
                    event = "created:" + e.entityId() + ":" + HexFormat.of().formatHex(e.unknownInitData()); create++;
                } else if (result.events().getFirst() instanceof EntityRemovedEvent e) {
                    event = "removed:" + e.entityId(); leave++;
                } else if (result.events().getFirst() instanceof MaterializationAnnouncedEvent e) {
                    event = "announced:" + e.entityId() + ":" + HexFormat.of().formatHex(e.zeroTail()); announced++;
                } else if (result.events().getFirst() instanceof UnknownReplayEvent e) {
                    event = "unknown:" + e.reasonCode(); unknown++;
                } else throw new IllegalStateException("unexpected event");
                String row = packet.sequence() + "|" + Integer.toUnsignedLong(packet.type()) + "|"
                        + Integer.toUnsignedLong(Float.floatToRawIntBits(packet.rawClockSec())) + "|"
                        + packet.payloadLength() + "|" + result.status() + "|" + event + "|"
                        + result.warnings().stream().map(ReplayDecodeWarning::code).toList() + "\n";
                for (byte b : row.getBytes(StandardCharsets.UTF_8)) {
                    digest = (digest ^ (b & 255)) * PRIME;
                    blockDigest = (blockDigest ^ (b & 255)) * PRIME;
                }
                if (++count == 1000) { blocks.add(Long.toUnsignedString(blockDigest, 16)); blockDigest = OFFSET; count = 0; }
                if (packet.sequence() < 64 || packet.sequence() >= packets.size() - 16 || packet.sequence() % 2000 == 0)
                    samples.add(row.stripTrailing());
            }
            if (count > 0) blocks.add(Long.toUnsignedString(blockDigest, 16));
            System.out.print("{\"name\":\"" + name + "\",\"packetCount\":" + packets.size()
                    + ",\"created\":" + create + ",\"removed\":" + leave + ",\"announced\":" + announced
                    + ",\"unknown\":" + unknown + ",\"malformed\":" + malformed
                    + ",\"digest\":\"" + Long.toUnsignedString(digest, 16) + "\",\"blockDigests\":[\""
                    + String.join("\",\"", blocks) + "\"],\"samples\":[\"" + String.join("\",\"", samples) + "\"]}");
            System.out.println(i + 1 == NAMES.size() ? "" : ",");
        }
        System.out.println("]}");
    }
}
