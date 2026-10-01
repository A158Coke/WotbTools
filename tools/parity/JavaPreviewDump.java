import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ParsedReplay;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.parse.Replays;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayBatchFinalizer;
import com.wotb.web.replay.mapper.Mapper;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * 迁移期一次性对比工具（Java 侧「标准答案」）：把即将退役的服务端批次计算
 * （去重 → League Rating → 指标 enrichment → Preview 列投影）跑在本地回放上，
 * 输出 {batch: PreviewResponse} JSON，供客户端 TS 移植逐字段对齐。
 *
 * <p>批次：传入批次清单 JSON 时按清单；否则根目录全部回放一批、每个子目录一批（系列赛 BO5/BO7）、
 * 每个根目录回放单场一批。
 * 只在本地跑；回放与输出都不入库。用法见 tools/parity/README.md。</p>
 */
public class JavaPreviewDump {
    public static void main(String[] args) throws Exception {
        final Path root = Path.of(args[0]);
        final Path out = Path.of(args[1]);
        final Tankopedia tankopedia = Tankopedia.load();
        final Map<String, List<Path>> batches = new LinkedHashMap<>();
        if (args.length > 2) {
            // 显式批次清单：{"batchName": ["file", ...]}，路径相对 root（可重复同一文件以覆盖去重）
            final Map<String, List<String>> spec = JsonMapper.builder().build().readValue(
                    Path.of(args[2]).toFile(), new tools.jackson.core.type.TypeReference<Map<String, List<String>>>() { });
            for (final Map.Entry<String, List<String>> e : spec.entrySet()) {
                batches.put(e.getKey(), e.getValue().stream().map(root::resolve).toList());
            }
        } else {
            final List<Path> top = replays(root);
            batches.put("all", top);
            try (Stream<Path> s = Files.list(root)) {
                for (final Path dir : s.filter(Files::isDirectory).sorted().toList()) {
                    batches.put("dir:" + dir.getFileName(), replays(dir));
                }
            }
            for (final Path file : top) {
                batches.put("single:" + file.getFileName(), List.of(file));
            }
        }

        final Map<String, Object> result = new LinkedHashMap<>();
        for (final Map.Entry<String, List<Path>> batch : batches.entrySet()) {
            final List<Replays.ParsedEntry> entries = new ArrayList<>();
            int index = 0;
            for (final Path file : batch.getValue()) {
                final String name = file.getFileName().toString();
                try {
                    final Battle battle = ReplayParser.parse(ParsedReplay.read(Files.readAllBytes(file)));
                    if (battle.players != null) {
                        for (final PlayerResult p : battle.players) p.raw = null;
                    }
                    entries.add(new Replays.ParsedEntry(index, name, battle, null));
                } catch (Exception e) {
                    entries.add(new Replays.ParsedEntry(index, name, null, String.valueOf(e.getMessage())));
                }
                index++;
            }
            try {
                final ProcessedDataset ds = ReplayBatchFinalizer.finalizeBatch(entries, null, null);
                result.put(batch.getKey(), Mapper.toPreviewResponse(ds.battles(), ds.battleSourceIds(),
                        ds.battleSourceNames(), ds.duplicates(), ds.failures(), tankopedia,
                        ds.league(), ds.leagueUnavailableCode()));
            } catch (ReplayBatchFinalizer.NoValidReplaysException e) {
                result.put(batch.getKey(), Map.of("error", "NO_VALID_REPLAYS"));
            }
        }
        JsonMapper.builder().build().writerWithDefaultPrettyPrinter().writeValue(out.toFile(), result);
        System.out.println("java preview: " + batches.size() + " batches -> " + out);
    }

    private static List<Path> replays(final Path dir) throws Exception {
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.toString().endsWith(".wotbreplay")).sorted().toList();
        }
    }
}
