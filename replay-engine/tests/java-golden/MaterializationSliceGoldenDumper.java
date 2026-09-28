import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.MaterializationDecoder;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** Type5-only Java oracle. Rows contain every materialization, including class evidence. */
public final class MaterializationSliceGoldenDumper {
    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args[0]);
        List<String> names = List.of("random-battle-example.wotbreplay",
                "cw-training-15-14-example.wotbreplay", "tournament-14-14-example.wotbreplay");
        System.out.println("{\"decoders\":[\"MaterializationDecoder\"],\"fixtures\":[");
        for (int n = 0; n < names.size(); n++) {
            String name = names.get(n);
            byte[] stream = ReplayArchiveReader.read(Files.readAllBytes(dir.resolve(name))).get("data.wotreplay");
            List<RawReplayPacket> packets = ReplayPacketStreamReader.read(stream).packets();
            ReplayPacketDecoderRegistry registry = new ReplayPacketDecoderRegistry();
            registry.register(new MaterializationDecoder());
            ReplayDecodeContext context = new ReplayDecodeContext();
            System.out.print("{\"name\":\"" + name + "\",\"packetCount\":" + packets.size() + ",\"rows\":[");
            int count = 0;
            for (RawReplayPacket packet : packets) {
                if (packet.type() != 5) continue;
                var result = registry.decode(context, packet);
                MaterializationEvent e = (MaterializationEvent) result.events().getFirst();
                VehicleBattleLoadout l = e.loadout();
                StringBuilder row = new StringBuilder();
                row.append(packet.sequence()).append('|').append(result.status()).append('|')
                        .append(e.entityId()).append('|').append(e.entityTypeId()).append('|')
                        .append(e.currentHp() == null ? "null" : e.currentHp()).append('|')
                        .append(hex(e.initialTransformRaw())).append('|').append(hex(e.initPayloadRaw()))
                        .append('|').append(l == null ? "null" : loadout(l)).append('|')
                        .append(context.entityClassRegistry().resolve(e.entityId())).append('|')
                        .append(result.warnings().stream().map(w -> w.code() + ":" + w.message()).toList());
                if (count++ > 0) System.out.print(",");
                System.out.print("\"" + escape(row.toString()) + "\"");
            }
            System.out.print("]}");
            System.out.println(n + 1 == names.size() ? "" : ",");
        }
        System.out.println("]}");
    }

    static String loadout(VehicleBattleLoadout l) {
        StringBuilder b = new StringBuilder(l.confidence().name());
        for (var item : l.consumables()) item(b, item);
        for (var item : l.provisions()) item(b, item);
        for (var equipment : l.equipment()) b.append(';').append(equipment.equipmentId());
        return b.toString();
    }

    static void item(StringBuilder b, VehicleBattleLoadout.LoadoutItemSlot item) {
        b.append(';').append(item.slot()).append(':').append(item.wireCode()).append(':')
                .append(item.stateRaw()).append(':').append(hex(item.payloadRaw())).append(':')
                .append(item.logicalItemId() == null ? "null" : item.logicalItemId()).append(':')
                .append(item.confidence());
    }

    static String hex(byte[] bytes) {
        return java.util.HexFormat.of().formatHex(bytes);
    }

    static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
