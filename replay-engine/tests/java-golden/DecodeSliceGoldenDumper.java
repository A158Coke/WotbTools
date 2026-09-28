import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.BattleEndDecoder;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayDecodeResult;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.decoder.SessionDecisecondLowByteDecoder;
import com.wotb.core.replay.event.ReplayStreamClosedEvent;
import com.wotb.core.replay.event.SessionDecisecondLowByteEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** Java oracle for the Type14/Type35-only decoder registry. All other types are unsupported. */
public final class DecodeSliceGoldenDumper {
    private static final long OFFSET = 0xcbf29ce484222325L;
    private static final long PRIME = 0x100000001b3L;

    public static void main(final String[] args) throws Exception {
        final Path dir = Path.of(args[0]);
        final List<String> names = List.of("random-battle-example.wotbreplay",
                "cw-training-15-14-example.wotbreplay", "tournament-14-14-example.wotbreplay");
        System.out.println("{\"decoders\":[\"BattleEndDecoder\",\"SessionDecisecondLowByteDecoder\"],\"fixtures\":[");
        for (int n = 0; n < names.size(); n++) {
            final String name = names.get(n);
            final byte[] archive = Files.readAllBytes(dir.resolve(name));
            final byte[] stream = ReplayArchiveReader.read(archive).get("data.wotreplay");
            final List<RawReplayPacket> packets = ReplayPacketStreamReader.read(stream).packets();
            final ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
            registry.register(new BattleEndDecoder());
            registry.register(new SessionDecisecondLowByteDecoder());
            final ReplayDecodeContext context = new ReplayDecodeContext();
            long digest = OFFSET;
            int closed = 0;
            int session = 0;
            int unsupported = 0;
            for (final RawReplayPacket packet : packets) {
                final ReplayDecodeResult result = registry.decode(context, packet);
                final String event;
                if (result.events().getFirst() instanceof ReplayStreamClosedEvent) {
                    event = "closed";
                    closed++;
                } else if (result.events().getFirst() instanceof SessionDecisecondLowByteEvent value) {
                    event = "session:" + value.low8();
                    session++;
                } else if (result.events().getFirst() instanceof UnknownReplayEvent unknown) {
                    event = "unknown:" + unknown.reasonCode();
                    unsupported++;
                } else {
                    throw new IllegalStateException("unexpected event type");
                }
                final String row = packet.sequence() + "|" + Integer.toUnsignedLong(packet.type()) + "|"
                        + Integer.toUnsignedLong(Float.floatToRawIntBits(packet.rawClockSec())) + "|"
                        + packet.payloadLength() + "|" + result.status() + "|" + event + "\n";
                for (final byte b : row.getBytes(StandardCharsets.UTF_8)) {
                    digest = (digest ^ (b & 0xff)) * PRIME;
                }
            }
            System.out.print("{\"name\":\"" + name + "\",\"packetCount\":" + packets.size()
                    + ",\"closed\":" + closed + ",\"session\":" + session
                    + ",\"unsupported\":" + unsupported + ",\"digest\":\""
                    + Long.toUnsignedString(digest, 16) + "\"}");
            System.out.println(n + 1 == names.size() ? "" : ",");
        }
        final ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
        registry.register(new BattleEndDecoder());
        registry.register(new SessionDecisecondLowByteDecoder());
        final ReplayDecodeResult malformed = registry.decode(new ReplayDecodeContext(),
                new RawReplayPacket(7, 0, 0, 35, 1.25f, new byte[0], 0));
        final UnknownReplayEvent unknown = (UnknownReplayEvent) malformed.events().getFirst();
        System.out.println("],\"malformedType35\":{\"status\":\"" + malformed.status()
                + "\",\"reason\":\"" + unknown.reasonCode() + "\",\"warningCode\":\""
                + malformed.warnings().getFirst().code() + "\",\"warningMessage\":\""
                + malformed.warnings().getFirst().message() + "\"}}");
    }
}
