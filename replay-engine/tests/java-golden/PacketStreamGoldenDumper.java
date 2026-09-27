import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.parse.ReplayStreamHeader;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.PacketTypeDiagnostics;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * M6 WP6.1 golden: the Java packet-stream oracle for the Rust port
 * ({@code replay-engine/crates/replay-core/src/stream.rs}).
 *
 * <p>Dumps, for every committed replay fixture: the stream header, a whole-stream FNV-1a digest over
 * every packet frame (frame header bytes + payload, in frame order), per-1000-packet block digests
 * (so a mismatch localizes), per-type statistics, and a bounded sample of individual packets.</p>
 *
 * <p>Plaintext for all ~112k packets would be tens of MB, so full coverage rides on the digests
 * while the samples stay readable — the volume policy in {@code docs/current-plan.md} §16.3.</p>
 *
 * <p>Usage: {@code java PacketStreamGoldenDumper <fixturesDir> > packet-stream.json}</p>
 */
public final class PacketStreamGoldenDumper {

    /** FNV-1a 64-bit: offset basis + prime (identical arithmetic in Rust, no extra dependency). */
    private static final long FNV_OFFSET = 0xcbf29ce484222325L;
    private static final long FNV_PRIME = 0x100000001b3L;

    private static final int SAMPLE_HEAD = 64;
    private static final int SAMPLE_TAIL = 16;
    private static final int BLOCK_SIZE = 1000;

    private final StringBuilder json = new StringBuilder();

    public static void main(final String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: PacketStreamGoldenDumper <fixturesDir>");
            System.exit(2);
        }
        final Path dir = Path.of(args[0]);
        final List<String> fixtures = List.of(
                "random-battle-example.wotbreplay",
                "cw-training-15-14-example.wotbreplay",
                "tournament-14-14-example.wotbreplay");
        new PacketStreamGoldenDumper().dump(dir, fixtures);
    }

    private void dump(final Path dir, final List<String> fixtures) throws Exception {
        json.append("{\n");
        json.append("  \"source\": \"com.wotb.core.replay.stream.ReplayPacketStreamReader"
                + " + com.wotb.core.parse.ReplayStreamHeader\",\n");
        json.append("  \"digest\": \"FNV-1a 64 over, per packet in frame order,"
                + " [12 frame-header bytes LE][payload bytes]\",\n");
        json.append("  \"fixtures\": [\n");
        for (int i = 0; i < fixtures.size(); i++) {
            final String name = fixtures.get(i);
            final byte[] archiveBytes = Files.readAllBytes(dir.resolve(name));
            final Map<String, byte[]> entries = ReplayArchiveReader.read(archiveBytes);
            final byte[] stream = entries.get("data.wotreplay");
            if (stream == null) {
                throw new IllegalStateException(name + ": no data.wotreplay entry");
            }
            json.append(fixtureJson(name, stream));
            json.append(i + 1 == fixtures.size() ? "\n" : ",\n");
        }
        json.append("  ]\n");
        json.append("}\n");
        System.out.print(json);
    }

    private String fixtureJson(final String name, final byte[] stream) {
        final ReplayPacketStreamReader.ReplayStreamResult result = ReplayPacketStreamReader.read(stream);
        final ReplayStreamHeader header = result.header();
        final List<RawReplayPacket> packets = result.packets();
        final ReplayStreamDiagnostics diag = result.diagnostics();

        final StringBuilder out = new StringBuilder();
        out.append("    {\n");
        out.append("      \"name\": \"").append(name).append("\",\n");
        out.append("      \"sourceSize\": ").append(stream.length).append(",\n");
        out.append("      \"header\": {\n");
        out.append("        \"magic\": \"").append(Long.toUnsignedString(header.magic())).append("\",\n");
        out.append("        \"unknownHeaderBytesHex\": \"").append(hex(header.unknownHeaderBytes())).append("\",\n");
        out.append("        \"clientHash\": \"").append(escape(header.clientHash())).append("\",\n");
        out.append("        \"clientVersion\": \"").append(escape(header.clientVersion())).append("\",\n");
        out.append("        \"packetStreamOffset\": ").append(header.packetStreamOffset()).append("\n");
        out.append("      },\n");

        // Whole-stream digest + per-block digests (localization without dumping plaintext).
        // Payload bytes are read straight out of the source array (Range view) so the ~112k packets
        // per fixture do not each allocate a copy.
        long streamDigest = FNV_OFFSET;
        final List<Long> blockDigests = new ArrayList<>();
        long blockDigest = FNV_OFFSET;
        int blockCount = 0;
        final List<Integer> sampleSequences = new ArrayList<>();
        for (final RawReplayPacket p : packets) {
            for (int i = 0; i < 12; i++) {
                streamDigest = fnv(streamDigest, stream[p.sourceOffset() + i]);
                blockDigest = fnv(blockDigest, stream[p.sourceOffset() + i]);
            }
            final int from = p.payloadOffset();
            final int to = from + p.payloadLength();
            for (int i = from; i < to; i++) {
                streamDigest = fnv(streamDigest, stream[i]);
                blockDigest = fnv(blockDigest, stream[i]);
            }
            blockCount++;
            if (blockCount == BLOCK_SIZE) {
                blockDigests.add(blockDigest);
                blockDigest = FNV_OFFSET;
                blockCount = 0;
            }
            if (isSample(p.sequence(), packets.size())) {
                sampleSequences.add(p.sequence());
            }
        }
        if (blockCount > 0) {
            blockDigests.add(blockDigest);
        }

        out.append("      \"packetCount\": ").append(packets.size()).append(",\n");
        out.append("      \"streamDigest\": \"").append(hex64(streamDigest)).append("\",\n");
        out.append("      \"blockDigests\": [");
        for (int i = 0; i < blockDigests.size(); i++) {
            out.append(i == 0 ? "" : ", ").append('"').append(hex64(blockDigests.get(i))).append('"');
        }
        out.append("],\n");
        out.append("      \"firstClockBits\": ").append(bits(diag.firstClockSec())).append(",\n");
        out.append("      \"maxClockBits\": ").append(bits(diag.maxObservedRawClockSec())).append(",\n");
        out.append("      \"clockRegressionCount\": ").append(diag.clockRegressionCount()).append(",\n");

        final List<PacketTypeDiagnostics> types = new ArrayList<>(diag.packetTypes().values());
        types.sort(Comparator.comparingLong(
                (PacketTypeDiagnostics t) -> Integer.toUnsignedLong(t.type())));
        out.append("      \"typeStats\": [\n");
        for (int i = 0; i < types.size(); i++) {
            final PacketTypeDiagnostics t = types.get(i);
            out.append("        {\"type\": ").append(Integer.toUnsignedLong(t.type()))
                    .append(", \"count\": ").append(t.packetCount())
                    .append(", \"firstClockBits\": ").append(bits(t.firstClockSec()))
                    .append(", \"maxClockBits\": ").append(bits(t.maxObservedRawClockSec()))
                    .append("}").append(i + 1 == types.size() ? "\n" : ",\n");
        }
        out.append("      ],\n");

        out.append("      \"samplePackets\": [\n");
        for (int i = 0; i < sampleSequences.size(); i++) {
            final RawReplayPacket p = packets.get(sampleSequences.get(i));
            long payloadDigest = FNV_OFFSET;
            for (int b = p.payloadOffset(); b < p.payloadOffset() + p.payloadLength(); b++) {
                payloadDigest = fnv(payloadDigest, stream[b]);
            }
            out.append("        {\"sequence\": ").append(p.sequence())
                    .append(", \"sourceOffset\": ").append(p.sourceOffset())
                    .append(", \"type\": ").append(Integer.toUnsignedLong(p.type()))
                    .append(", \"clockBits\": ").append(bits(p.rawClockSec()))
                    .append(", \"payloadLen\": ").append(p.payloadLength())
                    .append(", \"payloadDigest\": \"").append(hex64(payloadDigest)).append("\"}")
                    .append(i + 1 == sampleSequences.size() ? "\n" : ",\n");
        }
        out.append("      ]\n");
        out.append("    }");
        return out.toString();
    }

    /** Raw float bits as an unsigned decimal string — avoids any float-formatting divergence. */
    private static long bits(final float value) {
        return Float.floatToRawIntBits(value) & 0xFFFFFFFFL;
    }

    private static boolean isSample(final int sequence, final int count) {
        return sequence < SAMPLE_HEAD
                || sequence >= count - SAMPLE_TAIL
                || sequence % 5000 == 0;
    }

    private static long fnv(long hash, final byte value) {
        hash ^= (value & 0xFFL);
        return hash * FNV_PRIME;
    }

    private static String hex(final byte[] bytes) {
        final StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (final byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static String hex64(final long value) {
        return String.format("%016x", value);
    }

    private static String escape(final String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
