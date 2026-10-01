import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ParsedReplay;
import com.wotb.core.parse.ReplayParser;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * 迁移期一次性对比工具（Java 侧）：用即将退役的服务端 ReplayParser 把目录里的每个 .wotbreplay
 * 解析成 Battle，写成 {file: Battle} JSON。只在本地跑；回放与输出都不入库。
 * 用法见 tools/parity/README.md。
 */
public class JavaReplayDump {
    public static void main(String[] args) throws Exception {
        final Path dir = Path.of(args[0]);
        final Path out = Path.of(args[1]);
        final Map<String, Object> result = new LinkedHashMap<>();
        final List<Path> files;
        try (Stream<Path> s = Files.list(dir)) {
            files = s.filter(p -> p.toString().endsWith(".wotbreplay")).sorted().toList();
        }
        for (final Path file : files) {
            try {
                final Battle battle = ReplayParser.parse(ParsedReplay.read(Files.readAllBytes(file)));
                if (battle.players != null) {
                    for (final PlayerResult p : battle.players) p.raw = null;
                }
                result.put(file.getFileName().toString(), battle);
            } catch (Exception e) {
                result.put(file.getFileName().toString(), Map.of("error", String.valueOf(e)));
            }
        }
        JsonMapper.builder().build().writerWithDefaultPrettyPrinter().writeValue(out.toFile(), result);
        System.out.println("java: " + files.size() + " replays -> " + out);
    }
}
