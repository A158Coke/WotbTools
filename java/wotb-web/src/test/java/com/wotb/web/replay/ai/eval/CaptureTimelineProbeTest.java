package com.wotb.web.replay.ai.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Type 31/7 占点时间线探测（人工运行，不接 CI）：
 * 对指定目录的训练房/联赛回放扫描事件流 Type 31（Tracked/State）与 Type 7（EntityProperty），
 * 检查是否含基地/旗子/占领进度状态，并核对 battle_results 占点字段；产出
 * target/ai-capture-probe/report.md。运行：
 * mvn -s settings.xml -pl wotb-web -am test -Dtest=CaptureTimelineProbeTest -Dai.capture.replayDir=<目录>
 */
@Tag("ai-capture-probe")
class CaptureTimelineProbeTest {

    @Test
    void probeCaptureStateInReplays() throws IOException {
        final String dir = System.getProperty("ai.capture.replayDir", "");
        assertFalse(dir.isBlank(), "set -Dai.capture.replayDir=<目录>");
        final Path replayDir = Path.of(dir);
        final List<Path> replays;
        try (var stream = Files.list(replayDir)) {
            replays = stream
                    .filter(path -> path.getFileName().toString().endsWith(".wotbreplay"))
                    .sorted()
                    .toList();
        }
        assertFalse(replays.isEmpty(), "no .wotbreplay found in " + replayDir);

        final StringBuilder report = new StringBuilder();
        report.append("# Type 31/7 占点时间线探测报告\n\n");
        for (final Path replay : replays) {
            report.append(probeReplay(replay));
        }

        final Path out = Path.of("target", "ai-capture-probe");
        Files.createDirectories(out);
        Files.writeString(out.resolve("report.md"), report.toString(), StandardCharsets.UTF_8);
        assertTrue(report.length() > 0);
    }

    private static String probeReplay(final Path replay) throws IOException {
        final StringBuilder sb = new StringBuilder();
        sb.append("## ").append(replay.getFileName()).append('\n');
        final byte[] bytes = Files.readAllBytes(replay);
        final Map<String, byte[]> archive = ReplayArchiveReader.read(bytes);
        final byte[] eventBytes = archive.get("data.wotreplay");
        assertTrue(eventBytes != null, "data.wotreplay missing");

        final Battle battle;
        try {
            battle = ReplayParser.parse(bytes);
        } catch (final IOException e) {
            sb.append("- 解析失败: ").append(e.getMessage()).append('\n');
            return sb.toString();
        }
        sb.append("- battle: map=").append(battle.mapName)
                .append(" arenaBonusType=").append(battle.arenaBonusType)
                .append(" durationS=").append(battle.durationS)
                .append(" winnerTeam=").append(battle.winnerTeam).append('\n');
        final long earned = battle.players == null ? 0 : battle.players.stream()
                .filter(p -> p != null)
                .mapToLong(p -> p.victoryPointsEarned).sum();
        final long seized = battle.players == null ? 0 : battle.players.stream()
                .filter(p -> p != null)
                .mapToLong(p -> p.victoryPointsSeized).sum();
        sb.append("- supremacy points: victoryPointsEarned=").append(earned)
                .append(" victoryPointsSeized=").append(seized).append('\n');
        if (battle.players != null && !battle.players.isEmpty()) {
            final Map<Integer, List<Object>> raw = battle.players.getFirst().raw;
            sb.append("- battle_results raw field numbers: ")
                    .append(raw == null ? "none" : raw.keySet().stream().sorted().toList())
                    .append('\n');
        }

        final ReplayPacketStreamReader.ReplayStreamResult stream =
                ReplayPacketStreamReader.readStream(eventBytes);
        final Map<Integer, Integer> typeCounts = new TreeMap<>();
        final List<RawReplayPacket> type31 = new ArrayList<>();
        final List<RawReplayPacket> type7 = new ArrayList<>();
        final Map<Integer, Integer> propIds = new LinkedHashMap<>();
        for (final RawReplayPacket packet : stream.packets()) {
            typeCounts.merge(packet.type(), 1, Integer::sum);
            if (packet.type() == 31 && type31.size() < 4) {
                type31.add(packet);
            }
            if (packet.type() == 7 && type7.size() < 40) {
                type7.add(packet);
                collectPropIds(packet.payload(), propIds);
            }
        }
        sb.append("- packet types: ").append(typeCounts).append('\n');
        sb.append("- Type 31 sample payloads (hex, first 48B):\n");
        for (final RawReplayPacket packet : type31) {
            sb.append("  clock=").append(packet.rawClockSec())
                    .append(" len=").append(packet.payloadLength())
                    .append(" hex=").append(hex(packet.payload(), 48)).append('\n');
        }
        sb.append("- Type 7 propId histogram: ").append(propIds).append('\n');
        return sb.toString();
    }

    /**
     * Type 7 payload: entityId(u32)+propId(u32)+valueLen(u32)+value 循环。
     */
    private static void collectPropIds(final byte[] payload, final Map<Integer, Integer> propIds) {
        int offset = 0;
        while (offset + 12 <= payload.length) {
            final int propId = u32(payload, offset + 4);
            final int valueLen = u32(payload, offset + 8);
            propIds.merge(propId, 1, Integer::sum);
            if (valueLen < 0 || valueLen > payload.length - offset - 12) {
                break;
            }
            offset += 12 + valueLen;
        }
    }

    private static int u32(final byte[] buf, final int offset) {
        return (buf[offset] & 0xFF) | ((buf[offset + 1] & 0xFF) << 8)
                | ((buf[offset + 2] & 0xFF) << 16) | ((buf[offset + 3] & 0xFF) << 24);
    }

    private static String hex(final byte[] bytes, final int max) {
        final StringBuilder sb = new StringBuilder();
        final int limit = Math.min(max, bytes.length);
        for (int index = 0; index < limit; index++) {
            sb.append(String.format("%02x", bytes[index]));
        }
        return sb.toString();
    }
}
