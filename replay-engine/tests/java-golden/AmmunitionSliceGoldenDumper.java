import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.AmmunitionSelectionDecoder;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Type28-only Java registry oracle, including unsupported fallback for every other packet. */
public final class AmmunitionSliceGoldenDumper {
    private static final long OFFSET = 0xcbf29ce484222325L;
    private static final long PRIME = 0x100000001b3L;

    public static void main(final String[] args) throws Exception {
        final Path dir = Path.of(args[0]);
        final List<String> names = List.of("random-battle-example.wotbreplay",
                "cw-training-15-14-example.wotbreplay", "tournament-14-14-example.wotbreplay");
        System.out.println("{\"decoders\":[\"AmmunitionSelectionDecoder\"],\"fixtures\":[");
        for (int n = 0; n < names.size(); n++) {
            final String name = names.get(n);
            final byte[] stream = ReplayArchiveReader.read(Files.readAllBytes(dir.resolve(name)))
                    .get("data.wotreplay");
            final List<RawReplayPacket> packets = ReplayPacketStreamReader.read(stream).packets();
            final ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
            registry.register(new AmmunitionSelectionDecoder());
            final ReplayDecodeContext context = new ReplayDecodeContext();
            long digest = OFFSET, block = OFFSET;
            int blockCount = 0, selected = 0, partial = 0;
            final List<String> blocks = new ArrayList<>();
            final List<String> samples = new ArrayList<>();
            for (final RawReplayPacket packet : packets) {
                final var result = registry.decode(context, packet);
                final String event;
                if (result.events().getFirst() instanceof AmmunitionSelectionChangedEvent selectedEvent) {
                    event = "selection:" + selectedEvent.selectionValue() + ":" + selectedEvent.confidence();
                    selected++;
                    if (result.status().name().equals("PARTIAL")) partial++;
                } else if (result.events().getFirst() instanceof UnknownReplayEvent unknown) {
                    event = "unknown:" + unknown.reasonCode();
                } else {
                    throw new IllegalStateException("unexpected event");
                }
                final String row = packet.sequence() + "|" + Integer.toUnsignedLong(packet.type()) + "|"
                        + Integer.toUnsignedLong(Float.floatToRawIntBits(packet.rawClockSec())) + "|"
                        + packet.payloadLength() + "|" + result.status() + "|" + event + "|"
                        + result.warnings().stream().map(w -> w.code()).toList() + "\n";
                for (final byte b : row.getBytes(StandardCharsets.UTF_8)) {
                    digest = (digest ^ (b & 0xff)) * PRIME;
                    block = (block ^ (b & 0xff)) * PRIME;
                }
                if (++blockCount == 1000) {
                    blocks.add(Long.toUnsignedString(block, 16));
                    block = OFFSET;
                    blockCount = 0;
                }
                if (packet.sequence() < 64 || packet.sequence() >= packets.size() - 16
                        || packet.sequence() % 2000 == 0) samples.add(row.stripTrailing());
            }
            if (blockCount > 0) blocks.add(Long.toUnsignedString(block, 16));
            System.out.print("{\"name\":\"" + name + "\",\"packetCount\":" + packets.size()
                    + ",\"selected\":" + selected + ",\"partial\":" + partial
                    + ",\"digest\":\"" + Long.toUnsignedString(digest, 16)
                    + "\",\"blocks\":[\"" + String.join("\",\"", blocks)
                    + "\"],\"samples\":[\"" + String.join("\",\"", samples) + "\"]}");
            System.out.println(n + 1 == names.size() ? "" : ",");
        }
        System.out.println("]}");
    }
}
